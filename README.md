# CodeLegion

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/AtaNdr/CodeLegion?label=release)](https://github.com/AtaNdr/CodeLegion/releases)
[![Issues](https://img.shields.io/github/issues/AtaNdr/CodeLegion)](https://github.com/AtaNdr/CodeLegion/issues)

A self-orchestrating fleet of Claude Code agents that picks up labeled GitHub issues, writes code and tests, and opens pull requests for human review. Deploys as a single Azure Web App; the Web App provisions and operates everything else.

---

## Contents

- [Overview](#overview)
- [Lifecycle of an issue](#lifecycle-of-an-issue)
- [Operating the fleet](#operating-the-fleet)
- [Architecture](#architecture)
- [Cost](#cost)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Repository layout](#repository-layout)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

CodeLegion turns labeled GitHub issues into reviewed pull requests:

- **Label-driven dispatch.** An `agent-ready` label on an issue causes a fresh Azure VM to boot, claim the issue, run Claude Code, and open a PR. Model routing is via label: `model:haiku` for trivial fixes, `model:sonnet` for standard work, `model:opus` for hard problems.
- **Self-discovering setup.** On boot, the controller inventories its resource group, walks the operator through whatever's missing, and creates the five network resources it needs (VNet, subnet, NSG, public IP, NAT gateway).
- **Wake-on-demand VMs.** Agents are spun only when work exists; they self-deallocate after ten idle minutes. Cost scales with use.
- **Triage proposals for vague issues.** Broad or under-specified issues get a structured proposal comment and wait for human approval. Well-formed issues skip triage.
- **Distinct agent identities.** Each agent picks its own name and emoji on first boot. The identity appears in the dashboard, in PR comments, and in cost reports.
- **Per-task cost accounting.** Every completed task posts a one-line cost summary on the issue (`💰 Task cost: $X.XX — model · tokens · duration`). Dashboard shows live daily and monthly totals.
- **Operator controls.** One-click Stop/Start fleet, structured Uninstall (repo, Azure, or both), per-VM force-sync / wake / sleep / delete, manual reconcile, edit-in-place VM sizes and pricing.
- **GitHub App authentication.** No personal access tokens. Installation tokens are minted per request; the private key never leaves the controller.

Get started: [`SETUP.md`](./SETUP.md). Setup takes around 15 minutes for those familiar with Azure App Service.

## Lifecycle of an issue

1. Open an issue using the **Agent Task** template (CodeLegion injects this). Defaults: `agent-ready`, `model:sonnet`.
2. Within ~3 minutes a fresh agent VM boots and claims the issue. The agent posts a decision comment: `implement directly`, `standardize and implement`, `propose triage`, or `blocked`.
3. The agent writes code, writes tests against each acceptance criterion, runs lint / type-check / test gates, and opens a PR. The PR body maps each acceptance criterion to its covering test(s).
4. Reviewer approves and merges, or requests changes — the agent reads review comments and pushes fixes to the same branch.
5. On task completion, a cost-summary comment lands on the issue.
6. After ten idle minutes the agent's VM self-deallocates.

## Operating the fleet

The dashboard at `/status` is the operations surface.

| Action | Where |
|---|---|
| **Stop / Start fleet** | Fleet header. Stop halts reconcile and deallocates every running agent; Start resumes. Persists across controller restarts. |
| **Wake all / Sleep all** | Fleet header. Operates the existing fleet without changing capacity. |
| **Force-create** | Fleet header. Spin a specific model on demand. |
| **Per-VM controls** | Log, Timeline, Force sync, Wake / Sleep, Delete — one set per card. |
| **Reconcile now / History** | Orchestrator card. Manual run + last 50 cycles. |
| **Cleanup orphan resources** | Environment & discovery. Sweeps failed VMs, orphan NICs (which hold subnet IPs), and orphan disks. |
| **Uninstall** | Environment & discovery. Three scopes — repo files, Azure resources, or both, with a typed confirmation. |
| **Edit VM sizes per model** | Infrastructure setup → VM sizes row → **Edit**. Sets `VM_SIZE_<MODEL>` App Settings. Applies to the next spin. |
| **Edit Anthropic pricing** | Infrastructure setup → Anthropic pricing row → **Edit**. Per-model form (input / output / cache read / cache write). Saves to `PRICING_JSON` App Setting and takes effect immediately. |
| **Open an issue on GitHub** | Click any `#N` reference on the dashboard. |

Auto-refresh is surgical: only the Fleet fragment is polled every 30 seconds. The rest of the page stays stable so scroll position and any `<details>` you have open are preserved.

## Architecture

- **One Web App = one fleet = one GitHub repository.** Multi-repo support is out of scope.
- **Web App holds all state and secrets.** Anthropic key, GitHub App PEM, webhook secret, report token — all in the Web App's own App Settings. No Key Vault, no storage account.
- **Persistent disk only.** Cost log, activity timelines, raw VM logs, setup state, and the fleet pause flag live in `/home/data/` on the Web App's persistent disk.
- **VMs have no Azure access.** They fetch secrets from the controller via `GET /agent/secrets` (Bearer `REPORT_TOKEN`). The GitHub App private key never leaves the controller; installation tokens are minted per call.
- **Activity history is owned by each VM.** Agents write `/var/lib/agent/activity.jsonl` locally and push new lines on every state change plus a 10-second heartbeat. The controller cache lives at `/home/data/activity/{vm}.jsonl`.
- **Controller-driven assignment.** A reconcile loop runs every 45 seconds (and on every webhook), lists unclaimed `agent-ready` issues, and assigns each to a free agent of the matching model — waking a deallocated VM or spinning a new one within configured caps.

Full design and decision log: [`PLAN.md`](./PLAN.md).

## Cost

| Component | Cost |
|---|---|
| App Service B1 plan | ~$13 / month, always-on. F1 free works for low-traffic testing but caps at 60 CPU-minutes / day. |
| Public IP + NAT gateway | ~$35 / month combined. |
| Agent VMs | Per-second while running. With the default 10-minute idle timeout, expect a small fraction of always-on cost. |
| Anthropic API tokens | Variable. Tracked live, per-task and per-issue, in the dashboard and on the issue itself. |

## Security

**Before exposing your deployment publicly:**

- The `/status` dashboard has no built-in authentication yet — the in-app password flow is in active design (see [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md)). Until that ships, gate the dashboard with **Azure App Service Easy Auth** (Azure portal → Authentication → Add identity provider — Microsoft / GitHub / Google / custom OIDC).
- Agents authenticate to the controller with `REPORT_TOKEN`. This token rides in each VM's cloud-init, so anyone with VM-read on the resource group can see it. Token scope is narrow (`/agent/log`, `/agent/status`, `/agent/sync`, `/agent/secrets`).
- The GitHub App private key never leaves the controller. Installation tokens are minted per request and never reach a VM.
- Webhook payloads are HMAC-verified against `GH_WEBHOOK_SECRET`.

See [`SECURITY.md`](./SECURITY.md) for the full trust model and the responsible-disclosure process.

## Known limitations

- **Azure only.** AWS and GCP support are not on the roadmap.
- **One repository per fleet.** A single Web App orchestrates a single GitHub repo.
- **`--dangerously-skip-permissions` is required.** Agents need to act unattended. The guard rails are documented in `repo-template/CLAUDE.md` and `repo-template/DO_NOT_TOUCH.md`. Do not deploy CodeLegion against a repository you would not trust an unattended, fast junior developer with.
- **Single-instance by design.** State lives on the Web App's local persistent disk. Horizontal scaling would require a shared store and is explicitly out of scope.
- **Static pricing.** Bundled `pricing.json` ships with each release. The dashboard's Anthropic-pricing edit panel lets you override it without redeploying.

## Repository layout

```
codelegion/
├── README.md             You are here.
├── SETUP.md              Step-by-step deployment guide.
├── SECURITY.md           Trust model and disclosure process.
├── CONTRIBUTING.md       How to file issues and propose changes.
├── PLAN.md               Architecture specification and decision log.
├── LICENSE               MIT.
│
├── index.js              Express entrypoint.
├── config.js             Environment loader.
├── state.js              /home/data persistence for setup state.
├── config.json           Fleet caps, idle timeouts, default VM sizes.
├── pricing.json          Per-model rates. Overridable via PRICING_JSON.
├── package.json
│
├── auth/                 Dashboard auth — implementation plan (status: planned).
├── azure/                ARM clients, resource-group discovery, network
│                         provisioning, App Settings, VM lifecycle, uninstall.
├── github/               JWT mint + installation token, Contents API,
│                         install probe, PEM normalisation.
├── anthropic/            Pricing loader (bundled + env override).
├── flow1/                Setup wizard — checks, runner, routes, fixers.
├── flow2/                Webhook, cost, logs, activity, secrets endpoint,
│                         VM list, retirement, reconcile loop, fleet pause.
├── ui/                   HTML render, per-section templates, inline browser JS.
├── scripts/              Operator helpers (release.sh).
├── scripts-static/       Agent shell scripts served at /scripts/*.
└── repo-template/        Files injected into target repositories.
```

## Roadmap

- **Dashboard authentication** — built-in password / cookie session, optional Azure Key Vault multi-user mode with invite flow. Design in [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md).
- **Operational hardening** — additional auto-remediation paths in the reconcile loop, broader audit logs.
- **Configurable feature flags** — each significant feature behind an App-Settings toggle so operators can disable what they don't need.

Items not on the roadmap are documented in [Known limitations](#known-limitations).

## Contributing

Issues and pull requests welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow and the kinds of changes that are in or out of scope.

## License

MIT — see [`LICENSE`](./LICENSE).
