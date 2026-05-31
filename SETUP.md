# Setup guide

Deploy CodeLegion to Azure in three steps. Estimated time: ~15 minutes for someone familiar with Azure App Service.

---

## Contents

- [Prerequisites](#prerequisites)
- [Step 1 — Anthropic API key](#step-1--anthropic-api-key)
- [Step 2 — Azure Web App and outbound networking](#step-2--azure-web-app-and-outbound-networking)
- [Step 3 — Deploy this repository](#step-3--deploy-this-repository)
- [Walk the setup wizard](#walk-the-setup-wizard)
- [GitHub App creation](#github-app-creation)
- [First run — automatic onboarding](#first-run--automatic-onboarding)
- [Verify it works](#verify-it-works)
- [Day-to-day operations](#day-to-day-operations)
- [Versions and updates](#versions-and-updates)
- [Uninstalling](#uninstalling)
- [Documentation](./docs/) — FAQ, stakeholder overview

---

## Prerequisites

- An Azure subscription with rights to create resources in a resource group.
- A GitHub account and a target repository where the agents will work.
- Optional: a paid GitHub plan if the target repo is private and you want branch protection (free private repos cannot have branch protection rules).

## Step 1 — Anthropic API key

1. Open [console.anthropic.com](https://console.anthropic.com/) → **API keys** → **Create key**.
2. Copy the value (`sk-ant-...`). It will be pasted into the setup wizard.
3. Configure billing on the key. CodeLegion tracks per-task spend so the cost of each issue is visible in the dashboard and on the issue itself.

## Step 2 — Azure Web App and outbound networking

In the Azure portal:

1. **Create a resource group** (e.g. `codelegion-rg`) in the region closest to you.
2. **Create a Web App** in that resource group:
   - Runtime: **Node 24 LTS** on **Linux**.
   - Plan: **B1** (~$13 / month). F1 free works for testing but the 60 CPU-minute daily cap will trigger during initial setup.
3. **Provision outbound internet for the Web App.** Azure retired default outbound access for new resources, so the Web App cannot reach Anthropic, GitHub, or ARM without explicit egress.
   - Create a **Virtual network** in the same RG. Address space `10.0.0.0/16`. Add a single subnet:
     - `webapp` — `10.0.0.0/24`, delegated to **Microsoft.Web/serverFarms** (required for App Service VNet integration).
   - Leave room for an `agents` subnet; CodeLegion adds it during the wizard.
   - Create a **Public IP** (Standard SKU, Static, IPv4).
   - Create a **NAT gateway** in the same region. Associate the Public IP with it. Associate the `webapp` subnet with it.
   - On the Web App: **Networking → VNet integration** → connect to `<vnet>/webapp`.
   - Verify outbound: open the Web App's Kudu SSH console and run `curl -sI https://api.anthropic.com/v1/models`. Expect `200` or `401`; a timeout means egress is not yet wired correctly.
4. **Enable managed identity** — Web App → **Identity** → System assigned → **On**.
5. **Grant RBAC** — Resource group → **Access control (IAM)** → Add role assignment → **Contributor** → Managed identity → select the Web App's identity. Contributor on the resource group lets CodeLegion manage VMs, networking, and its own App Settings.
6. **Add an App Setting** — Configuration → Application settings → add:
   - `AZURE_SUBSCRIPTION_ID` = your subscription ID (visible on the Azure portal home page).
7. **Set the startup command** — Configuration → General settings → Startup Command: `node index.js`. Save.

CodeLegion adopts your existing VNet, NAT gateway, and Public IP during the wizard — it only adds an `agents` subnet and attaches the same NAT gateway for VM outbound. No duplicate resources are created.

> **Dashboard access control — required before exposing publicly.** The `/status` dashboard renders sensitive data: the webhook secret, repo names, agent identities, and the admin token used by the page to call its own admin endpoints. The built-in password gate is in active design (see [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md)); until it ships, enable **App Service Authentication (Easy Auth)** on the Web App: **Authentication** → **Add identity provider** → Microsoft / GitHub / Google / OIDC. Easy Auth gates `/status` and `/admin/*` behind your tenant's identity. `/webhook` and `/agent/*` are not affected — GitHub and the agent VMs call them with their own signed credentials.

## Step 3 — Deploy this repository

Pick the option that matches your workflow.

### 3a — External git (recommended)

In the Web App → **Deployment Center**:

1. Source: **External Git**.
2. Repository: `https://github.com/AtaNdr/CodeLegion`.
3. Branch: `main`.
4. Save.

Azure pulls the code; deployment completes in about two minutes. The dashboard's **Update** button later uses this same hook to pull new commits.

### 3b — GitHub Actions

If you forked the repository, configure a publish workflow with the publish profile available from the Web App's Deployment Center.

### 3c — Manual zip deploy

```bash
cd /path/to/CodeLegion
zip -r ../codelegion.zip . -x "node_modules/*" ".git/*"
az webapp deploy \
  --resource-group codelegion-rg \
  --name <your-webapp-name> \
  --src-path ../codelegion.zip \
  --type zip
```

---

## Walk the setup wizard

Open `https://<your-webapp>.azurewebsites.net/status`. The **Infrastructure setup** card is at the top. Click **Run all** to execute every check; most will be red on first run.

Click **Fix** (or **Upload key**, **Configure App**) on each red row, top to bottom. After each fix, the check auto-reverifies — give it a few seconds to turn green.

| Check | Action |
|---|---|
| **Subscription accessible** | Green if `AZURE_SUBSCRIPTION_ID` is set correctly. |
| **Resource group** | Auto-detected from the Web App's environment. |
| **Network (vnet · agents subnet · NSG · NAT)** | **Fix** adopts your VNet, NAT, and Public IP from Step 2 and creates the `agents` subnet in a free `/24` inside the VNet. Around 30 seconds. |
| **Anthropic key valid** | **Upload key** — paste your `sk-ant-...`. Validated via `GET /v1/models`. |
| **GitHub App + repo access** | **Configure App** — opens a modal with the webhook URL and webhook secret needed on github.com. See [GitHub App creation](#github-app-creation). |
| **Repo template installed** | **Fix** — pushes the contract files (CLAUDE.md and the rest) to your target repo via the Contents API. Re-run later via **Inject / update repo files** when an upstream contract file changes. |
| **GitHub labels** | **Fix** — creates the required issue labels on the target repo. |
| **Branch protection (main)** | **Fix** — requires one review + CODEOWNERS on `main`. Not available on free-plan private repos; the check auto-skips with a yellow status in that case. |

When all required rows are green, the section header reports **Setup complete**.

Below the required checks are three optional configuration rows. They never block setup completion; each opens an editor you can return to later:

- **Dashboard authentication** — links to the implementation plan (status: planned).
- **VM sizes per model** — `Edit` opens a form with one field per model (haiku / sonnet / opus). Saves to `VM_SIZE_<MODEL>` App Settings; new agent spins use the new sizes.
- **Anthropic pricing** — `Edit` opens a per-model pricing form (input / output / cache read / cache write, in $ per million tokens). Saves to `PRICING_JSON` App Setting and takes effect immediately. **Clear override** reverts to the bundled `pricing.json`.

## GitHub App creation

The **Configure App** button in the setup wizard is the entry point — open it first so the webhook URL and secret are visible to paste.

1. In the wizard, click **Configure App** on the *GitHub App + repo access* row. The top of the modal shows the **Webhook URL** and **Webhook secret** with Copy buttons. Keep the modal open.
2. In a new tab: GitHub → your settings → **Developer settings** → **GitHub Apps** → **New GitHub App**.
3. Fill in the form:
   - **Name** — anything memorable, e.g. `codelegion-<yourorg>`.
   - **Homepage URL** — your Web App URL.
   - **Webhook URL** — paste from the wizard.
   - **Webhook secret** — paste from the wizard.
   - **Permissions — Repository:**
     - Contents: **Read & write**
     - Issues: **Read & write**
     - Pull requests: **Read & write**
     - Metadata: **Read** (auto-selected)
     - Workflows: **Read & write**
     - Administration: **Read & write** — required for branch protection.
   - **Subscribe to events** — Issues, Issue comment, Pull request, Pull request review.
4. Create the App. Note the **App ID** at the top of the App's settings page. Generate a private key and download the `.pem` file.
5. Install the App on your target repository (the App's **Install App** tab). After install, note the **Installation ID** from the URL: `.../installations/<ID>`.
6. Back in the wizard modal: paste App ID, Installation ID, repo owner, repo name, and the contents of the `.pem` file. Click **Save**.

### Troubleshooting GitHub App permissions

If a Fix returns 403, GitHub did not apply newly-added permissions to the existing installation. Check, in order:

1. App settings → Permissions & events → set the missing permission → **Save changes**.
2. Visit **https://github.com/settings/installations** (or `https://github.com/organizations/<org>/settings/installations` for org installs) → **Configure** on your App → click the yellow **Review and accept new permissions** banner at the top.
3. **Organisation installs:** if the App is installed on an org and you are not an org owner, an owner must accept the new permissions. The Fix will continue returning 403 until they do.

Re-click Fix or Run after each step. Both the check and the fix clear the cached installation token so the next attempt uses a token that reflects the new scope.

## First run — automatic onboarding

The injected `CONTEXT.md`, `ARCHITECTURE.md`, and `DESIGN.md` ship with an empty-placeholder marker. The agent contract (`CLAUDE.md`) halts regular work until the markers are removed.

To bootstrap the gate, **the controller creates the onboarding issue itself** when **Inject / update repo files** runs. The issue creation fires a webhook, which spins a sonnet agent. The agent:

1. Claims the `agent:onboarding` issue.
2. Reads the entire repository and writes real CONTEXT / ARCHITECTURE / DESIGN content.
3. Opens a PR titled **"Initial agent fleet context"** (labelled `agent:do-not-pick`).

**Review and merge that PR** to unblock regular work. This is a one-time bootstrap per repository.

To skip it, fill the three files manually (remove the `<!-- explorer: empty -->` line from each) before injecting — the controller then has nothing to do and creates no issue.

## Verify it works

1. Open an issue in your target repo using the **Agent Task** template.
2. Confirm it has the `agent-ready` label. `model:sonnet` is the default; add `model:haiku` (trivial fixes) or `model:opus` (hard problems) only to route differently.
3. The reconcile loop runs every ~45 seconds and is kicked immediately by the GitHub webhook. It lists unclaimed `agent-ready` issues, the fleet's live status, and assigns each issue to a free agent of the matching model — waking a deallocated VM or spinning a new one (within configured caps) if none is free.
4. Within ~3 minutes a VM is running and assigned. The Fleet section on the dashboard shows it, including the agent's chosen name and emoji.
5. After the onboarding PR is merged, subsequent issues are claimed normally. The agent posts a decision comment immediately on claim:
   - `Decision: implement directly` — clear, already in the standard template.
   - `Decision: standardize and implement` — clear intent, restructured into the standard template, proceeds without waiting.
   - `Decision: propose triage` — ambiguous; posts a proposal and waits for `agent:approved`.
   - `Decision: blocked` — needs human input.
6. The agent writes tests against each acceptance criterion, runs the gates, and opens a PR mapping criteria to tests. On task completion, a cost-summary comment lands on the issue (`💰 Task cost: $X.XX — model · tokens · duration`).

If something stalls, the **Orchestrator** card at the top of the Fleet section shows the last reconcile run: unclaimed issues, alive / free agent counts, and active assignments. Click **Reconcile now** to run on demand. **History** surfaces the last 50 cycles.

Confirm the controller is healthy:

- `/health` returns `{"ok": true}`.
- App Settings include `ANTHROPIC_API_KEY`, `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `GH_INSTALLATION_ID`, `GH_REPO_OWNER`, `GH_REPO_NAME`, `REPORT_TOKEN`, `GH_WEBHOOK_SECRET`.
- The footer of `/status` shows a version that matches the latest tag on GitHub.

## Day-to-day operations

| Action | Where |
|---|---|
| **Stop fleet** | Fleet header. Halts reconcile, deallocates every running agent. Persists across controller restarts. |
| **Start fleet** | Fleet header (visible when paused). Resumes reconcile. |
| **Wake all / Sleep all** | Fleet header. Operates the existing fleet without changing capacity. |
| **Force-create** | Fleet header. Spin a specific model on demand. |
| **Per-VM actions** | Per-card — Log, Timeline, Force sync, Wake / Sleep, Delete. |
| **Reconcile now / History** | Orchestrator card. |
| **Cleanup orphan resources** | Environment & discovery. Sweeps failed VMs, orphan NICs (which hold subnet IPs), and orphan disks. |
| **Uninstall** | Environment & discovery. Three scopes — repo files, Azure resources, or both. Typed confirmation. |
| **Edit VM sizes** | Infrastructure setup → VM sizes row → **Edit**. |
| **Edit pricing** | Infrastructure setup → Anthropic pricing row → **Edit**. |
| **Jump to issue on GitHub** | Click any `#N` reference. |

## Versions and updates

CodeLegion uses [SemVer](https://semver.org/). The version comes from `package.json` and is surfaced in three places:

- **Dashboard footer** — current version. When a newer release is available, a yellow *Update available: vX.Y.Z* pill appears alongside the version, lazily fetched from GitHub Releases.
- **Azure portal** — Web App → Configuration → Application settings → `CODELEGION_VERSION`. The controller publishes this on each boot, only when the value has changed (avoiding restart loops).
- **`GET /api/version`** — returns `{version, commit, buildDate, update: {currentVersion, latestVersion, hasUpdate, latestHtmlUrl}}`. Same data the footer uses.

Releases are at https://github.com/AtaNdr/CodeLegion/releases.

### Automatic patch releases

Every push to `main` automatically bumps the patch version and creates a Release via `.github/workflows/auto-version.yml`:

1. Bumps `package.json` patch (e.g. 2.1.5 → 2.1.6).
2. Commits as `release: v2.1.6` (the `release:` prefix prevents the workflow re-firing on its own commit).
3. Tags and pushes.
4. Creates a GitHub Release with auto-generated notes from commits since the previous tag.

### Cutting a minor or major release manually

```bash
# From a clean main branch:
scripts/release.sh minor   # 2.1.x → 2.2.0 (additive changes)
scripts/release.sh major   # 2.x.x → 3.0.0 (breaking changes)
git push && git push --tags
```

The tag push triggers `.github/workflows/release.yml`, which creates the corresponding GitHub Release.

### Updating an existing deployment

Click **Update now** in the dashboard footer (visible only when a newer release exists), or **Update** at any time. If you deployed via external git (option 3a), Azure pulls the latest from `main` and restarts. If you deployed via zip, the Update button just restarts — push a new zip first.

After the deploy, the footer version and `CODELEGION_VERSION` App Setting should match the latest release tag. If the footer still shows the old version after ~2 minutes, the deploy did not take — check Deployment Center.

### How agent VMs adopt updates

The controller serves agent shell scripts at `/scripts/*`. Each VM downloads them once via cloud-init at creation time. Long-lived VMs stay current through:

- **Self-update.** Every idle poll cycle, the agent re-fetches its scripts from the controller and re-execs `agent-loop.sh` if it changed. The self-update never runs mid-task, so a re-exec cannot interrupt an in-flight issue.
- **One-time catch.** A VM created before the self-update feature existed cannot pull it. If an agent misbehaves immediately after an update, delete that VM (not Sleep) from the dashboard. The next issue spins a fresh VM with current scripts.

## Uninstalling

From the dashboard's Environment & discovery card, click **Uninstall**. Three scopes:

- **Clean repo files** — removes the agent-fleet templates from your GitHub repo (CLAUDE.md, DO_NOT_TOUCH.md, ISSUE_TEMPLATEs, …). Issues, PRs, and your own code are untouched.
- **Clean Azure resources** — deletes every resource in the resource group except this Web App and its App Service Plan. Pauses the fleet first; leaves the fleet paused after, so a stale reconcile doesn't spin replacement VMs into a network that no longer exists.
- **Both** — runs both, in sequence.

To remove CodeLegion entirely:

1. Use the **Uninstall** flow with the **Both** scope.
2. Delete the Web App and its plan via the Azure portal (the uninstall preserves these by design).
3. Uninstall the GitHub App from your repo.
4. Revoke the Anthropic API key.

No state persists outside the resource group.
