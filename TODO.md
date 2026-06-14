# Open work

This file lists work that is planned but not yet built. It exists so contributors can see at a glance where help is most useful, what the constraints are, and how each item fits into the rest of the project. Each entry is sized so that a single contributor can take it on without blocking on a maintainer.

If you are interested in any item, please open a GitHub issue first so the design can be discussed before code lands.

## Dashboard authentication

**Status:** designed, not built.
**Detailed design:** [`auth/IMPLEMENTATION-PLAN.md`](./auth/IMPLEMENTATION-PLAN.md).

The `/status` dashboard currently has no built-in authentication. Operators are expected to gate it externally — typically with Azure App Service Authentication (Easy Auth). This works well and is the recommended approach today, but it leaves operators who deploy outside Azure, or who want per-user credentials and audit logs, with extra setup of their own.

The plan in `auth/IMPLEMENTATION-PLAN.md` describes a three-mode layered approach: keep Easy Auth as one supported option, add a single shared password backed by App Settings, and add a multi-user mode backed by Key Vault with an invite flow. The single-password implementation is preserved on the `feat/dashboard-auth` branch as the starting point.

The work is broken into four small phases of roughly one day each (refactor, Key Vault user store, email and invite UX, tests and docs). A reasonable v1 scope reduction is to ship the first two phases with manual invite links and leave SMTP for a follow-up.

If you pick this up, please coordinate with the maintainer first — this surface affects every deployment and the design questions in the plan should be settled before any code merges.

## Configurable feature flags

**Status:** idea.

A number of features in CodeLegion are currently always-on or always-off based on code paths (for example: triage proposals for vague issues, the cost-summary comment, the self-update check on agent VMs). It would be useful for operators to toggle these via App Settings rather than by editing code.

The work is small but needs a careful pass to identify which features genuinely benefit from a flag versus which are core behaviour. A short design document listing candidate flags and their default values would be a good first contribution before any code changes.

## Operational hardening

**Status:** ongoing, accepts incremental contributions.

Two areas where small, focused pull requests are welcome:

- **Broader audit logs.** Today the activity timeline captures agent lifecycle events. Operator actions on the dashboard (Stop, Start, Uninstall, configuration edits) are visible only in the controller log. Persisting these to `/home/data/audit.jsonl` with rotation, in the same shape as the existing agent log, would make post-incident review much easier.
- **More reconcile auto-remediation paths.** The reconcile loop already detects and recovers from a handful of stuck states (failed VMs, orphan NICs, stale claims). Each new case that gets added has the form *detect → log → recover → record in history*. Good first issues for someone who wants to learn the controller side.

## Out of scope

These items are deliberately not on the roadmap and pull requests adding them will likely be declined. Listed here so contributors do not invest time unnecessarily:

- **AWS or GCP support.** CodeLegion is Azure-only by design. The control plane assumes ARM, Azure managed identities, and App Service. Porting would be a rewrite, not a contribution.
- **Horizontal scaling.** CodeLegion is single-instance by design. State lives on the Web App's persistent disk; a second instance would need a shared store and coordination that the project does not want to take on.
- **Multi-repo per fleet.** One fleet operates one repository. Operators who want multiple repositories deploy multiple fleets.

## Reporting and discussion

For anything in this file, please open an issue before starting work. For anything *not* in this file that you think should be, an issue is the right place to raise it.
