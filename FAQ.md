# Frequently asked questions

Grouped by topic. For step-by-step deployment, see [`SETUP.md`](./SETUP.md); for the architecture spec, see [`PLAN.md`](./PLAN.md).

---

## Contents

- [The project](#the-project)
- [Deployment](#deployment)
- [Operations](#operations)
- [Security](#security)
- [Architecture and internals](#architecture-and-internals)
- [Cost and billing](#cost-and-billing)
- [Updates and maintenance](#updates-and-maintenance)
- [Behaviour and limitations](#behaviour-and-limitations)

---

## The project

### What is CodeLegion?

A self-orchestrating fleet of Claude Code agents that picks up labeled GitHub issues, writes code and tests, and opens pull requests for human review. The fleet runs as a single Azure Web App that provisions and operates everything else.

### How is this different from GitHub Copilot or Cursor?

Copilot and Cursor are interactive coding assistants used inside an IDE by a human developer. CodeLegion is unattended: you label an issue and walk away. It runs Claude Code in non-interactive mode on a temporary VM, opens a PR, and shuts the VM down. The human's involvement is reviewing the PR.

### How is it different from running Claude Code locally on every issue?

Three things:

1. **Concurrency.** Multiple agents can work in parallel on different issues, each on its own VM.
2. **Determinism.** Every agent starts from a clean checkout with the same contract files (`CLAUDE.md`, `COMMENT_STYLE.md`, etc.) injected into the repo. There's no "works on my machine" drift.
3. **Audit trail.** Every state transition, plan, and cost is recorded — both on the dashboard and as comments on the GitHub issue itself.

### Who is this for?

Small teams (and individuals) who want unattended automation for a backlog of well-scoped issues — bug fixes, dependency bumps, refactors, test additions — without paying for a SaaS bot.

### Is it production-ready?

Active and used in production on the maintainer's own projects. Single-instance by design (see [Architecture](#architecture-and-internals)). Some operator features are still in flight — see the project [Roadmap in the README](./README.md#roadmap).

---

## Deployment

### Why Azure only? Will you support AWS or GCP?

Azure App Service has a sweet combination of features that makes the single-Web-App design work cleanly: a managed identity that can drive ARM, a persistent `/home/data` disk that survives restarts, App Settings as the secret store, and VNet integration with NAT-based outbound. AWS App Runner / Elastic Beanstalk / Lambda each lack at least one of those primitives. AWS and GCP support are **not** on the roadmap.

### Do I need a paid Anthropic plan?

No — the standard Anthropic API with billing enabled is sufficient. Token cost is variable; the dashboard tracks per-task and per-month spend.

### Do I need a paid GitHub plan?

Only if your target repository is **private and you want branch protection**. GitHub's branch protection feature is not available on free-plan private repos. CodeLegion's branch-protection check auto-skips with a yellow status in that case; setup still completes.

### Can I deploy without a NAT gateway? Public IPs cost money.

Not currently. The agent VMs need outbound internet to reach GitHub and Anthropic, and Azure retired default outbound access for new resources. A NAT gateway is the supported path. An alternative would be a more expensive VPN gateway or attaching public IPs directly to each VM, both of which are worse trade-offs.

### Can I use my own VM family or region?

Region: yes — the wizard adopts whatever region your resource group is in. VM family: yes — use the **Edit** action on the *VM sizes per model* row in Infrastructure setup. It sets `VM_SIZE_<MODEL>` App Settings; new spins use the new sizes immediately.

### Can I deploy CodeLegion from a fork?

Yes. The auto-version workflow is triggered by pushes to your own `main`, so your fork will produce its own versioned releases. Update the external-git URL in Deployment Center to point at your fork.

---

## Operations

### How do I know it's working?

Open `/status`. The Fleet section shows every agent VM and its current state. If the Orchestrator card shows `unclaimedCount: 0` and the agent cards transition through `idle → claimed → planning → coding → completed`, the system is healthy.

### What happens if the controller restarts mid-task?

The controller is stateless beyond `/home/data` (cost log, activity timelines, setup state, pause flag). When App Service restarts, in-memory caches are dropped but reconcile picks up where it left off within ~45 seconds. Agents on the VMs continue running; their next status push refills the controller's live cache.

### What happens if an agent VM dies mid-task?

The issue retains the agent's claim label, so reconcile won't re-dispatch it. If the agent had opened a PR, that PR persists (review or close it manually). If it hadn't, the issue stays "claimed" by a now-dead VM. **Remediation:** delete the dead VM from the dashboard (this clears the way), and remove the claim label manually so the issue returns to the unclaimed pool.

### How do I cap spend?

Three knobs, all in `config.json` (override via App Settings will land with the feature-flags work — see Roadmap):

- `fleet.maxAgentsTotal` — hard cap on alive VMs.
- `fleet.maxAgentsPerModel.{haiku,sonnet,opus}` — per-model caps.
- `budget.issueTimeBudget` / `issueTokenBudget` / `maxTurnsPerIssue` — per-task limits enforced by the agent shell.

For an immediate hard stop, click **Stop fleet** on the dashboard. Reconcile halts, every running VM deallocates, and no new VMs spin until **Start fleet** is clicked.

### Can I run multiple repositories with one controller?

No. **One Web App = one fleet = one GitHub repo** by design. Multi-repo would complicate the secret model and the per-VM cloud-init, and is out of scope. Run a second Web App for a second repo.

### Can I see what an agent is doing right now?

Yes. Each agent card on the dashboard shows the current state (`idle` / `claimed` / `planning` / `coding`), the issue it's working on, and a one-line summary that the agent updates on every state change. Click **Log** for the agent's bash log, or **Timeline** for the full state history.

### What does "10 idle minutes" mean?

The agent shell measures wall-clock time since the last successful claim. If it hits ten minutes without claiming new work, the agent calls `/agent/deallocate` and the VM goes to the stopped state. Configurable via `fleet.idleTimeoutSeconds` in `config.json`.

### Can two agents claim the same issue?

No. The claim is implemented as a GitHub label (`agent:<name>`). After a claim, the agent waits three seconds for any concurrent racers, then queries the issue's labels; the lexicographically smallest claim label wins and the others yield. The winner never yields, so the issue is never orphaned by a race.

---

## Security

### Is the dashboard exposed to the internet?

By default, yes — the Web App is reachable at its `*.azurewebsites.net` URL with no authentication. **Before exposing publicly, gate it with Azure App Service Easy Auth** (Authentication → Add identity provider → Microsoft / GitHub / Google / OIDC). A built-in password gate is in active design — see [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md).

### Where are secrets stored?

Five App Settings on the Web App: `ANTHROPIC_API_KEY`, `GH_APP_PRIVATE_KEY` (the PEM), `GH_APP_ID`, `GH_INSTALLATION_ID`, `GH_WEBHOOK_SECRET`, `REPORT_TOKEN`. No Key Vault, no storage account. App Settings are encrypted at rest by Azure and accessible only to identities with the right RBAC on the Web App.

### Why does the agent need `--dangerously-skip-permissions`?

Claude Code's default mode prompts the user before every file write and command execution. An unattended agent cannot answer prompts, so it runs with `--dangerously-skip-permissions`. The guardrails are:

- The agent runs on a throwaway VM with no Azure access and no production secrets.
- Hard rules in `repo-template/CLAUDE.md` and `repo-template/DO_NOT_TOUCH.md` define what the agent must not touch.
- The agent can only push to **its own feature branch** — it cannot push to `main` (branch protection enforces review).
- Every output is reviewed by a human before merging.

### Can the agent push to my main branch?

Not if branch protection is set up correctly. The wizard's *Branch protection* check enforces 1 review + CODEOWNERS on `main`. If branch protection is unavailable on your plan, an agent technically could; do not deploy CodeLegion on a repository where you cannot enforce branch protection if that matters to you.

### What can an agent do to my codebase?

Anything an unmonitored fast junior developer with full repo write access could do — except merge to main (assuming branch protection). It will read every file, write to a feature branch, and open a PR. It will not delete branches, force-push, modify the GitHub App's configuration, or read secrets that aren't in the repo.

### How is `REPORT_TOKEN` distributed to VMs? Isn't it then leaked?

`REPORT_TOKEN` ships in each VM's cloud-init script. Anyone with `Microsoft.Compute/virtualMachines/read` on the resource group can read it. The token's authority is narrowly scoped — `/agent/log`, `/agent/status`, `/agent/sync`, `/agent/secrets` — and exposing it does not give access to ARM, Anthropic, or your GitHub App's PEM. If you rotate it, you'll need to recycle the fleet (delete and let reconcile re-spin) so VMs pick up the new value.

### How does the controller authenticate to GitHub?

As a GitHub App. The app's private key (PEM) is stored as an App Setting on the Web App. The controller mints a JWT, exchanges it for a short-lived installation access token (1-hour TTL), caches that token in-process, and uses it for all GitHub REST and GraphQL calls. The PEM never leaves the controller; agents do not see it.

---

## Architecture and internals

### Why a Web App + agent VMs instead of GitHub Actions / Lambda / Cloud Run?

Agents need:

1. A long-lived process (Claude Code sessions can run 90 minutes).
2. Outbound access to Anthropic.
3. A POSIX shell with `git`, `gh`, and `claude` available.
4. Per-agent isolation so a misbehaving session can't affect siblings.

VMs check all four with minimum operational overhead. Functions and short-lived containers either time out or can't isolate cleanly. GitHub Actions runners have execution limits and lack the long-running shell semantics we need.

### Why does each agent run on a separate VM?

Isolation, predictability, and cost. Each issue gets a fresh checkout, a clean process tree, and its own VM tags so the controller can find it by purpose. The 10-minute idle timeout caps the cost of an agent that's done; the VM is gone before the next billing minute is significant.

### Why doesn't CodeLegion use a database?

The state surface is small (cost log, activity timelines, raw VM logs, setup state, pause flag) and naturally append-only. JSONL files on `/home/data` give us encrypted-at-rest storage that survives restarts, requires zero operational care, and trivially round-trips through a single Express process. Adding a database would mean introducing connection pooling, migrations, and a backup story for no real gain at this scale.

### What happens during an App Service restart?

The Express process exits. App Service's runtime relaunches `node index.js` in a few seconds. On restart:

- App Settings are re-read.
- `/home/data` is present and unchanged.
- The reconcile loop is rescheduled (first run after 10s, then every 45s).
- The retirement sweep is rescheduled (first run after 60s, then every 6h).
- The agent VMs continue running; their next status push refills the controller's in-memory `liveStatus` map.
- Any in-flight assignment hint that the controller had not yet seen the agent claim is lost. Reconcile re-assigns it on the next tick.

### How does reconcile avoid races between concurrent runs?

Two mechanisms:

- An in-process `_running` flag — if a reconcile is already executing, subsequent invocations no-op.
- The 90-second hint TTL — once reconcile sets an assignment, it holds for 90 seconds before re-offering. The agent's transition to `claimed` clears the hint immediately.

Cross-process races (webhook-triggered reconcile vs interval-triggered) are bounded by the single-instance design.

### Why is the dashboard's auto-refresh per-section?

The full-page reload that the old version did flickered the entire page every 30 seconds, reset scroll position, and clobbered any `<details>` the operator was reading. The new design polls only the Fleet fragment (`GET /fleet/section`) and `innerHTML`-swaps a stable container. Everything else stays untouched between explicit user actions.

### How are agent shell scripts kept current on long-lived VMs?

Each idle cycle, the agent re-fetches `/scripts/agent-loop.sh` and friends from the controller. If `agent-loop.sh` changed, the agent re-execs into the new version (never mid-task). VMs created before the self-update feature existed cannot pull it; delete them and let reconcile spin replacements.

### What's the call graph for "issue opened → PR open"?

```
github.com → POST /webhook
            verify HMAC
            return 202
            → reconcile() (fire-and-forget)
                listUnclaimedIssues() → GitHub
                listAgents() → ARM
                allStatus() → in-memory
                ensureCapacity() → ARM (start/spin VM)
                hints.set(vm, {issue, ...})

VM (agent-loop.sh) → GET /agent/next-task?vm=...
                  ← {issue, onboarding}
                    refresh_token() → GET /agent/secrets
                    gh issue edit --add-label "agent:<name>"
                    write_status "claimed" → POST /agent/status
                    claude --dangerously-skip-permissions ...
                    write_status "completed" → POST /agent/status
                    report_cost → POST /cost/report
                       → commentCostOnIssue(record) (fire-and-forget)
                       → ghFetch POST /repos/.../issues/N/comments
```

### How is per-task cost calculated?

The agent shell parses Claude Code's `--output-format stream-json` output for `usage` events and sums `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. The numbers are POSTed to `/cost/report`. The controller multiplies each bucket by the per-million-token rate in `pricing.json` (or its override) and stores the result.

---

## Cost and billing

### How accurate is the bundled `pricing.json`?

Accurate as of its `_lastVerified` date (shown in the dashboard's Anthropic pricing row). When Anthropic changes prices, you have two options:

1. Wait for the next CodeLegion release that updates `pricing.json`.
2. Use the dashboard's *Anthropic pricing* row → **Edit** to set a `PRICING_JSON` App Setting override. Takes effect immediately.

### Why does my dashboard say "Pricing may be stale"?

Because `_lastVerified` in the loaded `pricing.json` is more than 30 days old. Use the dashboard's Anthropic pricing row to override or upgrade CodeLegion to pick up the latest bundled file.

### Is the cost on the issue the full cost of the issue?

No. The cost on the issue is the cost of the agent's last Claude invocation that completed for that issue. If the agent timed out, restarted, or re-opened the PR after revisions, each successful invocation posts its own cost comment.

### Where can I see total spend?

The Cost section of the dashboard shows today and month-to-date totals, broken down by model, plus a per-task table. The same data is in `/home/data/cost.jsonl` as JSONL — one record per task.

---

## Updates and maintenance

### How do I update an existing deployment?

Click **Update now** in the dashboard footer (visible only when a newer release exists) or **Update** at any time. If you deployed via external git, Azure pulls the latest from `main` and restarts. If you deployed via zip, the Update button just restarts the App Service — push a new zip first.

### How do agent VMs update?

They self-update: each idle poll cycle, the agent re-fetches its scripts from `/scripts/*` on the controller and re-execs `agent-loop.sh` if it changed. Self-update never runs mid-task, so a re-exec cannot interrupt an in-flight issue. VMs created before self-update existed cannot pull it — delete them and let reconcile re-spin.

### How do I downgrade?

Push the older commit / tag through whatever deployment path you set up in [Step 3](./SETUP.md#step-3--deploy-this-repository). Agent shell scripts are served from the controller, so downgrading also downgrades the agents on the next self-update cycle.

### How do I rotate the Anthropic key?

1. Generate a new key at `console.anthropic.com`.
2. Update `ANTHROPIC_API_KEY` in App Settings.
3. App Service restarts automatically.
4. Existing agent VMs cache the old key for up to 45 minutes (the `/agent/secrets` cache TTL). For an immediate rotation, click **Sleep all** then **Wake all** on the dashboard so the next refresh-gh-token cycle picks up the new value.

### How do I rotate `REPORT_TOKEN`?

1. Update `REPORT_TOKEN` in App Settings. App Service restarts.
2. Existing VMs were issued the *old* token in cloud-init and will see 401s on every callback. Their boot heartbeat will fail and they'll self-deallocate.
3. Delete the deallocated VMs from the dashboard.
4. Next reconcile will spin fresh VMs with the new token in their cloud-init.

### How do I rotate the GitHub App PEM?

1. Generate a new private key from the App's settings page on github.com.
2. Update `GH_APP_PRIVATE_KEY` in App Settings.
3. App Service restarts; the controller mints a new installation token on first use. No VM action needed (VMs never see the PEM).

---

## Behaviour and limitations

### What kinds of issues should I label `agent-ready`?

Issues that are scoped, testable, and would take a competent developer between 15 minutes and ~3 hours. The agent excels at: bug fixes with a clear repro, dependency bumps, adding tests for existing behaviour, mechanical refactors, small feature additions whose acceptance criteria can be stated as a checklist. It struggles with: architectural rewrites, anything requiring product judgement, work blocked on external systems.

### What is a "triage proposal"?

When an agent claims an issue, it reads the issue body and either implements directly, *standardises and implements* (restructures a clear-but-unstructured issue into the standard template and proceeds), proposes a triage (posts a structured proposal and waits for `agent:approved`), or marks itself blocked. The triage proposal is the agent's way of saying "this needs human judgement before I write code." See `repo-template/CLAUDE.md` for the full decision tree.

### Why does the agent post a "decision" comment on every claim?

For auditability. Every claimed issue gets a single comment opening with `Decision: …` so the reviewer can see at a glance what the agent intends to do *before* it does it. This is the latest moment to intervene cheaply.

### Will the agent close issues?

No. Closing is reserved for humans. The agent comments, labels, and pushes branches; the human merges and the merge closes via `Closes #N` in the PR body. If the agent gives up (idle timeout with no PR), it removes its own claim label so reconcile can re-dispatch.

### What happens if the agent's PR has merge conflicts?

Nothing automatic. A second agent will not pick up the issue (claim labels still apply). Either resolve the conflict yourself or close the PR and remove the claim label so a fresh agent retries.

### What if my repo has a complex build pipeline?

The agent's gates are whatever `repo-template/CLAUDE.md` says they are. By default the agent runs lint / type-check / test before opening a PR; if your project's commands are different, edit your repo's `CONTEXT.md` and the agent reads from there on every task. The contract file model means CodeLegion does not need to know your build system — your repo tells the agent what to run.

### Can I disable a feature I don't want?

Most features are on-by-default and not configurable yet. The roadmap names "configurable feature flags" as in-flight; until then, the dashboard's edit modals for VM sizes and pricing are the only knobs available to operators without redeploying.

### Can the agent see my other repositories?

Only repositories the GitHub App is installed on. CodeLegion does not enumerate or read across installations.

### What if I disagree with the PR?

Request changes on the PR. The agent reads review comments and pushes fixes to the same branch on the next cycle. If the direction is fundamentally wrong, close the PR — the agent does not retry without a new `agent-ready` label.
