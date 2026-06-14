# CodeLegion

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/AtaNdr/CodeLegion?label=release)](https://github.com/AtaNdr/CodeLegion/releases)
[![Issues](https://img.shields.io/github/issues/AtaNdr/CodeLegion)](https://github.com/AtaNdr/CodeLegion/issues)

Label a GitHub issue. Get a reviewed pull request. Unattended.

CodeLegion is a fleet of autonomous Claude Code agents that picks up labeled issues, writes code and tests, and opens pull requests for human review. It deploys as a single Azure Web App that provisions and operates everything else.

Website: **<https://codelegion.atanaderi.dev>**

## Who it's for

CodeLegion is built for individual developers, small engineering teams, and operators who want to:

- Offload well-scoped maintenance work — dependency bumps, small refactors, test additions, documentation fixes — to autonomous agents while keeping a human in the review loop.
- Experiment with agentic coding workflows on a real repository without wiring together their own orchestration layer.
- Run the orchestration themselves on their own Azure subscription, with their own Anthropic key, against a repository they control.

It is **not** designed to replace human engineers, ship code without review, or operate against production-critical repositories you wouldn't trust an unattended junior with. Every pull request still goes through your normal branch protection and review process.

If that fits, [`SETUP.md`](./SETUP.md) walks through deployment in about 15 minutes for someone familiar with Azure App Service.

---

## Contents

- [What it does](#what-it-does)
- [Lifecycle of an issue](#lifecycle-of-an-issue)
- [Architecture](#architecture)
- [Cost](#cost)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Repository layout](#repository-layout)
- [Roadmap](#roadmap)
- [Documentation](./docs/) — FAQ · stakeholder briefing · engineering profile · skills guide
- [Contributing](#contributing) · [License](#license)

---

## What it does

- **Label-driven dispatch.** `agent-ready` on an issue triggers an Azure VM to boot, claim the issue, run Claude Code, and open a pull request. `model:haiku|sonnet|opus` routes to the right tier.
- **Wake on demand.** Agents spin only when work exists. They self-deallocate after 10 idle minutes.
- **Distinct agent identities.** Each agent picks its own name and emoji on first boot and stamps every comment and pull request with it.
- **Triage proposals for vague work.** Under-specified issues get a structured proposal and wait for human approval. Well-formed ones skip triage.
- **Per-task cost transparency.** Each completed task posts a one-line cost summary on the issue. The dashboard shows daily and monthly totals.
- **Operator controls.** One-click Stop/Start fleet, structured Uninstall, in-UI VM size and pricing editors, per-VM force-sync / wake / sleep / delete, manual reconcile.
- **GitHub App authentication.** No personal access tokens; short-lived installation tokens minted per request.

## Lifecycle of an issue

1. Open an issue using the **Agent Task** template (CodeLegion injects this on first setup). Defaults: `agent-ready`, `model:sonnet`.
2. Within roughly three minutes an agent claims the issue and posts a decision comment (`implement directly`, `standardize and implement`, `propose triage`, or `blocked`).
3. The agent writes code, writes tests against each acceptance criterion, runs lint / type-check / test, and opens a pull request that maps criteria to tests.
4. A reviewer approves and merges, or requests changes — the agent reads review comments and pushes fixes to the same branch.
5. A cost-summary comment lands on the issue on completion.
6. After 10 idle minutes the VM self-deallocates.

The full operator surface is the `/status` dashboard: per-VM state, reconcile history, cost breakdown, Stop/Start, Uninstall, configuration editors. Every `#N` on the dashboard links to GitHub.

## Architecture

- **One Web App, one fleet, one repository.** Multi-repo per fleet is out of scope.
- **All state and secrets on the Web App.** App Settings hold the Anthropic key, GitHub App private key, webhook secret, and report token. `/home/data/` holds cost logs, activity timelines, and the fleet pause flag. No Key Vault, no database.
- **VMs have no Azure access.** They fetch their secrets from `GET /agent/secrets` with a narrow Bearer `REPORT_TOKEN`. The GitHub App private key never leaves the controller.
- **Controller-driven assignment.** A reconcile loop runs every 45 seconds (and on every webhook), matches unclaimed issues to free agents of the matching model, and wakes or spins VMs as needed.

Full design and decision log: [`PLAN.md`](./PLAN.md).

## Cost

| Component | Cost |
|---|---|
| App Service B1 plan | ~$13 / month (F1 free works for testing, capped at 60 CPU-min/day). |
| Public IP + NAT gateway | ~$35 / month combined. |
| Agent VMs | Per-second while running; with 10-minute idle, a small fraction of always-on. |
| Anthropic API tokens | Variable. Per-task cost visible on the issue and in the dashboard. |

A typical well-scoped issue resolves for **$0.03–$0.30** in tokens.

## Security

> [!WARNING]
> **The `/status` dashboard has no built-in authentication.** It renders sensitive data including the webhook secret and admin token. Before exposing your deployment to the public internet, gate it with **Azure App Service Authentication (Easy Auth)** or equivalent. A built-in login is on the roadmap and tracked in [`TODO.md`](./TODO.md); until it ships, treat any deployment without an external auth layer as private.

Other things worth knowing:

- **Agent → controller** authenticates with `REPORT_TOKEN`, which rides in cloud-init and is therefore visible to anyone with VM-read on the resource group. Token scope is narrow: `/agent/log`, `/agent/status`, `/agent/sync`, `/agent/secrets`.
- **GitHub App** is the only path to GitHub; installation tokens are minted per request and never reach a VM.
- **Webhook payloads** are HMAC-verified against `GH_WEBHOOK_SECRET`.

Full trust model and disclosure process: [`SECURITY.md`](./SECURITY.md).

## Known limitations

- **Azure only.** AWS and GCP support are not planned.
- **One repository per fleet.**
- **`--dangerously-skip-permissions` is required** for the agent's Claude Code session. Guard rails live in `repo-template/CLAUDE.md` and `repo-template/codelegion/DO_NOT_TOUCH.md`. Do not deploy CodeLegion against a repository you would not trust an unattended junior with.
- **Single-instance by design.** State lives on the Web App's persistent disk; horizontal scaling is out of scope.
- **Static pricing.** A bundled `pricing.json` ships per release; override at runtime via the in-UI editor or `PRICING_JSON` App Setting.

## Repository layout

```
codelegion/
├── README.md SETUP.md SECURITY.md CONTRIBUTING.md PLAN.md TODO.md LICENSE
├── index.js config.js state.js config.json pricing.json package.json
│
├── azure/             ARM clients, discovery, network, App Settings, VMs, uninstall.
├── github/            JWT + installation token, Contents API, install probe.
├── anthropic/         Pricing loader (bundled + env override).
├── flow1/             Setup wizard — checks, runner, routes, fixers.
├── flow2/             Webhook, reconcile, cost, logs, activity, secrets,
│                      VM list, retirement, fleet pause, PR-review handler.
├── ui/                HTML render, per-section templates, inline browser JS.
├── scripts/           Operator helpers (release.sh).
├── scripts-static/    Agent shell scripts served at /scripts/*.
├── repo-template/     Files injected into target repos.
├── auth/              Dashboard auth — design notes (status: planned, see TODO.md).
└── docs/              FAQ, stakeholder deck, engineering profile, skills guide.
```

## Roadmap

Pending work for future contributors is tracked in [`TODO.md`](./TODO.md). Highlights:

- **Dashboard authentication** — a built-in login layer so external auth is no longer required.
- **Configurable feature flags** — toggle significant features via App Settings.
- **Operational hardening** — broader audit logs, more reconcile auto-remediation paths.

Out of scope: AWS / GCP, horizontal scaling, multi-repo per fleet.

## Contributing

Issues and pull requests are welcome. Scope and workflow: [`CONTRIBUTING.md`](./CONTRIBUTING.md). Open work for new contributors lives in [`TODO.md`](./TODO.md).

## License

MIT — see [`LICENSE`](./LICENSE).
