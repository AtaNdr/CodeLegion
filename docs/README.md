# Documentation

Supplementary documentation that lives outside the project root.

| File | Audience | Purpose |
|---|---|---|
| [`index.html`](./index.html) | Anyone landing on the project | Public landing page. Light/dark theme, modern animations, quick-start, feature grid. Serve via GitHub Pages by setting Pages source to `/docs`, or copy to Cloudflare Pages / Vercel. |
| [`FAQ.md`](./FAQ.md) | Operators, contributors | ~50 questions across project, deployment, operations, security, internals, cost, updates, and behaviour. |
| [`stakeholder-overview.md`](./stakeholder-overview.md) | Tech and strategic stakeholders | High-level briefing for executive review. Multi-page; suitable for export to slides via Marp or pandoc. An HTML version of this deck also lives in this folder. |
| [`CodeLegion_Deck.html`](./CodeLegion_Deck.html) | Tech and strategic stakeholders | Self-contained HTML slide deck with the same content as `stakeholder-overview.md`. |
| [`engineering.md`](./engineering.md) | Engineers, technical reviewers | Tech profile (stack, dependencies, code layout) + a commit-by-commit timeline of the recent development session with token and cost estimates. |

For step-by-step deployment instructions see [`../SETUP.md`](../SETUP.md). For the architecture specification see [`../PLAN.md`](../PLAN.md). For the security model and disclosure process see [`../SECURITY.md`](../SECURITY.md).
