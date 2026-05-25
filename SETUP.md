# CodeLegion — Setup

Three steps. Plan ~15 minutes.

> **Prerequisites:** an Azure subscription, a GitHub account, and a target repo where the agents will work.

---

## 1. Create a Claude API key

Go to [console.anthropic.com](https://console.anthropic.com/) → API keys → create one. Copy it; you'll paste it into the setup wizard later. It looks like `sk-ant-...`.

You'll set billing on that key. The CodeLegion dashboard tracks per-task spend so you can see what each issue costs.

---

## 2. Create the Azure Web App

In the Azure portal:

1. Create a new resource group, e.g. `codelegion-rg`, in a region near you.
2. Create a **Web App** in that resource group:
   - **Runtime:** Node 20 LTS, Linux
   - **Plan:** B1 (~$13/mo). F1 free also works but the daily 60-CPU-minute limit will hit you during initial setup.
3. After it's created, go to the Web App's **Identity** blade → System assigned → toggle **On**. This gives the Web App a managed identity.
4. Go to your resource group's **Access control (IAM)** → Add role assignment → **Contributor** → "Managed identity" → select the Web App's identity. Contributor on the RG is what lets it provision its own networking and manage VMs.
5. Configure → Application settings → add:
   - `AZURE_SUBSCRIPTION_ID` = your subscription ID (from the portal home page)
6. Configuration → General settings → Startup Command: `node index.js`. Save.

That's all the Azure work. The Web App now boots into a wizard that handles everything else.

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

Walk top-to-bottom and click **Fix** (or **Upload key**, **Upload PEM**) on each red row:

| Check | What you do |
|---|---|
| **Subscription accessible** | Already green if you set `AZURE_SUBSCRIPTION_ID` correctly. |
| **Resource group** | Auto-detected from the Web App. |
| **Network** | Click **Fix** → provisions vnet, subnet, NSG, public IP, NAT gateway (~2 min). |
| **Anthropic key valid** | Click **Upload key** → paste your `sk-ant-...`. |
| **GitHub App installed** | First, create a GitHub App (see below), then click **Upload PEM** + supply IDs. |
| **Repo accessible** | After installing the App on your target repo, this turns green automatically. |
| **Repo template installed** | Click **Fix** → 14 contract files (CLAUDE.md, etc.) pushed to your target repo via Contents API. |
| **GitHub labels** | Click **Fix** → 11 issue labels created on your target repo. |
| **Branch protection (main)** | Click **Fix** → requires 1 review + CODEOWNERS on main. |

When all rows are green, Flow 1 collapses and Flow 2 (the live fleet dashboard) takes over.

### GitHub App creation (one-time)

1. Go to your GitHub settings → Developer settings → GitHub Apps → **New GitHub App**.
2. Name it (e.g., `codelegion-yourorg`). Homepage URL = your Web App URL.
3. **Webhook URL:** `https://<your-webapp>.azurewebsites.net/webhook`
4. **Webhook secret:** the wizard's `Bootstrap` step generates one. Copy it from the Web App's App Settings (`GH_WEBHOOK_SECRET`) and paste it into the GitHub App config.
5. **Permissions:**
   - Repository: Contents (R/W), Issues (R/W), Pull requests (R/W), Metadata (R), Workflows (R/W if you want it to manage labels/protection), Administration (R/W for branch protection)
   - Subscribe to events: Issues, Issue comment, Pull request, Pull request review
6. Create. Note the **App ID**. Generate a private key — download the `.pem` file.
7. Install the App on your target repo. Note the **Installation ID** (visible in the URL after installation: `.../installations/<ID>`).
8. Back in the wizard: paste the PEM into "Upload PEM", and the App ID / Installation ID / target owner & repo into the GitHub config form.

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
