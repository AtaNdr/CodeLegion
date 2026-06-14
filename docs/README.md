# Documentation

Supplementary documentation that lives outside the project root. The public landing page lives at <https://codelegion.atanaderi.dev>; everything here is reference material for operators, contributors, and reviewers.

| File | Audience | Purpose |
|---|---|---|
| [`FAQ.md`](./FAQ.md) | Operators, contributors | Roughly fifty questions across project, deployment, operations, security, internals, cost, updates, and behaviour. |
| [`stakeholder-overview.md`](./stakeholder-overview.md) | Technical and strategic stakeholders | High-level briefing for executive review. Multi-page; suitable for export to slides via Marp or pandoc. An HTML version of this deck also lives in this folder. |
| [`CodeLegion_Deck.html`](./CodeLegion_Deck.html) | Technical and strategic stakeholders | Self-contained HTML slide deck with the same content as `stakeholder-overview.md`. |
| [`engineering.md`](./engineering.md) | Engineers, technical reviewers | Tech profile (stack, dependencies, code layout) and a commit-by-commit timeline of the recent development session with token and cost estimates. |
| [`skills.md`](./skills.md) | Operators wanting custom agent behaviour | How to add Claude Code skills to your target repository so CodeLegion agents pick them up. No controller configuration needed — agents inherit project-scoped skills via the repository clone. |
| [`reviews.md`](./reviews.md) | Maintainer (working file) | Collected AI-evaluator reviews of the project. New responses are added here using the template; they are then ported into the landing page's reviews section. |
| [`ai-review-prompt.md`](./ai-review-prompt.md) | Maintainer (workflow) | The prompt to paste into ChatGPT, Gemini, Grok, and similar tools when collecting more AI reviews. Includes guidance on what makes a useful response versus a generic one. |

For step-by-step deployment instructions see [`../SETUP.md`](../SETUP.md). For the architecture specification see [`../PLAN.md`](../PLAN.md). For the security model and disclosure process see [`../SECURITY.md`](../SECURITY.md). For open work see [`../TODO.md`](../TODO.md).
