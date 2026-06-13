# Do Not Touch

> Files and paths the fleet will not edit. Add to this list as needed.

- `.github/`
- `infra/`
- `terraform/`
- `**/*.env*`
- `**/secrets/**`
- `migrations/`
- `db/seed/`
- `package-lock.json` (regenerate via `npm install`, don't hand-edit)
- `yarn.lock`
- `pnpm-lock.yaml`
- `Cargo.lock`
- `go.sum`
- This file itself
