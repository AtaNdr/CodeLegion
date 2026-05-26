# CodeLegion — Setup

Three steps. Plan ~15 minutes.

> **Prerequisites:** an Azure subscription, a GitHub account, and a target repo where the agents will work.

---

## 1. Create a Claude API key

Go to [console.anthropic.com](https://console.anthropic.com/) → API keys → create one. Copy it; you'll paste it into the setup wizard later. It looks like `sk-ant-...`.

You'll set billing on that key. The CodeLegion dashboard tracks per-task spend so you can see what each issue costs.

---

## 2. Create the Azure Web App + outbound networking

In the Azure portal:

1. Create a new resource group, e.g. `codelegion-rg`, in a region near you.
2. Create a **Web App** in that resource group:
   - **Runtime:** Node 24 LTS, Linux
   - **Plan:** B1 (~$13/mo). F1 free also works but the daily 60-CPU-minute limit will hit you during initial setup.
3. **Set up outbound internet for the Web App.** Azure retired default outbound access for new resources, so the Web App can't reach Anthropic / GitHub / ARM without explicit egress. In the portal:
   - Create a **Virtual network** in the same RG (e.g. `codelegion-vnet`, address space `10.0.0.0/16`). Add two subnets:
     - `webapp` — `10.0.0.0/24`, delegated to **Microsoft.Web/serverFarms** (required for App Service VNet integration)
     - Leave room for an `agents` subnet (CodeLegion will add it itself in step 3 — don't create it now)
   - Create a **Public IP** (Standard SKU, Static, IPv4).
   - Create a **NAT gateway** in the same region. Associate the Public IP with it. Associate the `webapp` subnet with it.
   - On the Web App: **Networking → VNet integration** → connect to `codelegion-vnet/webapp`.
   - Verify outbound: SSH into the Web App console (Kudu → SSH) and run `curl -sI https://api.anthropic.com/v1/models`. Should return 200 or 401, not a timeout.
4. **Enable managed identity.** Web App → **Identity** → System assigned → toggle **On**.
5. **Grant RBAC.** Resource group → **Access control (IAM)** → Add role assignment → **Contributor** → "Managed identity" → select the Web App's identity. Contributor on the RG lets it manage VMs, networking, and its own App Settings.
6. **App Settings.** Configuration → Application settings → add:
   - `AZURE_SUBSCRIPTION_ID` = your subscription ID (from the portal home page)
7. **Startup command.** Configuration → General settings → Startup Command: `node index.js`. Save.

CodeLegion will adopt your existing VNet, NAT gateway, and Public IP — it just adds an `agents` subnet for VMs and attaches the same NAT for their outbound. No duplicates.

---

## 3. Deploy this repo

Pick the path that fits how you already work:

### 3a. External git (recommended — enables one-click updates)

In the Web App → **Deployment Center**:
- Source: **External Git**
- Repository: `https://github.com/AtaNdr/CodeLegion`
- Branch: `main`
- Save.

Azure pulls the code. Once deployment completes (~2 min), the Web App is live. The "Update" button on the dashboard later will use this same hook to pull new commits.

### 3b. GitHub Actions

If you've forked this repo, set up your own publish workflow with the publish profile downloaded from the Web App's Deployment Center.

### 3c. Manual zip deploy

```bash
cd /path/to/CodeLegion
zip -r ../codelegion.zip . -x "node_modules/*" ".git/*"
az webapp deploy --resource-group codelegion-rg --name <your-webapp-name> --src-path ../codelegion.zip --type zip
```

---

## Done — walk the wizard

Open `https://<your-webapp>.azurewebsites.net/status`. The Flow 1 wizard appears. Click **Run all** to execute every check. Most will be red.

Walk top-to-bottom and click **Fix** (or **Upload key**, **Configure App**) on each red row. After each fix the check auto-reverifies — give it a few seconds to turn green.

| Check | What you do |
|---|---|
| **Subscription accessible** | Already green if you set `AZURE_SUBSCRIPTION_ID` correctly. |
| **Resource group** | Auto-detected from the Web App. |
| **Network (vnet · agents subnet · NSG · NAT)** | Click **Fix** → adopts your VNet + NAT + Public IP from step 2, adds the `agents` subnet (and creates an NSG for it) in a free `/24` inside the VNet's address space. ~30s. |
| **Anthropic key valid** | Click **Upload key** → paste your `sk-ant-...`. Validates via a `GET /v1/models` probe. |
| **GitHub App + repo access** | Click **Configure App** → modal opens with the webhook URL + secret you'll need on github.com. Create the App there, then paste back App ID, Installation ID, owner, repo, and the PEM. See **GitHub App creation** below for the github.com walkthrough. |
| **Repo template installed** | Click **Fix** → 14 contract files (CLAUDE.md, etc.) pushed to your target repo via Contents API. |
| **GitHub labels** | Click **Fix** → 11 issue labels created on your target repo. |
| **Branch protection (main)** | Click **Fix** → requires 1 review + CODEOWNERS on main. |

When all rows are green, Flow 1 collapses and Flow 2 (the live fleet dashboard) takes over.

### GitHub App creation (one-time)

The **Configure App** button in the wizard is your launchpad — open it first so you have the webhook URL + secret ready to paste.

1. In the wizard, click **Configure App** on the *GitHub App + repo access* row. The top of the modal shows the **Webhook URL** and **Webhook secret** with Copy buttons. Keep the modal open.
2. In a new tab: GitHub → your settings → Developer settings → GitHub Apps → **New GitHub App**.
3. Fill in the App form:
   - **Name:** anything memorable (e.g. `codelegion-yourorg`).
   - **Homepage URL:** your Web App URL.
   - **Webhook URL:** paste from the wizard modal.
   - **Webhook secret:** paste from the wizard modal.
   - **Permissions — Repository:**
     - Contents: **Read & write**
     - Issues: **Read & write**
     - Pull requests: **Read & write**
     - Metadata: **Read** (auto-selected)
     - Workflows: **Read & write** (needed for label/protection management)
     - **Administration: Read & write** ⚠️ required for branch protection — easy to miss
   - **Subscribe to events:** Issues, Issue comment, Pull request, Pull request review.
4. Create the App. Note the **App ID** shown at the top of the App's settings page. Generate a private key — download the `.pem` file.
5. Install the App on your target repo (from the App's Install App tab). After install, note the **Installation ID** from the URL: `.../installations/<ID>`.
6. Back in the wizard modal (still open from step 1): paste App ID, Installation ID, repo owner, repo name, and the contents of the `.pem` file. Click **Save**.

> **If you forgot Administration R/W (or any other permission):** GitHub does NOT apply newly-added permissions to existing installations automatically. The Fix will keep returning 403 until you re-accept. Two steps:
>
> 1. App settings → Permissions & events → set the missing permission → Save changes.
> 2. Go to **https://github.com/settings/installations** (or `https://github.com/organizations/<your-org>/settings/installations` for org installs) → click **Configure** on your App → click the yellow **Review and accept** banner at the top.
>
> Then click Fix again in CodeLegion. The Fix automatically clears the cached installation token, so the next attempt uses a token reflecting the new permissions.

---

## Verify it works

1. Open an issue in your target repo using the **Agent Task** template (the wizard injected this).
2. Make sure it has labels `agent-ready` and `model:sonnet`.
3. Within ~3 minutes a VM spawns in your Azure RG. The Flow 2 dashboard shows it.
4. The agent claims the issue, posts a plan, codes, opens a PR.

If something stalls:
- Check the agent's **Log** button in the dashboard.
- Check the **Timeline** for state transitions.
- Verify `/health` returns ok.
- Confirm App Settings are all set: `ANTHROPIC_API_KEY`, `GH_APP_*`, `GH_REPO_OWNER`, `GH_REPO_NAME`, `REPORT_TOKEN`, `GH_WEBHOOK_SECRET`.

---

## Updating CodeLegion

Click **Update** in the dashboard footer. If you deployed via external git (3a above), Azure pulls the latest from `main` and restarts. If you deployed via zip, the Update button just restarts — push a new zip yourself first.

---

## Tearing it down

1. Click **Clean repo** in the dashboard. It removes the contract files (CLAUDE.md, COMMENT_STYLE.md, etc.) it injected.
2. Click **Sleep all** to deallocate every VM.
3. Delete the resource group via the Azure portal. That removes the Web App, all VMs, the network, and everything else.
4. Uninstall the GitHub App from your repo.
5. Revoke the Anthropic API key.

That's it. No residual state outside the resource group.
