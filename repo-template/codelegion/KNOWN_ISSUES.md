# Known Issues

> Things that look broken but aren't. Save agents from "fixing" them.

Examples:
- The retry logic in `src/api/client.ts` looks redundant but it's there because of a known race condition with the upstream API. Don't simplify it.
- `tests/legacy/` are skipped on purpose. Don't enable them.
- The duplicate `formatDate` functions in `utils/` and `helpers/` exist because the helpers version handles a vendor-specific edge case. They'll be merged in #234 — don't touch yet.
