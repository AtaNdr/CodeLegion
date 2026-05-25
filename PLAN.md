# CodeLegion — Design & Implementation Plan

> Originally written as the v2 design doc for `agent-fleet`. CodeLegion is that v2 lifted into its own repo. Paths in this doc are relative to the CodeLegion repo root. Comparisons to "v1" refer to the predecessor [agent-fleet](https://github.com/AtaNdr/agent-fleet).

## Context

The predecessor's setup story is heavy: ~18 manual Azure resources, 4 Key Vault secrets, an uploaded scripts tarball, a per-repo CLI install script, and ~45 minutes of portal/CLI work before anything runs.

**CodeLegion goal:** collapse setup for the end user to three steps —
1. Create a Claude (Anthropic) API key
2. Create an Azure Web App
3. Deploy this repo to that Web App

The Web App then bootstraps everything else itself: discovers infra in its own RG, verifies access to Claude + GitHub, creates missing Azure resources, injects template files into the user's repo, and only then enters the webhook orchestrator loop. A wizard UI shows **Flow 1 (Infrastructure)** until green, then expands into **Flow 2 (Live orchestrator)** with per-VM activity, history, and pricing. The user can also clean their repo of injected files, and update CodeLegion in-place when new versions release.

**Major simplifications over the predecessor (see §G for the why):**
- **No Key Vault.** Secrets live in App Settings; VMs fetch via authenticated `/agent/secrets` endpoint.
- **No Storage Account.** Logs, cost reports, activity timelines, Flow 1 state all live in `/home/data/`.
- **No VM managed identity.** VMs have no direct Azure-resource access — everything routes through the controller.
- **No `with-secrets.sh` dance on VMs.** Gone.

Resources Flow 1 creates: VNet + subnet + NSG + NAT gateway + public IP. That's it.

---

## A. Repo layout

### A.1 Where CodeLegion lives
**Standalone repo, flat layout** at `https://github.com/AtaNdr/CodeLegion`. Users deploy by setting the Web App startup command to `node index.js`. *Rejected alternative during planning:* keep it as a `v2/` subdirectory inside `agent-fleet` — split into its own repo to give it a clear identity and independent release cadence.

### A.2 Module structure

```
codelegion/
  README.md
  SETUP.md
  LICENSE
  PLAN.md                    # this file
  index.js                   # entrypoint; boots Flow 1, mounts Flow 2 routes
  config.js                  # env loader; defaults
  state.js                   # /home/data/flow1.json persistence
  config.json                # fleet caps, idle timeouts, VM sizes
  pricing.json               # static default; PRICING_JSON env can override (§C.3)
  package.json
  azure/
    clients.js               # DefaultAzureCredential + ARM client factories
    discovery.js             # list-by-RG: vnets, subnets, NSGs
    provision.js             # create-if-missing: vnet/subnet/NSG, NAT GW + public IP
    app-settings.js          # read/write own App Settings via WebSiteManagementClient
    vm.js                    # spinNewAgent / startExisting / deallocate / delete / runCommand
    self-update.js           # syncRepository + restart via ARM (§E)
  github/
    app.js                   # JWT mint + installation token
    repo.js                  # Contents API: PUT/DELETE/GET for inject + cleanup
    install-check.js         # /installation/repositories probe
    pem.js                   # normalize private key shapes
  anthropic/
    pricing.js               # load bundled pricing.json; PRICING_JSON override (§C.3)
  flow1/
    checks.js                # ordered Check list (run/status/remediate)
    runner.js                # executes a check, persists result
    fixers.js                # per-check remediation actions
    routes.js                # /setup, /setup/check/:id, /setup/run-all
    actions.js               # /setup/action/:id + /setup/upload-*
  flow2/
    routes.js                # /webhook, /fleet, /agent/*, /cost/*, /admin/*
    webhook.js               # GitHub HMAC verify + handler
    activity.js              # in-mem Map<vm, latest> + append to /home/data/activity/{vm}.jsonl
    retirement.js            # sleeping-VM sweep on a 6h cron
    cost.js                  # JSONL in /home/data/cost.jsonl
    logs.js                  # append /home/data/logs/{vm}.log
    secrets.js               # GET /agent/secrets — mints fresh GH token + returns Anthropic key
    vmlist.js                # fleet snapshot for UI (agents + activity merged)
  ui/
    render.js                # buildHtml({flow1, flow2}) — single template string
    common.js                # shared CSS + helpers (escape, pill, dot)
    script.js                # inline browser JS for buttons + modals
    sections/
      setup.js               # Flow 1 collapsible
      fleet.js               # per-VM cards
      cost.js                # cost cards + recent tasks
      discovery.js           # RG inventory cards
  scripts-static/            # served at /scripts/*
    agent-bootstrap.sh
    agent-loop.sh            # fetches secrets from controller; POSTs status + sync
    refresh-gh-token.sh      # thin wrapper around /agent/secrets
  repo-template/             # injected via Contents API (§B.6) — 14 files
```

### A.3 Lifted (with light edits) from v1
- `calculateCost`, formatters — `controller/server.js:62-72`
- `verifySignature`, `verifyReportToken` — `:133-148`
- `listAgents`, `isAlive`, `isDeallocated`, `isWakeable`, `groupByModel` — `:151-179`
- `startExistingAgent`, `deallocateAgent` — `:182-207`
- `retireStaleAgents` — `:210-258`
- `buildCloudInit` + `spinNewAgent` — `:343-452`. Two changes: (a) no VM identity attached; (b) cloud-init carries only `REPORT_TOKEN` + `CONTROLLER_PUBLIC_URL` instead of KV refs.
- GitHub JWT + installation token — `:455-485`; `normalizePrivateKey`, `getPrivateKey` — `:487-506`. `getPrivateKey()` now reads from App Setting `GH_APP_PRIVATE_KEY` only (no KV branch).
- Cost report endpoint, summary endpoint — `:593-665`
- F1 quota tracker — `:260-341`
- Status page HTML/CSS — `:764-973` (re-split into `ui/sections/*`, look/feel identical)

### A.4 Replaced
- `scripts/setup-azure.sh` (356 lines) → `flow1/checks.js` + `azure/provision.js`
- `scripts/install-into-repo.sh` (145 lines) → `github/repo.js` (Contents API)
- `scripts/with-secrets.sh` → **gone** (no KV; VMs fetch secrets from controller)
- Storage SDK (`@azure/storage-blob`, `@azure/arm-storage`) → **gone** (fs in `/home/data/`)
- KV SDK (`@azure/keyvault-secrets`, `@azure/arm-keyvault`) → **gone**
- MSI SDK (`@azure/arm-msi`) → **gone**
- All `AZURE_*` / `GH_*` / `AGENT_SCRIPTS_URL` env vars at `server.js:980-988` → **Flow 1 writes them into App Settings itself**. The only setting the user provides at deploy time is `AZURE_SUBSCRIPTION_ID`.

### A.5 Dependencies for `./package.json`

Keep from v1: `@azure/arm-compute`, `@azure/arm-network`, `@azure/arm-appservice`, `@azure/identity`, `express`.

Add: `@azure/arm-resources`, `@anthropic-ai/sdk`.

Remove: storage-blob, arm-storage, keyvault-secrets, arm-keyvault, arm-msi.

---

## B. Flow 1 architecture

### B.1 State machine + persistence
A Check is `{ id, label, category, run() → {status, detail, fixable, remediation}, fix?() → {status, detail} }`. Status: `green | yellow | red | unknown | running`.

**Persistence: `/home/data/flow1.json` on the Web App's persistent file system.** Same place v1 puts `cost.jsonl` (`server.js:43`). Survives restarts. Lost only if the Web App is deleted/recreated — acceptable since the same delete would wipe everything Flow 1 created anyway.

```jsonc
{ "version": 2,
  "rg": "agent-fleet-rg",
  "region": "eastus",
  "checks": { "subscriptionId": {"status":"green","detail":"...","ranAt":"..."}, ... },
  "discovered": { "vnets":[...], "subnets":[...] },
  "chosen": { "vnet":"...", "subnet":"...", "nsg":"...", "natGateway":"..." },
  "github": { "appId":"...", "installationId":"...", "owner":"...", "repo":"...", "privateKeyUploadedAt":"..." }
}
```

Page-load returns cached state; "Run check" re-runs a single check; "Run all" runs in order.

### B.2 Self-discovery — ARM list calls (RG-scoped via `WEBSITE_RESOURCE_GROUP`)

| Resource | Client | Call |
|---|---|---|
| RG itself | `@azure/arm-resources` `ResourceManagementClient` | `resourceGroups.get` |
| All resources in RG | same | `resources.listByResourceGroup` (one-shot inventory for the UI) |
| VNets | `@azure/arm-network` | `virtualNetworks.list(rg)` |
| Subnets | same | `subnets.list(rg, vnet)` per vnet |
| NSGs | same | `networkSecurityGroups.list(rg)` |
| NAT gateways | same | `natGateways.list(rg)` |
| Web App + plan | `@azure/arm-appservice` (already in v1) | `webApps.get`, `appServicePlans.get` |

**Match policy per resource:** zero → auto-create; one → auto-adopt and surface "Using existing X"; many → dropdown for user to pick (saved into `state.chosen.*`).

### B.3 Resource creation when missing

Naming: `agentfleet-<suffix>-<kind>` where `<suffix>` = `WEBSITE_SITE_NAME` minus common prefix, lowercased, max 8 chars.

**Azure resources Flow 1 creates (5 total):**

1. **VNet** `agentfleet-<suffix>-vnet` — 10.0.0.0/16
2. **Subnet** `agents` — 10.0.1.0/24
3. **NSG** `agentfleet-<suffix>-nsg` — no inbound rules (the SSH-from-my-ip rule at `setup-azure.sh:106` is dropped since it requires interactive `curl ifconfig.me`)
4. **Public IP** `agentfleet-<suffix>-pip` — Standard SKU, Static
5. **NAT gateway** `agentfleet-<suffix>-nat` — attached to subnet; provides VMs outbound internet

**Web App App Settings Flow 1 writes** (via `webApps.updateApplicationSettings`):

User-provided (UI):
- `ANTHROPIC_API_KEY`
- `GH_APP_PRIVATE_KEY` (PEM textarea or upload; normalized by `normalizePrivateKey` at `server.js:487` before write)
- `GH_APP_ID`
- `GH_INSTALLATION_ID`
- `GH_REPO_OWNER`
- `GH_REPO_NAME`

Controller-generated (via `crypto.randomBytes(32).toString('hex')`):
- `GH_WEBHOOK_SECRET`
- `REPORT_TOKEN`

Resource pointers (auto-populated from `state.chosen.*`):
- `AZURE_LOCATION`, `AZURE_VNET_NAME`, `AZURE_SUBNET_NAME`, `AZURE_NSG_NAME`
- `CONTROLLER_PUBLIC_URL` = `https://${WEBSITE_HOSTNAME}`
- `AGENT_SCRIPTS_URL` = `${CONTROLLER_PUBLIC_URL}/scripts/agent-scripts.tar.gz`

Optional override:
- `PRICING_JSON` (unset = use bundled `pricing.json` defaults; §C.3)

**No Key Vault. No storage account. No VM managed identity.**

### B.4 Claude API key verification
`@anthropic-ai/sdk`, `client.models.list({limit:1})` — free, fast, 401 on bad key.

### B.5 GitHub App access verification
Two checks: (a) mint JWT (`server.js:461-470`), GET `/app/installations/{id}` → install exists; (b) GET `/installation/repositories?per_page=100` → confirms `owner/repo` is in the list. Remediation: link to `https://github.com/apps/<app>/installations/new`.

**Private key intake — PEM textarea paste (primary), `.pem` upload (secondary).** Both pass through `normalizePrivateKey` (`server.js:487`) and are stored to the `GH_APP_PRIVATE_KEY` App Setting.

### B.6 Repo injection — replaces `install-into-repo.sh`
**GitHub Contents API, file-by-file** (no clone, no git binary, no commit identity setup):

```
github/repo.js
  injectFiles({owner, repo, files, alwaysOverwrite[], createIfMissing[]})
    for each file:
      GET /repos/{o}/{r}/contents/{path}     (404 = doesn't exist)
      if alwaysOverwrite OR (createIfMissing AND 404):
        PUT /repos/{o}/{r}/contents/{path}   with base64 content + sha-if-updating
  cleanFiles({owner, repo, files})
    DELETE for each file in the ALWAYS_OVERWRITE list (with current sha)
```

14 files × 1-2 calls = ~28 API calls per inject. GitHub's secondary rate limit on Contents (~80/min) is far above. 200ms sleep between writes for safety. Source files come from `./repo-template/`. Lists `ALWAYS_OVERWRITE` and `CREATE_IF_MISSING` lifted verbatim from `install-into-repo.sh:35-59`.

**Bonus automation:** `gh label create` block at `install-into-repo.sh:114` and branch protection at `:124` become two more Flow 1 sub-checks via REST: `POST /repos/.../labels` and `PUT /repos/.../branches/main/protection`. User has nothing left to do manually.

---

## C. Flow 2 changes from v1

### C.1 Per-VM live activity — VM is source of truth, controller caches

Source of truth lives **on the VM**. Each agent writes locally to:
- `/var/lib/agent/activity.jsonl` — append-only, JSON-per-line, every state transition
- `/var/lib/agent/status.json` — last-write-wins current state
- `/var/lib/agent/last-sync-offset` — byte offset of last successfully-pushed line in activity.jsonl

The VM's OS disk survives deallocate/wake cycles, so history persists locally even when the controller hasn't seen it. Controller is a display cache, not the system of record.

**Push (primary path) — on every state change AND every 10s heartbeat:**

Agent extends `write_status()` (`agent-loop.sh:62`):
```bash
write_status() {
  # existing local write at agent-loop.sh:65-74
  local line=$(jq -nc --arg ts "$(date -u +%FT%TZ)" --arg s "$1" --arg i "${2:-}" --arg sm "${3:-}" '{ts:$ts, state:$s, issue:$i, summary:$sm}')
  echo "$line" >> /var/lib/agent/activity.jsonl
  echo "$line" > /var/lib/agent/status.json
  push_status "$1" "${2:-}" "${3:-}"   # fire-and-forget POST to controller
}

heartbeat_sync() {  # called every 10s from main loop
  local off=$(cat /var/lib/agent/last-sync-offset 2>/dev/null || echo 0)
  local size=$(stat -c%s /var/lib/agent/activity.jsonl)
  if (( size > off )); then
    local payload=$(tail -c +$((off+1)) /var/lib/agent/activity.jsonl | jq -Rs .)
    curl -sS -X POST "$CONTROLLER_URL/agent/sync" \
      -H "Authorization: Bearer $REPORT_TOKEN" -H "Content-Type: application/json" \
      -d "{\"vmName\":\"$VM_NAME\",\"lines\":$payload,\"fromOffset\":$off}" \
      --max-time 10 && echo "$size" > /var/lib/agent/last-sync-offset
  fi
}
```

Controller (`flow2/activity.js`):
- `POST /agent/status` — updates in-memory `Map<vmName, {state, issue, summary, updatedAt}>` for the live UI display
- `POST /agent/sync` — appends new lines to `/home/data/activity/{vmName}.jsonl`; treats this as the display cache for the timeline modal
- Both auth'd by `REPORT_TOKEN`

**Pull (escape hatch) — UI "Force sync from VM" button:**
- Controller calls `compute.virtualMachines.beginRunCommandAndWait(rg, vmName, {commandId:'RunShellScript', script:['tail -c +$(cat /var/lib/agent/last-sync-offset 2>/dev/null || echo 1) /var/lib/agent/activity.jsonl']})`
- Slow (~30s), but works even when push has been failing
- Doesn't work when VM is deallocated — UI greys the button out in that state

**Lifecycle:**
- Sleep/wake: cache survives in `/home/data/`; VM resumes push from `last-sync-offset`
- Retire (delete): controller attempts one final sync before `beginDeleteAndWait`; afterward only the cache remains

UI: per-VM card shows current `state · #issue · summary` 1-liner + last 3 timeline entries from cache. "Timeline" modal shows last 50. "Force sync" button per card (greyed when VM deallocated).

### C.2 Timeline event taxonomy
`claimed | planning | coding | testing | pr-opened | completed | failed | idle | deallocating`. Each line: `{"ts":"...","state":"...","issue":"42","summary":"...","extra":{...}}`.

### C.3 Claude pricing — bundled default with optional env var override

Ship `./pricing.json` checked-in (same shape as v1's `controller/pricing.json`). Controller loads at boot.

Override: App Setting `PRICING_JSON` holds the full JSON blob. Controller parses on boot; if invalid, falls back to bundled defaults and logs an error. User updates pricing without redeploying by pasting new JSON into the Azure portal.

UI Pricing card shows `_lastVerified` from the active source. If older than 30 days, amber pill ("Pricing may be stale — check anthropic.com/pricing").

Update paths:
- Click self-update (§E) → new release brings fresh bundled `pricing.json`
- Or paste updated JSON into `PRICING_JSON` App Setting → takes effect on next request (reread per cost calc)

*Rejected alternatives:*
- Per-key App Settings (one per model × rate) — flat shape doesn't fit nested JSON cleanly
- `pricing.json` in the target GitHub repo — couples fleet config to project repo, adds GitHub API calls per cost calc, breaks if the user deletes the file

### C.4 VM script delivery + secret fetch

**Scripts: Web App serves `/scripts/agent-scripts.tar.gz` from `./scripts-static/` via `express.static`.** Cloud-init pulls from `CONTROLLER_PUBLIC_URL/scripts/agent-scripts.tar.gz`. Scripts contain no secrets, so public is fine. Optional: append a query token from App Settings if we want belt-and-braces.

**Secrets: VMs receive only `REPORT_TOKEN` and `CONTROLLER_PUBLIC_URL` via cloud-init.** Everything else is pulled at runtime:

```
GET /agent/secrets
Authorization: Bearer <REPORT_TOKEN>
→ 200 { anthropicApiKey, githubToken, repoUrl, model }
```

Controller mints a fresh GitHub installation token per call (using the App ID + private key from App Settings — same `getPrivateKey()` / `getInstallationToken()` code lifted from `server.js:455-506`). The GH App private key never leaves the controller.

`refresh-gh-token.sh` (v2 version) becomes a thin wrapper that calls `/agent/secrets` and exports `GITHUB_TOKEN`. The whole `with-secrets.sh` + Azure metadata service + KV dance from v1 is gone.

Eliminates `scripts/make-scripts-tarball.sh`, the upload at `setup-azure.sh:228-237`, AND the with-secrets wrapper.

---

## D. UI design

**Single page, two sections, one template string** — same pattern as `server.js:737`.

```
/                  → /status
/status            → single HTML page:
                       1. <details open|closed> Flow 1 setup (collapses when all green)
                       2. Flow 2 fleet dashboard
/setup/check/:id   POST  re-run one check
/setup/action/:id  POST  remediation (create vnet, inject repo, etc.)
/setup/upload-gh-key            POST PEM
/setup/upload-anthropic-key     POST key
/agent/status      POST agent → controller live status update
/agent/sync        POST agent → controller activity batch sync
/agent/secrets     GET  agent ← controller fresh secrets (Bearer REPORT_TOKEN)
/admin/vm/:name    DELETE       (lifted from server.js:695)
/admin/vm/:name/wake            POST (start)
/admin/vm/:name/sleep           POST (deallocate)
/admin/vm/:name/force-sync      POST (runCommand pull)
/admin/wake-all    POST
/admin/sleep-all   POST
/admin/spin        POST {repo, model}  — manual force-create
/admin/inject-repo POST
/admin/clean-repo  POST
/admin/self-update POST  (§E)
```

**Flow 1 card layout** (one card per check — now only 7):
```
[●] Subscription accessible       ✓ green        [Run check]
[●] Resource group                ✓ adopted: agent-fleet-rg
[●] Network (vnet/subnet/NSG/NAT) ⚠ missing      [Create]
[●] Anthropic key valid           ✗ unset        [Upload key…]
[●] GitHub App installed          ✓ installed on 2 repos
[●] Repo accessible               ✗ owner/repo not in install   [Open GitHub]
[●] Repo template installed       — unknown      [Inject files]
```
When all green, `<details>` collapses with summary `Setup complete — 7/7 green`.

**Flow 2 per-VM card** (replaces flat table at `server.js:847-865`):
```
┌─ agent-sonnet-1700... ─────────────────────────┐
│ [sonnet]  [running]                            │
│ #42 · implementing rate limiter for /api       │
│ ────────                                       │
│ 14:02 coding · 13:58 planning · 13:55 claimed  │
│ [Raw log] [Timeline] [Force sync] [Sleep] [Del]│
└────────────────────────────────────────────────┘
```
"Wake all" / "Sleep all" / "Force-create new agent" as section-top buttons. Same admin token modal as `server.js:880`. Pills reused from `server.js:794-800`. Meta-refresh stays at 30s (`server.js:770`) — no websockets (F1 can't sustain them).

---

## E. Self-update

**"Pull latest" button using Kudu `/api/zipdeploy`.**

Flow:
1. UI shows current version (v2's `package.json`) and latest from `https://api.github.com/repos/<this-repo>/releases/latest`.
2. If newer, "Update available" pill + Update button.
3. POST `/admin/self-update`:
   - Controller downloads release tarball, repackages just the repo root as a zip.
   - Authenticates to its own Kudu via the Web App's managed identity (`https://<site>.scm.azurewebsites.net/api/zipdeploy?isAsync=true`, Bearer = ARM token).
   - Returns 202 immediately; App Service restarts.
4. After ~60s, `/health` answers and auto-refresh picks up the new version number.

*Rejected:* GitHub Actions auto-deploy (requires user to wire a publish profile — violates three-step setup); manual zip redeploy (requires CLI).

**Sharp edge:** if a release renames a required App Setting, the update can wedge. Mitigation: each release ships a "required App Settings as of this version" manifest; the controller writes any missing ones from defaults before the restart.

---

## F. Migration path

**v2 in its own NEW resource group.** The v2 RG is dramatically smaller than v1's (5 resources vs ~18), so there's even less reason to share. The same GitHub App can serve both v1 and v2 — point its webhook at v2's URL. Cost overhead during overlap: ~$30/mo (second VNet + NAT gateway). Tear down v1's RG when comfortable.

In-place migration is technically possible (Flow 1 would discover and adopt v1's vnet), but the savings are negligible and the cleanup risk isn't worth it. Recommend new RG in docs.

---

## G. Decisions (locked in)

1. **RBAC constraint.** Web App has Contributor on its RG. Contributor cannot assign roles, but it can create network resources, manage VMs, and read/write its own App Settings — all of which is enough now that KV / storage / VM identity are gone.

2. **No Key Vault.** App Settings hold the 4 secrets (Anthropic key, GH App private key, GH webhook secret, report token). Trust boundary: Contributor on RG can read both KV-with-policies and App Settings — practically equivalent. KV was defense-in-depth, not a hard barrier. Trade-off accepted for the simpler infra.

3. **No Storage Account.** All persistent state lives in `/home/data/` on the Web App. Single-instance only (matches the orchestrator's in-memory design anyway). State is tied to Web App lifecycle — if user deletes the Web App, history is gone, which is also true of an RG-scoped storage account.

4. **No VM managed identity.** With KV gone, the VM has no Azure resource to authenticate to. All secret access is mediated by the controller via `/agent/secrets`. GH App private key never leaves the controller.

5. **Pricing — bundled default with optional `PRICING_JSON` App Setting override.** No fetcher, no live API. Self-update brings fresh defaults; portal edit gives instant override.

6. **History — VM source of truth, controller cache.** Push every state change + 10s heartbeat sync; pull-from-VM via `runCommand` as escape hatch.

7. **Repo scope.** Single repo per Web App for v2 launch. Multi-repo can come later.

8. **v2 location.** the repo root inside this repo.

9. **App Service F1 tier.** v1's F1 quota tracker (`server.js:271-341`) carries over. Flow 1 includes a check that warns if plan is F1, with a one-click upgrade button to B1 (~$13/mo).

**Sharp edges flagged (no decision needed):**
- `REPORT_TOKEN` lives in cloud-init `customData`, readable by anyone with VM read on the RG. The token only authorizes `/agent/log`, `/agent/status`, `/agent/sync`, `/agent/secrets` — scoped. Could be tightened to a per-VM token tracked in memory; deferred as polish.
- GitHub Contents API secondary rate limits (B.6) — well within bounds.
- Self-update App Settings drift (§E) — handled by per-release manifest.

---

## Implementation sequencing

| Phase | Scope | Effort |
|---|---|---|
| 0 | Create the repo root directory + this PLAN.md. | ✓ done |
| 1 | Skeleton: `package.json`, `index.js`, `config.js`, `state.js`, `azure/clients.js`, `azure/discovery.js`. Bootable Web App lists what's in its RG. | ~0.5 day |
| 2 | Flow 1 read-only: 7 checks, runner, routes, UI section with pills. | ~0.5 day |
| 3 | Flow 1 fixes: `azure/provision.js` (network only), `azure/app-settings.js`, `github/repo.js` (inject + clean), PEM/key upload, labels + branch protection automation. | ~1 day |
| 4 | Flow 2 lift: webhook, spinNewAgent (no VM identity), cost endpoints, log endpoints (fs-based), F1 quota, retirement. UI fleet section. | ~1 day |
| 5 | Per-VM activity: VM-side `agent-loop.sh` changes + push + heartbeat + last-sync-offset; controller `/agent/status` + `/agent/sync`; UI timeline + Force-sync. | ~0.5 day |
| 6 | Secret fetch: `/agent/secrets` endpoint + `refresh-gh-token.sh` rewrite. | ~0.25 day |
| 7 | Self-update + pricing staleness pill + `PRICING_JSON` override. | ~0.5 day |
| 8 | Polish: clean-repo, force-spin, wake-all/sleep-all, end-to-end smoke test. | ~0.5 day |

**Total: ~5 days of focused work** (down from 7-8 in the previous version of this plan — KV/storage removal saved meaningful effort).

---

## Critical files for implementation reference

- `C:\Projects\agent-fleet\controller\server.js` — every Flow 2 pattern to lift; line citations throughout this plan
- `C:\Projects\agent-fleet\scripts\install-into-repo.sh` — canonical list of files repo-injection must write/delete
- `C:\Projects\agent-fleet\scripts\agent-loop.sh` — the `write_status` + `/agent/log` call sites that get the new push/sync hooks
- `C:\Projects\agent-fleet\controller\pricing.json` — shape v2's bundled pricing.json must match

---

## Verification (end-to-end test plan after implementation)

1. **Fresh-deploy test:** new Azure subscription, create a Web App with Contributor on its RG, set `AZURE_SUBSCRIPTION_ID` + startup command, deploy this repo. Open `/status`. Confirm Flow 1 shows discovery results. Walk every red → green transition. Confirm App Settings get written, network resources created.
2. **Repo inject test:** point at a clean GitHub repo; click "Inject files"; verify 14 files appear; labels created; branch protection set.
3. **Repo clean test:** click "Clean repo"; verify `ALWAYS_OVERWRITE` files removed.
4. **Trigger an agent:** open a labeled issue; confirm Flow 2 spins a VM; cloud-init pulls scripts; VM fetches secrets via `/agent/secrets`; agent claims issue; activity POSTs land in UI within seconds; 10s heartbeat continues to sync.
5. **VM lifecycle:** sleep, wake, force-sync, delete — confirm each button matches Azure power state and activity cache behaves correctly.
6. **Pricing override:** paste a modified JSON into `PRICING_JSON` App Setting; confirm next cost report uses new rates without restart.
7. **Self-update:** bump version in main; click Update; confirm zip-deploy succeeds; new version shows in UI.
8. **Stale state recovery:** delete `/home/data/activity/{vm}.jsonl` while VM is running; click Force-sync; confirm history restored from VM.
9. **F1 quota tracker:** confirm warning fires on F1 (`server.js:330`).
