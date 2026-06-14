# AI review prompt

Use this to collect first-look reviews from third-party AI chat tools (ChatGPT, Gemini, Grok, Le Chat, DeepSeek, etc.) for the **Reviews** section of the landing page.

The point isn't to fish for praise — it's to get a fast, specific outside read of the project's design that's easy to scan on a landing page. AI reviewers are stop-gap social proof until real users post their experiences on GitHub Discussions, Twitter, or blog posts.

---

## Usage

1. Open the AI chat tool of your choice.
2. Paste the **prompt below**.
3. Below it, paste the contents of `README.md`, `SETUP.md`, and `PLAN.md` (each separated by a `---`).
4. Copy the model's response.
5. Drop it into `docs/reviews.md` under a new model heading (see the template at the bottom of this file).
6. Send the updated `reviews.md` back to me and I'll embed the responses into the public landing page at <https://codelegion.atanaderi.dev>.

---

## The prompt (copy from here)

> I want an honest first-look review of an open-source project. Below are the project's `README.md`, `SETUP.md`, and `PLAN.md`. Based **only on what you read in those files** — no boilerplate, no assumptions about features that aren't mentioned — give me:
>
> 1. **One sentence on the strongest design choice you see.**
> 2. **One sentence naming a substantive concern, trade-off, or limitation.**
> 3. **One sentence on the best-fit use case.**
>
> Then, after those three lines, write a **single 60–80 word paragraph** that synthesises the above into a pull-quote suitable for a landing page — concrete, specific to this project, no marketing fluff.
>
> Sign off with your model name and the provider (e.g. *"— ChatGPT 4o, OpenAI"*).
>
> ---
> README.md:
> [paste]
>
> ---
> SETUP.md:
> [paste]
>
> ---
> PLAN.md:
> [paste]

---

## Where to record the responses

Once you have a response, paste it into `docs/reviews.md` using the structure below. Then send me that file (or just the new entries) and I'll port them into the landing page's `reviews` array.

### Template

```markdown
## ChatGPT 4o · OpenAI

**Strongest design choice:** ...

**Concern:** ...

**Best-fit use case:** ...

**Pull-quote (for the landing page):**
> ...
```

Repeat the block for each model you sample.

---

## Suggested models to sample

Aim for **3–5 distinct providers** for visual variety and to avoid implicit bias:

- **Claude Opus 4.7** (Anthropic) — already on the page.
- **ChatGPT 4o** or **GPT-5** (OpenAI)
- **Gemini 2.5 Pro** (Google)
- **Grok 4** (xAI)
- **Le Chat** (Mistral)
- **DeepSeek V3 / R1**
- **Llama 3.3 / 4** (Meta) — via Together / Replicate / Groq

You don't need every model — three good responses beat five generic ones. Aim for variety in provider, not in length.

---

## What "good" looks like in a response

Look for the AI's review to **name a specific thing in the codebase or architecture**. Examples of substantive vs generic:

| ❌ Generic (skip) | ✓ Specific (use) |
|---|---|
| *"This is a well-designed project with clear documentation."* | *"The 45-second reconcile loop + 90-second hint TTL bounds the worst-case 'orphaned issue' to ~135 seconds without distributed locking."* |
| *"Great use of Azure."* | *"Choosing App Service over Functions for the controller is the right call — agent tasks routinely run 30+ minutes and Functions' execution cap would force fragmenting state."* |
| *"Could benefit from more features."* | *"Single-instance state on the local persistent disk caps horizontal scaling, which is fine at this scale but blocks multi-tenant operation if that's ever in scope."* |

If a response is generic, prompt the model again with: *"That was too generic. Name a specific design choice from the docs and give me a concrete concern. No 'innovative' or 'comprehensive'."*

---

## When to retire AI reviews

The AI section is meant to be temporary. Replace each AI card with a human testimonial once you collect one through GitHub Discussions, Twitter, a deployment write-up, or direct email. The visual treatment for human testimonials is the same card layout — just swap the `[AI Review]` badge for a person/company avatar and update the source field.
