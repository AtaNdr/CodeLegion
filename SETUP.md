# Setup guide

Three steps. About 15 minutes for someone familiar with Azure App Service.

---

## Contents

- [Prerequisites](#prerequisites)
- [Step 1 — Anthropic API key](#step-1--anthropic-api-key)
- [Step 2 — Azure Web App + outbound networking](#step-2--azure-web-app--outbound-networking)
- [Step 3 — Deploy the repo](#step-3--deploy-the-repo)
- [Walk the setup wizard](#walk-the-setup-wizard)
- [GitHub App creation](#github-app-creation)
- [First run — automatic onboarding](#first-run--automatic-onboarding)
- [Verify it works](#verify-it-works)
- [Day-to-day operations](#day-to-day-operations)
- [Versions and updates](#versions-and-updates)
- [Uninstalling](#uninstalling)
- [Documentation](./docs/) — landing page, FAQ, stakeholder briefing

---

## Prerequisites

- An Azure subscription with rights to create resources in a resource group.
- A GitHub account and a target repository.
- *Optional:* a paid GitHub plan if your target repo is private and you want branch protection (free private repos can't have it).

## Step 1 — Anthropic API key

[console.anthropic.com](https://console.anthropic.com/) → **API keys** → **Create**. Copy the `sk-ant-…` value; configure billing. You'll paste it into the setup wizard.

## Step 2 — Azure Web App + outbound networking

Azure retired default outbound access for new resources, so the Web App needs explicit egress. In the Azure portal:

1. **Resource group** (e.g. `codelegion-rg`) in your nearest region.
2. **Web App** in that RG. Runtime **Node 24 LTS** on Linux. Plan **B1** (~$13/mo). F1 free works for testing but its 60 CPU-min/day cap will hit you during setup.
3. **Networking:**
   - **VNet** in the same RG. Address space `10.0.0.0/16`. One subnet: `webapp` (`10.0.0.0/24`), delegated to **Microsoft.Web/serverFarms**. (CodeLegion adds the `agents` subnet itself in the wizard.)
   - **Public IP**, Standard SKU, Static, IPv4.
   - **NAT gateway** in the same region. Associate the Public IP with it. Associate the `webapp` subnet with it.
   - Web App → **Networking → VNet integration** → connect to `<vnet>/webapp`.
   - Verify outbound from the Web App's Kudu SSH: `curl -sI https://api.anthropic.com/v1/models` should return `200` or `401`, not a timeout.
4. **Managed identity:** Web App → **Identity** → System assigned → **On**.
5. **RBAC:** Resource group → **Access control (IAM)** → add **Contributor** to that managed identity.
6. **App Setting:** add `AZURE_SUBSCRIPTION_ID` = your subscription ID.
7. **Startup command:** Configuration → General settings → `node index.js`.

CodeLegion adopts your VNet, NAT gateway, and Public IP — it only adds the `agents` subnet. No duplicates.

> **Dashboard access control.** The `/status` page renders sensitive data (webhook secret, admin token). There's no built-in password gate yet — see [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md). Before exposing publicly, enable **App Service Authentication (Easy Auth)** on the Web App. `/webhook` and `/agent/*` aren't affected; GitHub and the agent VMs call them with their own signed credentials.

## Step 3 — Deploy the repo

Three options.

**(a) External Git (recommended)** — Web App → **Deployment Center** → Source **External Git** → repo `https://github.com/AtaNdr/CodeLegion`, branch `main`, Save. ~2 minutes. The dashboard's **Update** button uses this same hook later.

**(b) GitHub Actions** — if you forked, configure a publish workflow with the Deployment Center's publish profile.

**(c) Manual zip:**

```bash
cd /path/to/CodeLegion
zip -r ../codelegion.zip . -x "node_modules/*" ".git/*"
az webapp deploy --resource-group codelegion-rg --name <webapp-name> --src-path ../codelegion.zip --type zip
```

---

## Walk the setup wizard

Open `https://<your-webapp>.azurewebsites.net/status`. The **Infrastructure setup** card is at the top. Click **Run all** — most checks will be red on first pass. Work top to bottom, clicking **Fix** (or **Upload key**, **Configure App**) on each red row. Checks auto-reverify in a few seconds.

| Check | Action |
|---|---|
| **Subscription accessible** | Green if `AZURE_SUBSCRIPTION_ID` is set correctly. |
| **Resource group** | Auto-detected. |
| **Network (vnet · agents subnet · NSG · NAT)** | **Fix** adopts your VNet/NAT/IP and creates the `agents` subnet in a free `/24`. ~30 s. |
| **Anthropic key valid** | **Upload key** — paste `sk-ant-…`. Validated via `GET /v1/models`. |
| **GitHub App + repo access** | **Configure App** — see [GitHub App creation](#github-app-creation). |
| **Repo template installed** | **Fix** — pushes the contract files (CLAUDE.md and friends) into your target repo. |
| **GitHub labels** | **Fix** — creates the required issue labels. |
| **Branch protection (main)** | **Fix** — 1 review + CODEOWNERS. Auto-skips on free-plan private repos. |

When all required rows are green, the header reports **Setup complete**.

Below them are three **optional configuration rows**, editable at any time:

- **Dashboard authentication** — links to the implementation plan (TODO).
- **VM sizes per model** — `Edit` sets `VM_SIZE_HAIKU/SONNET/OPUS` App Settings; new spins use the new sizes.
- **Anthropic pricing** — `Edit` opens a per-model form. Saves to `PRICING_JSON` and applies immediately. **Clear override** reverts to the bundled rates.

## GitHub App creation

Open **Configure App** in the wizard first — keep the modal open so the webhook URL and secret are visible to paste.

1. GitHub → your settings → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. Fill in:
   - **Name** — anything memorable.
   - **Homepage URL** — your Web App URL.
   - **Webhook URL** / **Webhook secret** — paste from the wizard.
   - **Permissions — Repository:** Contents, Issues, Pull requests, Administration → all **Read & write**. Metadata stays **Read** (default).
   - **Subscribe to events:** Issues, Issue comment, Pull request, Pull request review. (Pull-request-review is what lets the controller re-queue an issue when you request changes.)
3. Create. Note the **App ID**. Generate and download a `.pem` private key.
4. Install on your target repo (**Install App** tab). Note the **Installation ID** from `…/installations/<ID>`.
5. Back in the wizard modal: paste App ID, Installation ID, repo owner, repo name, and the PEM contents. **Save**.

### Troubleshooting permissions

If a Fix returns 403, GitHub didn't apply newly-added permissions to the existing installation. In order:

1. App settings → Permissions & events → set the missing permission → **Save changes**.
2. **github.com/settings/installations** (or `…/organizations/<org>/settings/installations` for org installs) → **Configure** → click the yellow **Review and accept new permissions** banner.
3. For **org installs**, an org owner must accept. Until then, 403 persists.

Re-click Fix. The cached installation token is refreshed automatically.

## First run — automatic onboarding

The injected `CONTEXT.md` / `ARCHITECTURE.md` / `DESIGN.md` ship with an empty-placeholder marker, and `CLAUDE.md` halts regular work until they're filled. When **Inject / update repo files** runs, the controller creates an `agent:onboarding` issue itself. An agent claims it, reads your repo, and opens a PR titled **"Initial CodeLegion context"**. **Review and merge that PR** to unblock regular work — once per repo.

To skip it: fill the three files yourself (remove the `<!-- explorer: empty -->` line from each) before injecting.

## Verify it works

1. Open an issue using the **Agent Task** template with the `agent-ready` label. Default model is `sonnet`; add `model:haiku` or `model:opus` to route differently.
2. Within ~3 minutes a VM is running and the Fleet section shows it with the agent's name and emoji.
3. The agent posts a decision comment immediately on claim: `implement directly`, `standardize and implement`, `propose triage` (waits for `agent:approved`), or `blocked`.
4. The agent writes tests against each acceptance criterion and opens a PR mapping criteria to tests. A cost-summary comment lands on the issue on completion.

If something stalls, the **Orchestrator** card shows the last reconcile run: unclaimed issues, alive/free counts, active assignments. **Reconcile now** runs on demand; **History** shows the last 50 cycles.

Sanity checks:

- `/health` returns `{"ok": true}`.
- App Settings include `ANTHROPIC_API_KEY`, `GH_APP_ID`, `GH_APP_PRIVATE_KEY`, `GH_INSTALLATION_ID`, `GH_REPO_OWNER`, `GH_REPO_NAME`, `REPORT_TOKEN`, `GH_WEBHOOK_SECRET`.
- Footer version matches the latest GitHub tag.

## Day-to-day operations

All controls live on the `/status` dashboard.

| Action | Where |
|---|---|
| **Stop / Start fleet** | Fleet header. Stop halts reconcile + deallocates every running agent. Persists across restarts. |
| **Wake all / Sleep all** · **Force-create** | Fleet header. |
| **Per-VM** Log · Timeline · Force sync · Wake/Sleep · Delete | Per agent card. |
| **Reconcile now** · **History** | Orchestrator card. |
| **Cleanup orphan resources** | Environment & discovery. Sweeps failed VMs, orphan NICs (which hold subnet IPs), orphan disks. |
| **Uninstall** | Environment & discovery. Repo files / Azure resources / both. |
| **Edit VM sizes** · **Edit pricing** | Infrastructure setup → the corresponding row → **Edit**. |
| **Jump to issue** | Click any `#N`. |

Auto-refresh is fleet-only (every 30 s). The rest of the page stays stable.

## Versions and updates

CodeLegion uses [SemVer](https://semver.org/). Versions surface in three places:

- **Dashboard footer** — current version, with an *Update available* pill when newer exists. *(Private source repos need an `UPDATE_TOKEN` App Setting — a fine-grained GitHub PAT with `metadata:read` on the source repo — for the GitHub Releases probe to succeed.)*
- **Azure App Setting `CODELEGION_VERSION`** — published on each boot when changed.
- **`GET /api/version`** — JSON with `{version, commit, buildDate, update}`.

Releases: https://github.com/AtaNdr/CodeLegion/releases.

Every push to `main` auto-bumps the patch version and cuts a Release via `.github/workflows/auto-version.yml`. For a minor or major bump:

```bash
scripts/release.sh minor   # 2.1.x → 2.2.0
scripts/release.sh major   # 2.x.x → 3.0.0
git push && git push --tags
```

**Updating a deployment:** click **Update now** in the dashboard footer when the pill appears, or **Update** anytime. External-git deployments pull `main` and restart automatically; zip deployments need a fresh zip pushed first.

**Agent VMs adopt updates automatically.** Each idle cycle they re-fetch their scripts and re-exec `agent-loop.sh` if it changed (never mid-task). VMs created before the self-update feature existed need to be deleted (not Sleeped) once.

## Uninstalling

Environment & discovery → **Uninstall**. Three scopes, typed confirmation:

- **Clean repo files** — removes the CodeLegion templates (CLAUDE.md, DO_NOT_TOUCH.md, ISSUE_TEMPLATEs, …). Your code, issues, and PRs are untouched.
- **Clean Azure resources** — deletes every resource in the RG except this Web App and its plan. Pauses the fleet first and leaves it paused.
- **Both** — sequential.

To remove CodeLegion entirely:

1. Run **Uninstall → Both**.
2. Delete the Web App and its plan via the Azure portal.
3. Uninstall the GitHub App from your repo.
4. Revoke the Anthropic API key.

No state outside the resource group.
