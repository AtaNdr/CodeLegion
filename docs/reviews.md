# AI reviews

First-look evaluations of CodeLegion from third-party AI models, collected with the prompt in [`ai-review-prompt.md`](./ai-review-prompt.md). Embedded into the public landing page at <https://codelegion.atanaderi.dev> as the **Reviews** section.

These are AI-generated, clearly labelled, and meant as a stop-gap until real-user testimonials arrive via GitHub Discussions / Twitter / blog posts. Each new response goes through the prompt template unedited; the **Pull-quote** field is what appears on the landing page.

---

## Claude Opus 4.7 · Anthropic

**Strongest design choice:** A single Azure App Service hosts every secret, dispatches agents to VMs it spawns on demand, and surfaces every operation through a coherent dashboard — under 6K lines of controller code.

**Concern:** State lives on the Web App's local persistent disk, so single-instance is structural, not incidental — fine at this scale, but it caps the upper bound for multi-tenant operation.

**Best-fit use case:** A team of 1–20 engineers with a steady backlog of well-scoped GitHub issues (bug fixes, dependency bumps, mechanical refactors) where the cost of senior-engineer attention exceeds the cost of careful PR review.

**Pull-quote (for the landing page):**
> The single-Web-App design is the strongest choice — one Azure App Service holds every secret, spawns its own fleet of agent VMs on demand, and surfaces operations through a coherent dashboard, under 6K lines of controller code. One concern: state on the local persistent disk caps horizontal scaling, which is a deliberate trade-off worth knowing. Best fit: teams of 1–20 engineers with a steady backlog of well-scoped GitHub issues.

---

<!--
Add new responses below using this template:

## <Model name> · <Provider>

**Strongest design choice:** ...

**Concern:** ...

**Best-fit use case:** ...

**Pull-quote (for the landing page):**
> ...
-->
