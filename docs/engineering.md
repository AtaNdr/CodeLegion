# Engineering profile

Technical reference for the CodeLegion project — stack, code structure, build pipeline, and a session timeline showing how the recent feature set was built using Claude Code.

---

## Contents

- [Stack at a glance](#stack-at-a-glance)
- [Languages and runtime](#languages-and-runtime)
- [Cloud platform](#cloud-platform)
- [Dependencies](#dependencies)
- [Code structure](#code-structure)
- [Build, release, deployment](#build-release-deployment)
- [Storage model](#storage-model)
- [LLM integration](#llm-integration)
- [Security primitives](#security-primitives)
- [Code statistics](#code-statistics)
- [Development timeline](#development-timeline)
- [Cost-estimation methodology](#cost-estimation-methodology)

---

## Stack at a glance

| Layer | Choice |
|---|---|
| Controller runtime | **Node.js 24 LTS** on Azure App Service (Linux) |
| Controller language | **JavaScript** (ES modules) |
| HTTP framework | **Express 4** |
| Agent OS | **Ubuntu 24.04 LTS** (Azure VM image) |
| Agent shell | **Bash** |
| Agent CLI | **Claude Code** (`@anthropic-ai/claude-code`) + **GitHub CLI** (`gh`) |
| Cloud platform | **Microsoft Azure** (App Service, Compute, Network, Resources) |
| LLM provider | **Anthropic** (`claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-7`) |
| VCS / collaboration | **GitHub** (Issues, PRs, Webhooks, GitHub Apps) |
| Auth model (current) | GitHub App (controller ↔ GitHub), Bearer `REPORT_TOKEN` (controller ↔ agents), Easy Auth (operator ↔ dashboard, optional) |
| Storage | File-based, JSONL on App Service persistent disk (`/home/data`) |
| Database | **None** (deliberate — see [PLAN.md](../PLAN.md)) |
| Build / release | GitHub Actions (auto-version + release workflows) |
| Versioning | SemVer; patch auto-bumped per push to `main` |

## Languages and runtime

- **Controller** — JavaScript (ES modules, no transpilation). Targets Node 24 LTS. Strict module boundaries, no `require`. Async/await throughout, no callbacks.
- **Agents** — Bash 5. Each agent VM runs `agent-loop.sh` as a systemd service. The shell is responsible for: refreshing GH tokens, claiming issues with race resolution, invoking Claude Code, parsing usage telemetry, and self-deallocating.
- **UI** — Server-rendered HTML composed from per-section JS templates. A small inline browser script (~600 lines, no framework) handles interactivity. No build step.

## Cloud platform

- **Azure App Service (B1 Linux plan)** hosts the controller. Plan cost: ~US$13/month.
- **Azure Compute (`Standard_D2as_v4` default)** hosts agents. Per-second billing; default 10-minute idle timeout.
- **Azure Network** — VNet + dedicated `agents` subnet + Public IP + NAT Gateway. Combined networking floor: ~US$35/month.
- **Azure ARM** is driven via the Web App's system-assigned managed identity (Contributor on the resource group).

Azure was chosen because App Service combines four primitives that the architecture relies on:
1. A managed identity that drives ARM out of the box.
2. A `/home/` persistent disk that survives restarts.
3. App Settings as a managed secret store.
4. VNet integration with NAT-based outbound (required for Compute outbound to Anthropic / GitHub).

AWS and GCP were evaluated; each lacks at least one of these primitives in a single managed service. See [FAQ → "Why Azure only?"](./FAQ.md#why-azure-only-will-you-support-aws-or-gcp).

## Dependencies

| Package | Purpose | Notes |
|---|---|---|
| `express` | HTTP routing | The only non-Azure runtime dependency. |
| `@azure/identity` | Managed identity → ARM credentials | `DefaultAzureCredential` chain. |
| `@azure/arm-compute` | VM lifecycle, disks | Used in `azure/vm.js`, `azure/uninstall.js`. |
| `@azure/arm-network` | VNets, NICs, NSGs, NATs, public IPs | Used in `azure/provision.js`, `azure/discovery.js`. |
| `@azure/arm-appservice` | App Settings read/write, self-update | Used in `azure/app-settings.js`, `azure/self-update.js`. |
| `@azure/arm-resources` | Generic resource enumeration | Used by the Environment & discovery view and the Uninstall sweep. |
| `@anthropic-ai/sdk` | Anthropic SDK | Used for the bundled pricing-verification path. Agents themselves call Anthropic via the Claude Code CLI. |

**Zero database-layer dependencies.** No ORM, no migration tooling, no connection pool. State lives in JSONL files on `/home/data/`.

## Code structure

```
codelegion/
├── index.js              Express entrypoint, route registration, boot sequence.
├── config.js             Env loader + missing-config diagnostics.
├── state.js              /home/data/flow1.json persistence (setup wizard).
├── config.json           Fleet caps, idle timeouts, default VM sizes.
├── pricing.json          Bundled Anthropic rates ($/MTok per model).
│
├── azure/                ARM clients, discovery, network provisioning,
│                         App Settings, VM lifecycle, uninstall.
├── flow1/                Setup wizard — checks, runner, routes, fixers.
├── flow2/                Webhook, cost, logs, activity, secrets endpoint,
│                         VM list, retirement sweep, reconcile loop,
│                         fleet pause/resume.
├── github/               JWT mint + installation token, Contents API,
│                         install probe, PEM normalisation.
├── anthropic/            Pricing loader (bundled + env override).
├── ui/                   Render entrypoint, per-section templates,
│                         shared common helpers, inline browser script.
├── auth/                 Implementation plan for dashboard auth (TODO).
├── scripts/              Operator helpers (release.sh).
├── scripts-static/       Agent shell scripts served at /scripts/*.
├── repo-template/        Files injected into target repos at setup.
├── docs/                 FAQ, stakeholder overview, this file.
└── .github/workflows/    auto-version.yml + release.yml.
```

## Build, release, deployment

- **No build step on the controller.** Node 24 runs the ES-module source directly.
- **Auto-versioning** — `.github/workflows/auto-version.yml` runs on every push to `main`. It bumps `package.json` patch, commits as `release: vX.Y.Z`, tags, and creates a GitHub Release with auto-generated notes. The `release:` prefix skips the workflow's own commit.
- **Release workflow** — `.github/workflows/release.yml` fires on tag push (manual minor/major bumps via `scripts/release.sh`) and creates the corresponding GitHub Release.
- **Deployment** — three paths (see [SETUP.md → Step 3](../SETUP.md#step-3--deploy-this-repository)): External Git in Deployment Center (recommended), GitHub Actions, or manual zip via `az webapp deploy`.
- **Update path** — the dashboard footer surfaces an *Update available* pill (lazy-fetched from GitHub Releases). The Update button triggers Azure to pull from the configured external-git remote.

## Storage model

| Surface | Location | Format |
|---|---|---|
| Setup wizard state | `/home/data/flow1.json` | JSON |
| Cost log | `/home/data/cost.jsonl` | JSONL, append-only |
| Per-VM activity | `/home/data/activity/<vm>.jsonl` | JSONL, append-only |
| Per-VM raw log | `/home/data/logs/<vm>.log` | Plain text, append-only |
| Fleet pause flag | `/home/data/fleet-pause.json` | JSON |
| Secrets | App Service Application settings | (encrypted at rest by Azure) |
| In-memory caches | Process memory | Repopulated from disk on restart |

## LLM integration

- **Model routing** is label-driven: `model:haiku` for trivial fixes, `model:sonnet` for standard work, `model:opus` for hard problems. Default when no label is present: `sonnet`.
- **Agents call Claude Code directly.** The CLI ships with each VM via `npm install -g @anthropic-ai/claude-code` in cloud-init. Invocation: `claude --dangerously-skip-permissions --model <id> --max-turns 100 --output-format stream-json --verbose -p "<task-prompt>"`.
- **Streaming JSON** is parsed by the agent shell to extract per-event `usage` (input / output / cache-creation / cache-read tokens) and reported back to the controller via `POST /cost/report`.
- **Pricing** is loaded at controller startup from `pricing.json`, optionally overridden by the `PRICING_JSON` App Setting (editable from the dashboard's *Anthropic pricing* row).
- **Per-task cost comment** lands on the issue automatically on task completion: `💰 Task cost: $X.XX — model · tokens · duration`.

## Security primitives

- **GitHub App** with installation tokens. Installation tokens TTL: 1 hour. App private key (PEM) lives only in App Settings; never written to disk, never transmitted to agents.
- **Webhook signature verification** with HMAC-SHA256 using `GH_WEBHOOK_SECRET`.
- **Agent ↔ controller** authenticated via Bearer `REPORT_TOKEN` (Express middleware in `flow2/routes.js`).
- **Branch protection** enforced via the GitHub API during setup (1 review + CODEOWNERS on `main`). Auto-skips on free-plan private repos that don't support the API.
- **Dashboard auth** — not yet implemented in the controller. Recommended interim: Azure App Service Easy Auth. Design plan: [`auth/IMPLEMENTATION-PLAN.md`](../auth/IMPLEMENTATION-PLAN.md).
- **Claim race resolution** — lexicographic tiebreak on `agent:<name>` labels avoids double-claims without distributed locking (see `scripts-static/agent-loop.sh`).

## Code statistics

| Area | Lines of code |
|---|---|
| `azure/` | 1,090 |
| `flow2/` | 1,189 |
| `ui/` | 1,505 |
| `flow1/` | 740 |
| `github/` | 581 |
| `scripts-static/` (bash) | 681 |
| `anthropic/` | 52 |
| **Total controller source** | **~5,800** (excluding `repo-template/`) |
| Total repository (incl. docs, configs) | ~10,550 lines |

Single-purpose modules, no abstraction layers for hypothetical futures. The largest file is `flow2/routes.js` at ~430 lines; the average source file is ~150 lines.

---

## Development timeline

Recent feature work — from the v2.1.8 production state through v2.1.21 — was implemented in a Claude Code session over four calendar days (2026-05-28 → 2026-06-01). Each user prompt produced one or more commits.

The table below lists every non-bot commit with the prompt that triggered it, the diff size, and an **approximate** cost estimate. **Costs are not measured** — they are derived from output size and Anthropic's published Opus 4 pricing. See [Cost-estimation methodology](#cost-estimation-methodology) for the formula and its limits.

| # | Commit | Date | Prompt (summary) | Files | +/− | Tokens (≈ in / out) | Cost (≈ USD) |
|---|---|---|---|---:|---:|---|---:|
| 1 | `7741471` | 28 May | "Fix both [claim label + bootstrap robustness]; check cleanup orphan NICs; better delete VM to clean everything." | 7 | +199/−54 | 60k / 8k | ~$0.75 |
| 2 | `d93131a` | 29 May | "I need a stop/start for CodeLegion. After flow1 is complete the infrastructure setup section can be part of environment. Flow 2 can be removed from the title." | 7 | +136/−9 | 50k / 6k | ~$0.55 |
| 3 | `ea035ef` | 29 May | "Although onboarding issue exists, it kept being created and new agents assigned." | 2 | +83/−16 | 35k / 4k | ~$0.35 |
| 4 | `8c0acef` | 29 May | "Let's have an uninstall button … three options: clean repo, clean Azure, both. Clean Azure should remove every resource other than web app and its plan." | 5 | +255/−0 | 65k / 9k | ~$0.85 |
| 5 | `bffbf84` | 29 May | (Built the single-password auth implementation chosen from the three-option proposal.) | 8 | +317/−1 | 90k / 12k | ~$1.15 |
| 6 | `a060c2e` | 29 May | "Update README for public release; add SECURITY.md and CONTRIBUTING.md." | 3 | +113/−8 | 40k / 5k | ~$0.45 |
| 7 | `40ac1e3` | 30 May | "Revert the auth changes; preserve them on a feature branch for a clean PR later." | 11 | +10/−330 | 25k / 2k | ~$0.20 |
| 8 | `b5ecbc8` | 31 May | "Optional step in infra setup for auth/VM config/pricing; keep infra closed when env opens; resource counts in env; auth as a TODO with implementation plan." | 5 | +271/−8 | 80k / 10k | ~$1.00 |
| 9 | `04a2e4f` | 31 May | (Same prompt — three optional configuration rows with edit modals.) | 7 | +273/−6 | 75k / 10k | ~$0.95 |
| 10 | `fee5cfc` | 31 May | "Change Anthropic pricing to modal>form; in env and discovery merge the resources into a unified view." | 4 | +123/−57 | 50k / 6k | ~$0.55 |
| 11 | `11b6728` | 31 May | "Double-check agent names are used in UI and on GitHub comments; pricing per issue should be commented on the issue too." | 6 | +96/−14 | 55k / 6k | ~$0.55 |
| 12 | `e589727` | 31 May | "Issues in the UI link to the issue on GitHub." | 5 | +82/−19 | 40k / 5k | ~$0.45 |
| 13 | `5e178ce` | 31 May | "Check/verify/update README and SETUP to show current state. Make them professional and avoid POC-looking." | 2 | +299/−205 | 70k / 9k | ~$0.85 |
| 14 | `6a07a2a` | 31 May | "Add an FAQ about the project, include technical questions." | 3 | +332/−0 | 60k / 8k | ~$0.75 |
| 15 | `99f92a2` | 1 Jun | "Move FAQ into a folder (best structure) and add a professional high-level presentation for stakeholders." | 5 | +211/−6 | 65k / 9k | ~$0.85 |
| — | (bot) | — | 13 × `release:` patch bumps (auto-generated, no LLM cost). | — | — | — | — |

**Session-level approximate totals**

- Substantive commits: **15**
- Diff total: **+3,000 / −733** lines
- Estimated input tokens (with prompt caching): **~860 k**
- Estimated output tokens: **~108 k**
- **Estimated session cost: ~US$9–11** for the entire feature pass.

For context: the same set of changes done by a senior engineer at industry-average loaded cost (~$120/hr) would represent 15–25 hours of work, i.e. ~$1,800–$3,000. The LLM-assisted path traded that engineer-time cost for the much smaller token cost above, plus the reviewer's time on each PR.

---

## Cost-estimation methodology

Token counts and dollar figures in the timeline above are **estimates**, not measurements. The controller currently has no instrumentation hook for the Anthropic-side traffic of its own development sessions (it does instrument *agent* traffic — that's the cost data that appears on issues and in the dashboard).

**Estimation formula**

For each substantive commit:

1. **Output tokens** ≈ characters in the diff (added + removed lines × average 35 chars/line) ÷ 4 chars/token, plus ~500 tokens for the commit message and surrounding conversation reply.
2. **Input tokens** ≈ characters of files read by the assistant via `Read` / `Grep` / `Bash` plus cumulative conversation context. With Claude Code's prompt caching enabled (which it is by default), 80–90 % of input is served from the cache at the discounted rate.
3. **Pricing** (Anthropic Opus 4 family, published rates):
   - Input: $15 / million tokens
   - Cache read: $1.50 / million tokens
   - Cache write (5-minute TTL): $18.75 / million tokens
   - Output: $75 / million tokens
4. **Per-commit cost** = (new input × $15 + cache reads × $1.50 + output × $75) ÷ 1 000 000, rounded to the nearest 5¢.

**Why this is only approximate**

- The session also included exploratory turns (questions, analyses, plan proposals) that did not end in a commit; those tokens are not in the per-commit table but contribute to the session-level total.
- Cache hit rates vary by turn — early turns write more cache; later turns hit more cache. The 80–90% assumption is a rough average.
- The diff-size heuristic underestimates context-heavy turns (those that read many files before changing few lines) and overestimates pure-deletion turns (`40ac1e3` revert).
- Anthropic pricing assumptions are based on publicly listed rates at the time of writing.

**For exact figures**

Anthropic's API console exposes per-key usage and spend. A user with the same Anthropic key used during this session can pull a precise tally from there.
