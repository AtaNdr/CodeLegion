# Dashboard authentication — design notes

> **Status: planned, not built.** This document captures the intended design
> so that future contributors do not have to start from a blank page. The
> work is tracked alongside other open items in [`../TODO.md`](../TODO.md).
> A single-password prototype is preserved on the `feat/dashboard-auth`
> branch as a reference starting point.
>
> Until this ships, the `/status` dashboard has no built-in authentication.
> Operators should gate it with **Azure App Service Authentication
> (Easy Auth)** or an equivalent external auth layer before exposing the
> deployment to the public internet. See [`../SECURITY.md`](../SECURITY.md).

## Goal

Give CodeLegion operators a clear, layered choice of dashboard auth, surfaced
as an **optional step in Infrastructure setup** (no banner, no surprise).

## Three modes the operator picks from

| Mode | Where credentials live | Best for |
|---|---|---|
| `easyauth` | Azure (MS / GitHub / Google / OIDC) | Anyone who wants SSO and is comfortable in the Azure portal. Zero auth code in CodeLegion. |
| `single`   | App Settings (`DASHBOARD_PASSWORD_HASH`) | Smallest footprint. One shared password. No per-user audit. |
| `multi`    | Key Vault (one secret per user, keyed by email) | Real user management. Per-user revocation. Audit via KV logs. |
| `none` (default) | n/a | Backward-compat for existing private deployments. Banner-free. |

Mode is selected via the **Auth row in Infrastructure setup** — clicking
"Configure" opens a modal with the three options and (per mode) any
follow-up fields (e.g. KV vault URL, SMTP settings).

## Multi-user architecture (the new piece)

### Storage

- **Key Vault**: one secret per user, name `user-{base64url(email)}`. The
  secret value is a JSON blob:
  ```json
  {
    "email": "ata@example.com",
    "passwordHash": "scrypt:salt:hash",
    "inviteToken": "<base64url 256-bit, null after consumed>",
    "inviteExpiresAt": "2026-06-05T12:00:00Z",
    "active": true,
    "createdAt": "...",
    "lastLoginAt": "...",
    "addedBy": "..."
  }
  ```
  Tag `email=...` on each secret for cheap listing without reading values.
- **`/home/data/audit.jsonl`**: who added/removed/logged-in, when. Capped
  at ~1000 lines with rotation (same pattern as agent log).

### Why Key Vault, not a JSON file on `/home/data`

- Encrypted at rest with a customer-controlled key by default.
- Per-operation audit logs in Azure Monitor (free for the operator).
- Soft-delete + purge protection → accidental "remove user" is recoverable.
- The Web App already has a managed identity for ARM calls; granting
  `Key Vault Secrets Officer` on a new vault is a one-line role assignment.
- Cost: ~$0.03 per 10K ops + ~$1.40/mo per vault. Negligible.

### Provisioning the Key Vault

When the operator picks `multi`, CodeLegion offers to auto-create the vault
(like Flow 1 provisions the VNet):
- Name: `cl-vault-<hash(rg+sub)>` (KV names must be globally unique).
- Location: same as RG.
- Role assignment: Web App managed identity → `Key Vault Secrets Officer`.
- Vault URL persisted to App Setting `KEY_VAULT_URL`.

Adopt-existing mode supported, same pattern as the network step.

### Invite flow

```
Admin clicks "Add user" → enters email
       │
       ▼
Server: inviteToken = randomBytes(32, base64url)
        secret = { email, inviteToken, inviteExpiresAt: now+7d, active: false }
        kv.setSecret(`user-${b64(email)}`, JSON.stringify(secret))
       │
       ▼
Invite link: https://<host>/accept-invite?email=<email>&token=<inviteToken>
       │
       ├─ SMTP configured → email sent
       └─ SMTP not configured → link shown in admin UI for manual share
       │
       ▼
User → /accept-invite → "Set your password" form → POST
       │
       ▼
Server verifies token + expiry, sets passwordHash, clears inviteToken,
marks active=true. User can log in.
```

### SMTP — explicitly optional

Hard SMTP requirement would be hostile for self-hosted users. So:

