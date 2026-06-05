# CodeLegion

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/AtaNdr/CodeLegion?label=release)](https://github.com/AtaNdr/CodeLegion/releases)
[![Issues](https://img.shields.io/github/issues/AtaNdr/CodeLegion)](https://github.com/AtaNdr/CodeLegion/issues)

Label a GitHub issue. Get a reviewed pull request. Unattended.

CodeLegion is a fleet of autonomous Claude Code agents that picks up labeled issues, writes code and tests, and opens PRs for human review. Deploys as a single Azure Web App; the Web App provisions and operates everything else.

> 🌐 **Landing page:** [`docs/index.html`](./docs/index.html) — light/dark, modern, deployable to GitHub Pages from `/docs`.

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
- [Documentation](./docs/) — landing page · FAQ · stakeholder briefing · engineering profile
- [Contributing](#contributing) · [License](#license)

---

## What it does

- **Label-driven dispatch.** `agent-ready` on an issue triggers an Azure VM to boot, claim, run Claude Code, and open a PR. `model:haiku|sonnet|opus` routes to the right tier.
- **Wake on demand.** Agents spin only when work exists. They self-deallocate after 10 idle minutes.
- **Distinct agent identities.** Each agent picks its own name and emoji on first boot. Stamped on every comment and PR.
- **Triage proposals for vague work.** Under-specified issues get a structured proposal and wait for human approval. Well-formed ones skip triage.
- **Per-task cost transparency.** Each completed task posts a one-line cost summary on the issue. Dashboard shows daily and monthly totals.
- **Operator controls.** One-click Stop/Start fleet · structured Uninstall · in-UI VM size and pricing editors · per-VM force-sync / wake / sleep / delete · manual reconcile.
- **GitHub App auth.** No personal access tokens; short-lived installation tokens minted per request.

Get started: [`SETUP.md`](./SETUP.md). About 15 minutes for someone familiar with Azure App Service.

## Lifecycle of an issue

1. Open an issue using the **Agent Task** template (CodeLegion injects this). Defaults: `agent-ready`, `model:sonnet`.
2. Within ~3 minutes an agent claims and posts a decision (`implement directly`, `standardize and implement`, `propose triage`, or `blocked`).
3. The agent writes code, writes tests against each acceptance criterion, runs lint / type-check / test, and opens a PR mapping criteria to tests.
4. Reviewer approves and merges, or requests changes — the agent reads review comments and pushes fixes to the same branch.
5. A cost-summary comment lands on the issue on completion.
6. After 10 idle minutes the VM self-deallocates.

The full operator surface is the `/status` dashboard: per-VM state, reconcile history, cost breakdown, Stop/Start, Uninstall, configuration editors. Every `#N` on the dashboard links to GitHub.

## Architecture

- **One Web App = one fleet = one repo.** Multi-repo is out of scope.
- **All state and secrets on the Web App.** App Settings hold the Anthropic key, GitHub App PEM, webhook secret, report token. `/home/data/` holds cost logs, activity timelines, the fleet pause flag. No Key Vault, no database.
- **VMs have no Azure access.** They fetch their secrets from `GET /agent/secrets` with a narrow Bearer `REPORT_TOKEN`. The GitHub App PEM never leaves the controller.
- **Controller-driven assignment.** A reconcile loop runs every 45 s (and on every webhook), matches unclaimed issues to free agents of the matching model, and wakes or spins VMs as needed.

Full design and decision log: [`PLAN.md`](./PLAN.md).

## Cost

| Component | Cost |
|---|---|
| App Service B1 plan | ~$13 / month (F1 free works for testing, capped at 60 CPU-min/day). |
| Public IP + NAT gateway | ~$35 / month combined. |
| Agent VMs | Per-second while running; with 10-min idle, a small fraction of always-on. |
| Anthropic API tokens | Variable. Per-task cost visible on the issue and in the dashboard. |

Typical scoped issue resolves for **$0.03–$0.30** in tokens.

## Security

Before exposing your deployment publicly:

- **Dashboard auth is not built-in yet** (design in [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md)). Gate `/status` with **Azure App Service Easy Auth** until that ships.
- **Agent → controller** authenticates with `REPORT_TOKEN`, which rides in cloud-init (visible to anyone with VM-read on the resource group). Token scope is narrow: `/agent/log`, `/agent/status`, `/agent/sync`, `/agent/secrets`.
- **GitHub App** is the only path to GitHub; installation tokens are minted per request and never reach a VM.
- **Webhook payloads** are HMAC-verified against `GH_WEBHOOK_SECRET`.

Full trust model and disclosure process: [`SECURITY.md`](./SECURITY.md).

## Known limitations

- **Azure only.** AWS and GCP support are not planned.
- **One repository per fleet.**
- **`--dangerously-skip-permissions` is required** for the agent's Claude Code session. Guard rails live in `repo-template/CLAUDE.md` and `repo-template/DO_NOT_TOUCH.md`. Don't deploy against a repo you wouldn't trust an unattended junior with.
- **Single-instance by design.** State on the Web App's persistent disk; horizontal scaling is out of scope.
- **Static pricing.** Bundled `pricing.json` per release; override at runtime via the in-UI editor or `PRICING_JSON` App Setting.

## Repository layout

```
codelegion/
├── README.md SETUP.md SECURITY.md CONTRIBUTING.md PLAN.md LICENSE
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
├── auth/              Dashboard auth — implementation plan (status: planned).
└── docs/              Landing page (index.html), FAQ, stakeholder deck, engineering profile.
```

## Roadmap

- **Dashboard authentication** — password + cookie session, optional Key Vault multi-user with invite flow. See [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md).
- **Configurable feature flags** — significant features toggleable via App Settings.
- **Operational hardening** — broader audit logs, more reconcile auto-remediation paths.

Out of scope: AWS / GCP, horizontal scaling, multi-repo per fleet.

## Contributing

Issues and pull requests welcome. Scope and workflow: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](./LICENSE).
