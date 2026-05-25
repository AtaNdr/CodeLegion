# Comment Style

How agents format comments and PR descriptions for fast human comprehension. This guide is read by every agent before posting on issues or PRs.

The goal: a reviewer scanning a long thread can tell at a glance what each comment is for, without reading the prose. Personality shapes *voice*; structure here shapes *scannability*. Both apply to every comment.

## The rules

1. **Markers are semantic, not decorative.** Each marker means one specific thing. Don't add emoji or alerts because the comment "feels" celebratory or warm — only when they signal a category of message.
2. **One marker per comment, at the top.** Don't sprinkle emoji through prose. The marker tells the reviewer what this comment *is*.
3. **Use GitHub alert blocks for important signals.** They render with native color and icons in the GitHub UI, are accessible, and don't depend on emoji rendering.
4. **No decorative emoji anywhere.** No 🎉 🚀 ✨ 🔥 in PR descriptions, plans, or replies. Personality comes through in word choice, not visual flair.
5. **Short summary lines first.** Every comment opens with a one-line summary in the marker block. Detail follows in prose below.
6. **Personality stays in voice.** Atlas writes terse, Marigold writes warm — but both use the same markers and structure.

## Marker vocabulary

| Marker | Meaning | When to use |
|---|---|---|
| 📋 **Plan** | "Here's how I'll approach this" | First comment after claiming an issue, before coding |
| 🔍 **Triage proposal** | "This issue needs structuring before I code" | When proposing a reformat or split (see CLAUDE.md triage section) |
| 🟢 **Ready for review** | "PR is up, please review" | When linking the PR back to the issue |
| 🔁 **Iterating** | "Picking this up again after review feedback" | First comment when re-claiming a needs-revision issue |
| ❓ **Blocked on input** | "I need a human decision to proceed" | When adding `agent:blocked` |
| ⏸️ **Paused** | "I stopped for a non-blocking reason" | Budget hit, stuck in a loop, releasing the claim |
| 💰 **Cost report** | Token + dollar summary for an iteration | Posted by the controller after each task — agents don't post these themselves |

That's the complete vocabulary. **Don't invent new markers.** If a comment doesn't fit one of these, it doesn't need a marker — write plain prose.

## GitHub alert blocks

Use these inside comments for sub-signals — they render in color, are accessible, and stand out without being noisy:

- `> [!NOTE]` — informational context the reviewer should see
- `> [!TIP]` — a suggestion the reviewer might consider (e.g., "you might want to handle X in a follow-up")
- `> [!IMPORTANT]` — must-read before approving (e.g., "this changes API response shape")
- `> [!WARNING]` — known risks the reviewer should weigh (e.g., "this is faster but uses ~2x memory at peak")
- `> [!CAUTION]` — things that could break in production (e.g., "untested under high concurrency")

Use sparingly. A PR with five `[!WARNING]` blocks loses meaning fast. One per real concern.

## Comment templates

### Plan comment (first comment after claiming an issue)

```markdown
## 📋 Plan

[One sentence: what I'm going to do.]

**Approach:**
- Step 1...
- Step 2...
- Step 3...

**Tests I'll add:**
- ...

**Out of scope:**
- ...

> [!NOTE]
> [Anything the reviewer should know before I code, or any assumption I'm making.]

— [signoff]
```

### PR-link comment (after opening the PR)

```markdown
## 🟢 Ready for review

PR: #<num>

[One-line summary of what changed and what to focus on in review.]

— [signoff]
```

### Re-pickup comment (after rejection)

```markdown
## 🔁 Iterating

Read the review. Addressing:
- [comment thread] → [what I'm changing]
- [comment thread] → [what I'm changing]

[Optional: > [!NOTE] if I'm pushing back on a review comment with reasoning.]

— [signoff]
```

### Blocked comment

```markdown
## ❓ Blocked on input

[Specific question. One paragraph max.]

> [!IMPORTANT]
> Adding `agent:blocked`. Will resume when this is answered and the label is removed.

— [signoff]
```

### Paused comment

```markdown
## ⏸️ Paused — [budget exhausted | stuck in loop | other reason]

[What I did so far. What I didn't get to. What state the branch is in.]

Releasing claim so a human or another agent can take a look.

— [signoff]
```

## PR description style

The PR description follows the template in `CLAUDE.md`. A few additions for scannability:

- **Use `> [!IMPORTANT]`** in the "Risks / things to watch" section if the change touches anything reviewer-critical (auth, data shape, public API, migrations)
- **Use `> [!NOTE]`** in "Out of scope" if you noticed something worth a follow-up issue
- **No marker emoji in the PR title.** Title stays plain prose. The marker convention is for comments only.

## What this looks like in a thread

A real issue thread should read like:

```
PM: [issue body]

Juniper 🌲: ## 📋 Plan
              I'll add a /export endpoint and wire the button...

Juniper 🌲: ## 🟢 Ready for review
              PR: #128. Focus on the error path — I added retry logic.

Reviewer: [requests changes]

Juniper 🌲: ## 🔁 Iterating
              Addressing your three comments...

Juniper 🌲: ## 🟢 Ready for review
              Updated. The retry now backs off exponentially.

[merged]
```

A reviewer scrolling can find the current state in two seconds: latest 🟢, was it 🔁'd before, any ❓ or ⏸️ stalled it.

## What not to do

These are common mistakes — avoid them:

- ❌ `## 🎉 Plan` (decorative emoji on top of marker)
- ❌ "I've completed the task! 🚀✨" (decorative emoji in prose)
- ❌ "## ✅ Done" (invented marker — use 🟢 Ready for review)
- ❌ Five `> [!WARNING]` blocks in one PR (noise)
- ❌ Personality-specific markers ("Atlas always uses 🗿") — markers are universal
- ❌ Emoji in error messages, log output, or technical content (already banned in `DESIGN_DEFAULTS.md`)

## Why this exists

A reviewer's time is the bottleneck. Markers reduce time-to-comprehension. Voice variation between agents makes individual comments more pleasant to read. Both serve the reviewer — neither is for the agent's benefit.

If you (the agent) find yourself wanting to add a marker that's not in this vocabulary, the answer is no. The vocabulary is closed on purpose.
