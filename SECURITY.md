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

- Holds **all secrets** in its own App Settings: `ANTHROPIC_API_KEY`, `GH_APP_PRIVATE_KEY` (PEM), `GH_WEBHOOK_SECRET`, `REPORT_TOKEN`.
- Mints **short-lived GitHub installation tokens** per request; the GitHub App private key never leaves the controller.
- Exposes **agent endpoints** at `/agent/*` gated by `Authorization: Bearer REPORT_TOKEN`. The agent VMs receive `REPORT_TOKEN` in cloud-init, so anyone with `Microsoft.Compute/virtualMachines/read` on the resource group can read it.
- Verifies **GitHub webhook signatures** with `GH_WEBHOOK_SECRET` (HMAC-SHA256).

## Dashboard authentication

The `/status` dashboard has **no built-in authentication yet**. Before exposing your deployment publicly, enable **Azure App Service Easy Auth** with your preferred identity provider (Microsoft / GitHub / Google / custom OIDC) — Azure portal → your Web App → Authentication → Add identity provider. Easy Auth fronts every request before the controller sees it, so unauthenticated users never reach the dashboard.

A built-in password-based login is on the roadmap and tracked on a feature branch; until then, treat any deployment without Easy Auth as private.

## Known footguns

- `--dangerously-skip-permissions` is required for the agent's Claude Code invocation to act unattended. The guard rails are documented in `repo-template/CLAUDE.md` and `repo-template/DO_NOT_TOUCH.md`. Do not deploy CodeLegion against a repo you wouldn't trust a fast, unmonitored junior developer with.
- Cloud-init carries `REPORT_TOKEN` to each VM. Rotating it requires a fleet recycle.
- Branch protection on private repos requires GitHub Pro or higher; on free private repos CodeLegion will skip the branch-protection check and surface a yellow status.

## Supported versions

The latest tagged release on `main` is supported. Security fixes are released as patch versions. Older versions are not patched.
