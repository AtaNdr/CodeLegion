# Using Claude Code skills with CodeLegion agents

CodeLegion runs Claude Code on each agent VM. Claude Code has a built-in **skills** mechanism — reusable, named capabilities Claude can invoke when a user's intent matches the skill's description. You can add your own; CodeLegion picks them up automatically.

## Where to put them

Drop skill files into `.claude/skills/` inside your **target repo** (the repo CodeLegion is wired to work on). Each agent clones the repo on boot into `/workspace`, and Claude Code reads project-scoped skills from `<repo>/.claude/skills/` automatically.

```
your-repo/
├── .claude/
│   └── skills/
│       ├── triage-bugs.md
│       ├── dependency-bump.md
│       └── refactor-tests.md
├── codelegion/
│   └── …
├── CLAUDE.md
└── (your code)
```

No CodeLegion configuration is required.

## What a skill file looks like

A markdown file with YAML frontmatter and a body. The frontmatter tells Claude when to invoke the skill; the body is the instruction set Claude follows when it does.

```markdown
---
name: triage-bugs
description: Triage a bug-shaped GitHub issue by classifying severity, reproducing locally, and proposing the smallest fix. Use when an issue is labeled "bug" and the reporter has provided a description but no clear repro.
---

Read the issue.

1. Classify severity (P0–P3).
2. Try to reproduce with the smallest case you can write.
3. Propose a fix that touches the fewest files.
4. Open a draft PR with the proposed fix and the repro test.

Stop and ask for clarification if step 2 fails — don't guess at intent.
```

Two fields are required:

- `name` — short kebab-case identifier.
- `description` — what the skill does and when it should fire. Claude uses this to decide whether to invoke the skill. Be specific; a vague description will either over-fire or never fire.

An optional third:

- `allowed-tools` — comma-separated list of tools the skill is allowed to use. Useful for narrowing the surface (e.g., a read-only investigation skill that mustn't call `Edit` or `Bash`).

## When Claude invokes a skill

Claude picks a skill when the description matches what the operator's task asks for. With CodeLegion, the "operator" is the agent's task prompt — assembled by `agent-loop.sh` from the issue, the contract files, and the model's interpretation. A skill named `dependency-bump` with the description "Update a single npm/pip/etc. dependency to the latest stable version and verify the lockfile" will fire when the agent claims an issue whose acceptance criteria boil down to "bump X". It won't fire on an unrelated refactor.

You can also reference a skill by name from inside CLAUDE.md or any context file — e.g., *"For dependency bumps, use the `dependency-bump` skill"*.

## Iteration loop

1. Add or edit a skill file in your repo.
2. Commit. Open a PR. Merge.
3. Next agent that claims an issue clones the repo at the new commit. Skill is live.

For the agent to be running the very latest code, nothing else needs to change — the fresh clone on every spin guarantees it.

## What CodeLegion does *not* do

- It doesn't ship its own skills bundled with the controller.
- It doesn't sync user-level skills (`~/.claude/skills/`) across agents. Each VM starts with an empty home, so user-scoped skills aren't a fleet concept here. If you want the same skill available across many repos, just commit it to each repo's `.claude/skills/` — copy-paste is the right move at this scale.
- It doesn't validate skill files. If a frontmatter field is malformed, Claude Code surfaces the error on the agent's invocation; it won't break the controller.

## Further reading

Skills are part of Claude Code itself, not CodeLegion. For the canonical reference:

- Claude Code skills documentation: https://docs.claude.com/en/docs/claude-code (search for "skills").
- The `description` field guidance is the part most worth reading carefully — it's the difference between a skill that fires when it should and one that doesn't.
