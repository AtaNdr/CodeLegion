## Summary

<!-- One paragraph: what changes and why. -->

## Scope

<!-- Tick what applies. Single-concern PRs land faster. -->

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Build / CI

## Verification

<!-- How you confirmed the change works. Examples:
  - `node --check` all modified files
  - Loaded the dashboard locally and exercised the affected surface
  - Manually triggered the webhook flow with a test repo
-->

- [ ] `node --check` passes for modified files
- [ ] Inline browser script still parses (`new Function(INLINE_SCRIPT)`)
- [ ] Controller boots (`node index.js` exits to "listening on :8080")
- [ ] Affected user flow exercised end-to-end

## Notes for reviewers

<!-- Anything worth flagging — design tradeoffs, follow-ups, things deliberately not done. -->
