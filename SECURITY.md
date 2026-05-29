# Security

## Reporting a vulnerability

Please **do not open a public issue** for security reports. Email the maintainer:

- **naderi.ata@gmail.com**

Include:
- A description of the issue and its impact.
- Steps to reproduce.
- Any proof-of-concept code or screenshots.
- The version of CodeLegion you tested (footer pill on `/status`, or `/api/version`).

Expect an acknowledgement within 72 hours and a remediation plan within 14 days for valid reports. Coordinated disclosure preferred.

## Trust model

CodeLegion runs as a single-instance Azure Web App that:

- Holds **all secrets** in its own App Settings: `ANTHROPIC_API_KEY`, `GH_APP_PRIVATE_KEY` (PEM), `GH_WEBHOOK_SECRET`, `REPORT_TOKEN`, and optionally `DASHBOARD_PASSWORD_HASH`.
- Mints **short-lived GitHub installation tokens** per request; the GitHub App private key never leaves the controller.
- Exposes **agent endpoints** at `/agent/*` gated by `Authorization: Bearer REPORT_TOKEN`. The agent VMs receive `REPORT_TOKEN` in cloud-init, so anyone with `Microsoft.Compute/virtualMachines/read` on the resource group can read it.
- Verifies **GitHub webhook signatures** with `GH_WEBHOOK_SECRET` (HMAC-SHA256).

## Dashboard authentication

The `/status` dashboard is **not authenticated by default** to preserve backward compatibility with existing private deployments. **Before exposing your deployment publicly,** do one of:

1. **Set `DASHBOARD_PASSWORD_HASH`** — produced by `node scripts/hash-password.mjs '<password>'` and pasted into App Settings, or set via the "Set dashboard password" button in the dashboard's Environment & discovery panel.
2. **Enable Azure App Service Easy Auth** with your preferred identity provider (Microsoft / GitHub / Google / custom OIDC).

When `DASHBOARD_PASSWORD_HASH` is set, all dashboard and admin routes require a signed session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 24h TTL). `/health`, `/webhook`, `/agent/*`, `/scripts/*`, and the `/login` flow itself remain public (their own auth model applies).

## Known footguns

- `--dangerously-skip-permissions` is required for the agent's Claude Code invocation to act unattended. The guard rails are documented in `repo-template/CLAUDE.md` and `repo-template/DO_NOT_TOUCH.md`. Do not deploy CodeLegion against a repo you wouldn't trust a fast, unmonitored junior developer with.
- Cloud-init carries `REPORT_TOKEN` to each VM. Rotating it requires a fleet recycle.
- Branch protection on private repos requires GitHub Pro or higher; on free private repos CodeLegion will skip the branch-protection check and surface a yellow status.

## Supported versions

The latest tagged release on `main` is supported. Security fixes are released as patch versions. Older versions are not patched.
