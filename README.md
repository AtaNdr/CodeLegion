# CodeLegion

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/AtaNdr/CodeLegion?label=release)](https://github.com/AtaNdr/CodeLegion/releases)
[![Issues](https://img.shields.io/github/issues/AtaNdr/CodeLegion)](https://github.com/AtaNdr/CodeLegion/issues)

A self-bootstrapping fleet of Claude Code agents that picks up labeled GitHub issues, writes code + tests, and opens PRs for human review. Deploy as an Azure Web App; the Web App provisions everything else.

> **Status:** working prototype. Read [`SETUP.md`](./SETUP.md) before deploying. Plan ~15 minutes if you've used Azure before.

## What you get

- **Three-step setup.** Create a Claude API key, create an Azure Web App, deploy this repo to it. The Web App becomes the orchestrator and bootstraps the rest from a built-in wizard.
- **Self-discovers its infra.** On boot, it inventories its own resource group, walks you through whatever's missing, and creates the 5 network resources it needs (VNet, subnet, NSG, public IP, NAT gateway).
- **Wake on demand.** VMs are spun only when issues exist. They self-deallocate after 10 idle minutes. Pay for what you use.
- **Stop/Start fleet.** One-click pause from the dashboard — deallocates every running agent and halts reconcile until you press Start. Survives controller restarts.
- **Model routing.** Tag an issue `model:haiku` for trivial fixes, `model:sonnet` for standard work, `model:opus` for hard problems. Right tool for the job.
- **Triage proposals for vague issues.** Broad or under-specified issues get a structured proposal comment and wait for human approval before code is written. Well-formed issues skip triage.
- **Personalities.** Each agent picks its own name, emoji, and voice on first boot. Distinct PRs, easier reviewing.
- **Per-VM live activity.** Each agent's current state and history visible in the dashboard. Source of truth lives on the VM; controller is a display cache.
- **GitHub App auth.** No personal tokens. Short-lived installation tokens minted per request; the private key never leaves the controller.
- **Live status page.** `/status` on the Web App — setup wizard first, fleet dashboard once setup is green. Auto-refreshes only the Fleet section (the rest stays stable). Dark-mode aware. Optional password gate (see *Security*).
- **Cost tracked end-to-end.** Per-task and per-month totals from token usage. Pricing.json ships in the release; override via App Setting if you want.
- **Clean uninstall.** Remove the agent-fleet files from your repo, wipe every Azure resource in the RG (except this Web App and its plan), or both — from the dashboard.

## How it feels day-to-day

1. You open an issue using the Agent Task template. Default labels: `agent-ready`, `model:sonnet`.
2. Within ~3 minutes a fresh agent VM boots, picks the issue, posts a plan as a comment.
3. It writes code, writes tests, runs the gates, self-reviews the diff, opens a PR.
4. The PR comments link back to the issue.
5. You review the PR. Approve and merge → done. Request changes → the agent reads your comments and pushes fixes to the same branch.
6. The agent idles, no new work for 10 min, self-terminates.

## Repo layout

```
codelegion/
├── SETUP.md              ← Start here. Step-by-step deploy guide.
├── README.md             This file.
├── SECURITY.md           Responsible disclosure + dashboard auth model.
├── CONTRIBUTING.md       How to file issues + propose changes.
├── PLAN.md               Architecture spec + decision log.
├── LICENSE               MIT.
│
├── index.js              Express entrypoint. Mounts setup + fleet routes.
├── config.js             Env loader.
├── state.js              /home/data/flow1.json persistence.
├── config.json           Fleet caps, idle timeouts, VM sizes.
├── pricing.json          Per-model rates. Override with PRICING_JSON App Setting.
├── package.json
│
├── azure/                ARM clients, RG discovery, network provision,
│                         App Settings R/W, VM lifecycle, self-update,
│                         uninstall (RG-wide cleanup).
├── github/               JWT mint + installation token, Contents API
│                         inject/clean, install probe, PEM normalization.
├── anthropic/            Pricing loader (bundled + env override).
├── flow1/                Setup-wizard checks, runner, routes, fixers.
├── flow2/                Webhook, cost, logs, activity, secrets endpoint,
│                         VM list, retirement sweep, reconcile loop,
│                         fleet pause/resume, dashboard auth.
├── ui/                   HTML render + per-section templates + inline JS.
├── scripts/              Operator helpers (release.sh, hash-password.mjs).
├── scripts-static/       Agent shell scripts served at /scripts/*.
└── repo-template/        Files injected into target repos via Contents API.
```

## Architecture at a glance

- **One Web App = one fleet = one GitHub repo.** Multi-repo support deferred.
- **Web App holds all state and secrets.** Anthropic API key, GitHub App PEM, webhook secret, report token, optional dashboard password hash — all live in the Web App's own App Settings. No Key Vault. No storage account.
- **Persistent disk only.** Cost log, activity timelines, raw VM logs, setup state, and the fleet pause flag live in `/home/data/` on the Web App's persistent disk. Single-instance only by design.
- **VMs have no Azure access.** They fetch secrets from the controller via `GET /agent/secrets` (Bearer REPORT_TOKEN). The GitHub App private key never leaves the controller — it mints fresh installation tokens per call.
- **History on the VM.** Each agent writes `/var/lib/agent/activity.jsonl` locally and pushes new lines on every state change plus a 10s heartbeat. Controller cache lives at `/home/data/activity/{vm}.jsonl`.
- **Auto-refresh is surgical.** The dashboard polls only the Fleet fragment every 30s; the rest of the page is static between user actions, so scroll position and `<details>` state are preserved.

See [`PLAN.md`](./PLAN.md) for the full design spec.

## Cost shape

- App Service B1: ~$13/month always-on (F1 free works for low-traffic but caps at 60 CPU-min/day)
- Public IP + NAT gateway: ~$35/month combined
- VMs: per-second while running. With 10-min idle timeout, expect a small fraction of always-on cost.
- Anthropic API tokens: the variable cost. The dashboard tracks live, per-task and per-issue.

## Security

This is critical before publishing your deployed instance:

- **Dashboard auth is opt-in.** Set `DASHBOARD_PASSWORD_HASH` (App Settings) to a `scrypt:salt:hash` produced by `node scripts/hash-password.mjs '<password>'`, or use the "Set dashboard password" button in Environment & discovery. Without this, `/status` is open to anyone with the URL.
- **Alternative: App Service Easy Auth.** If you'd rather SSO with Microsoft / GitHub / Google, flip Easy Auth on in the Azure portal. CodeLegion's middleware no-ops when its own auth isn't configured, so Easy Auth fronts cleanly.
- **Agents authenticate to the controller with `REPORT_TOKEN`.** This token rides in the VM's cloud-init; anyone with VM-read on the RG can see it. Token scope is narrow (`/agent/log`, `/agent/status`, `/agent/sync`, `/agent/secrets`) but worth knowing.
- **GitHub App, not PATs.** The App's private key never leaves the controller. Installation tokens are minted per request and never reach a VM.
- **Found a security issue?** See [`SECURITY.md`](./SECURITY.md).

## Limitations & honest caveats

- **Azure-only.** AWS support is on the list but not built.
- **Single repo per fleet.** One Web App orchestrates one GitHub repo.
- **`--dangerously-skip-permissions` is required.** Agents need to act unattended. Hard rules in `repo-template/CLAUDE.md` and `repo-template/DO_NOT_TOUCH.md` are your guard rails. Do not deploy on repos you wouldn't trust a fast junior dev with.
- **Pricing.json is static.** Update with each release, or paste an override JSON into the `PRICING_JSON` App Setting. No live fetch.
- **Single-instance by design.** State on the local persistent disk; horizontal scaling would need a shared store. Not a goal of this project.

## Contributing

Issues and PRs welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the short version — fork, branch, PR; for non-trivial changes please open an issue first to align on direction.

## License

MIT — see [`LICENSE`](./LICENSE).
