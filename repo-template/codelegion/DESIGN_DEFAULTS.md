# Design Defaults

These are universal floors that apply to every repo, regardless of what `DESIGN.md` says. They are non-negotiable. The per-repo `DESIGN.md` extends these with project-specific choices.

## Accessibility (WCAG 2.1 AA minimum)

- All interactive elements must be keyboard reachable and operable with logical tab order
- Visible focus states on every focusable element (no removing outlines without replacement)
- Text contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI components
- Form fields have associated labels (not just placeholders)
- Images have meaningful `alt` text or `alt=""` if decorative
- ARIA used only when semantic HTML can't do the job — and used correctly when used
- Touch targets ≥ 44×44 px on mobile

## Motion

- Respect `prefers-reduced-motion` — provide a no-motion fallback
- No essential information conveyed by motion alone
- Avoid auto-playing video or audio
- Animation duration ≤ 300ms unless functionally necessary

## Forms and feedback

- Errors describe the problem and how to fix it (never just "Invalid input")
- Loading states for any operation > 200ms
- Destructive actions require confirmation
- No emoji in error messages or critical system feedback

## Agent communication

- No decorative emoji in PR descriptions, plans, replies, or any agent-authored comment
- Only the closed marker vocabulary defined in `COMMENT_STYLE.md` is permitted
- GitHub alert blocks (`> [!NOTE]` etc.) for sub-signals, not custom color or formatting hacks
- Personality variation lives in word choice and rhythm; never in visual flair

## Internationalization-readiness

- No hard-coded user-facing strings in components — use the project's i18n approach if one exists, or at minimum centralize strings so they can be extracted later
- Don't assume LTR layout in CSS where it could break (`margin-inline-start` over `margin-left` when reasonable)

## Performance floor

- Don't ship images larger than 2x their displayed size
- Don't import a library to do what 5 lines of code can do
- Lazy-load below-the-fold images
- Don't block the main thread on synchronous heavy work

## Things to never do

- Disable browser zoom
- Use `outline: none` without a replacement focus indicator
- Auto-focus on inputs in a way that traps screen readers or jumps the page
- Remove semantic elements in favor of `<div>` soup

When the per-repo `DESIGN.md` contradicts something here, the floor wins. If a project genuinely needs an exception, the human team must explicitly carve it out in `DESIGN.md` with a justification — agents won't make that call alone.
