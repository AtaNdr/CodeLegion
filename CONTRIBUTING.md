# Contributing

Thanks for considering a contribution — the short version is:

1. **Open an issue first** for anything non-trivial. A 30-second alignment check saves time on both sides.
2. **Fork → branch → PR.** Target `main`.
3. **One concern per PR.** Drive-by refactors hide what's being reviewed.
4. **Tests for new behaviour where there's existing test coverage.** This project doesn't yet have a full test suite — call out anything that should be tested when it lands.
5. **Match the existing style.** No new dependencies without justification; the controller intentionally has a small footprint.

## Local development

```bash
git clone https://github.com/AtaNdr/CodeLegion.git
cd CodeLegion
npm install
node --check index.js  # syntax check
```

You can boot the controller without Azure credentials — it'll log missing config and the discovery/Flow 1 paths won't work, but the HTTP surface comes up so you can iterate on UI and routing locally.

## What kinds of contributions are welcome

- **Bug fixes** — especially around the agent lifecycle, reconcile races, and Azure resource leaks.
- **Diagnostic / observability improvements** — making the dashboard show *why* something is wrong (not just *that* it is) is high value.
- **Documentation** — SETUP.md walkthrough refinements, screenshots, troubleshooting.
- **New cloud targets** — AWS support is on the roadmap; talk to the maintainer before starting work.

## What probably won't merge without discussion

- New external dependencies in `package.json`.
- Multi-instance / horizontal scaling changes (explicitly out of scope — see `PLAN.md`).
- Authentication providers beyond password + Easy Auth (we have one of each; add a new one only if it solves a real problem).

## Filing security issues

**Do not** open a public GitHub issue for security reports. See [`SECURITY.md`](./SECURITY.md).