- App Settings (all optional): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM`.
- If unset, "Add user" / "Reset password" actions surface the invite link
  in the admin UI with a Copy button. Admin pastes into whatever channel
  works.
- Dependency: `nodemailer` (~50 KB, no native code).

### Login

```
GET  /login                    → email + password form
POST /login                    → verify against KV, set signed session cookie
GET  /accept-invite?...        → set-your-password form
POST /accept-invite            → consume token, set password
POST /logout                   → clear cookie
GET  /admin/users              → list (admin only)
POST /admin/users              → add user
DELETE /admin/users/:email     → remove
POST /admin/users/:email/reset → re-issue invite
```

Cookie payload includes `email`. Same signing strategy as `single` mode
(HMAC over `REPORT_TOKEN`). 24h TTL. Cookie verify happens per request;
KV is hit only on login + user management.

## Open questions to settle before building

1. **Roles?** Single role (admin) for v1, or split admin/viewer up front?
   *Recommendation: single role for v1; refactor when there's a real use case.*

2. **Forgot-password** in v1, or admin-only password reset?
   *Recommendation: admin-only for v1 — admin clicks "Reset" → fresh invite.*

3. **Initial admin bootstrap** when enabling `multi`?
   - (a) Operator runs `node scripts/add-user.mjs first@example.com` locally
     before flipping the switch.
   - (b) The "Enable multi-user" UI prompts for the operator's email and
     creates them as the first user; the invite link is shown right there.
     **Recommended pick.**
   - (c) Auto-promote the currently-logged-in `single`-mode session.

4. **SMTP vs Azure Communication Services Email**?
   *Recommendation: SMTP first (works anywhere, including self-host outside
   Azure), ACS as a follow-up if there's demand.*

5. **Migration `single` → `multi`** — preserve the single password as a
   fallback for a grace period, or hard cutover?
   *Recommendation: hard cutover with an explicit "you will be logged out"
   warning in the UI.*

6. **Audit retention** — `audit.jsonl` capped how? *Recommendation: 1000
   lines with rotation, same as the agent log.*

## Implementation phases (~4–6 days total)

**Phase 1 — Refactor (1 day)**
- Introduce `DASHBOARD_AUTH_MODE` selector + middleware that dispatches.
- Cherry-pick the `feat/dashboard-auth` work as the `single` mode.
- Auth chooser surfaces in Infrastructure setup as an optional step.
- Existing single-password deployments: no behaviour change.

**Phase 2 — Key Vault user store (2 days)**
- KV provisioning fixer (mirrors the network provision step).
- `flow2/users.js`: addUser / getUser / removeUser / listUsers — KV-backed.
- `multi` mode middleware + email-based login route.
- Admin UI: list users, add user (shows invite link if SMTP unset).

**Phase 3 — Email + invite UX polish (1 day)**
- `flow2/email.js`: nodemailer wrapper with SMTP App Settings.
- `/accept-invite` flow + first-time password-set page.
- Password reset (admin-triggered) reuses the invite flow.

**Phase 4 — Tests + docs (1 day)**
- Round-trip tests on the auth flows.
- SECURITY.md + SETUP.md updated.
- README updated with the auth mode chooser.

## One scope reduction worth considering

Ship Phase 1 + Phase 2 with manual invite link only (no SMTP). Users
copy the link out of the UI. Cuts the v1 from ~5 days to ~3. SMTP becomes
a "nice to have" the community can contribute.

## Defaults policy

- **Existing deployments upgrading**: `DASHBOARD_AUTH_MODE` unset →
  middleware no-ops → dashboard stays open. Nothing breaks.
- **Fresh deployments**: same default (`none`), but the Infrastructure
  setup wizard's Auth row shows as `yellow` ("not configured — dashboard
  is open") until the operator either picks a mode or explicitly accepts
  the open state.

## Preserved on branch

The single-password implementation that almost shipped — code, login page,
hash CLI, set-password modal — is on `feat/dashboard-auth`. It's a 9-file
commit (~330 lines) and is the starting point for Phase 1's refactor.
