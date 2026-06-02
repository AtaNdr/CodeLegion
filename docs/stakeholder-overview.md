<!--
marp: true
theme: default
paginate: true
size: 16:9
-->

# CodeLegion

**A fleet of autonomous Claude Code agents for GitHub issue resolution.**

Stakeholder briefing — strategic and technical overview.

---

## The problem

Every engineering team accumulates **well-scoped, low-leverage work** that competes with high-leverage projects for attention:

- Bug fixes with clear reproductions
- Dependency bumps and security patches
- Test additions for existing behaviour
- Mechanical refactors

> *"Software developers spend a significant portion of their workweek — between 25% and 50% — on maintenance and bug-fixing rather than on new features."*
> — McKinsey & Company, *Unleashing developer productivity with generative AI* (June 2023)

The backlog **grows faster than it shrinks** in most teams. Senior engineers are the bottleneck, but the work doesn't require senior engineers.

---

## Why this is solvable now

Frontier coding LLMs crossed a usefulness threshold for unattended work in 2024–2025.

**SWE-bench Verified** — a benchmark of real GitHub issues from popular open-source repositories:

- Models in 2023: low single-digit pass rates.
- Frontier models in 2025: **substantial fractions of real issues resolved end-to-end**.

> *"Developers using GitHub Copilot completed tasks **55% faster**; **74% reported feeling more focused on satisfying work**."*
> — GitHub, *Quantifying GitHub Copilot's impact on developer productivity and happiness* (2022)

The capability is now **reliable enough for unattended use** on the right kind of work, with the right guardrails.

---

## What the right solution must do

Five non-negotiable criteria for a stakeholder-grade automation system:

1. **Unattended** — no human-in-loop for routine work.
2. **Auditable** — every action visible on GitHub (issue comments, PR diffs).
3. **Secure by default** — no broad credentials on workers; branch protection enforced.
4. **Cost-controlled** — pay only for work done; hard caps.
5. **Native to existing workflow** — GitHub Issues and PRs, no new tools.

**A solution missing any one of these is not deployable in a serious environment.**

---

## Why CodeLegion

| Option | Trade-off |
|---|---|
| **Manual triage by engineers** | Burns senior engineer time. Does not scale with backlog. |
| **GitHub Actions runner + LLM** | Tied to Actions' 6-hour limit; harder isolation; no persistent fleet state. |
| **Devin / Copilot Workspace (SaaS)** | Per-seat pricing. Third-party data sharing. Vendor lock-in. |
| **DIY agent framework** | 4–8 person-weeks of plumbing per team to reach feature parity. |
| **CodeLegion** | One Azure Web App. Open source. Self-hosted. Per-token cost only. |

**CodeLegion is the only option that is simultaneously unattended, auditable, self-hosted, and economical at small scale.**

---

## The approach

**One Web App. One fleet. One repository.**

```
[GitHub Issue]  →  [Webhook]  →  [Controller (Azure Web App)]
                                          │
                                          │  reconcile loop (45s)
                                          ▼
                                  [Spin agent VM]
                                          │
                                          │  claim, plan, code, test
                                          ▼
                                  [Pull request]
                                          │
                                          ▼
                                  [Human review → merge]
```

- **Wake-on-demand VMs** — spun only when issues exist; self-deallocate after 10 idle minutes.
- **Label-driven dispatch** — `agent-ready` + `model:sonnet|haiku|opus` routes work to the right model tier.
- **All state on the Web App's persistent disk** — no Key Vault, no database, no shared store.
- **GitHub App authentication** — short-lived installation tokens; the private key never leaves the controller.

---

## What CodeLegion offers

**Engineering automation**
- Label-driven dispatch with per-issue model routing.
- Triage proposals for ambiguous issues — agent waits for human approval before writing code.
- Automatic test generation against each acceptance criterion.
- Per-task cost summary commented on the issue.

**Operations**
- One-click Stop / Start fleet — full cost pause.
- Three-scope Uninstall (repo files, Azure resources, both) with typed confirmation.
- Edit VM sizes and Anthropic pricing without redeploying.
- Surgical dashboard auto-refresh — Fleet only, the rest stays stable.

**Reliability**
- Race-resolved claim mechanism (lexicographic label tie-break).
- Orphan resource cleanup (VMs, NICs, disks).
- Self-updating agent VMs — fleet adopts new agent code within one poll cycle.

---

## How good it is

| Dimension | Status |
|---|---|
| **Production usage** | Active on the maintainer's projects. |
| **Time to first PR** | ~3 minutes from issue creation to running agent. |
| **Operational floor** | $13 / month Web App + ~$35 / month networking. Variable: per-task Anthropic spend. |
| **Typical scoped issue** | $0.03 – $0.30 in tokens, 5 – 30 minutes runtime. |
| **Code quality gates** | Branch protection + 1 review + CODEOWNERS. Tests per acceptance criterion. |
| **Observability** | Per-VM live state, 50-cycle reconcile history, full audit trail on GitHub. |
| **Footprint** | Small controller (~5K LOC). Single-instance by design. |

**Fit profile:** teams of 1–20 engineers; repositories with a steady backlog of scoped issues; codebases where acceptance criteria can be stated as a checklist.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| **LLM produces incorrect code** | Every PR is human-reviewed. Tests required per acceptance criterion. Branch protection prevents direct main pushes. |
| **Unbounded API spend** | Per-task budget caps (time, tokens, turns). Hard agent caps per model. Stop-fleet single click. Cost visible per task and per month. |
| **Dashboard exposed publicly** | Azure App Service Easy Auth available today. Built-in password gate is in active design (see `auth/IMPLEMENTATION-PLAN.md`). |
| **Single-instance failure** | App Service auto-restart. Persistent disk survives restarts. Reconcile picks up within ~45 s. |
| **LLM provider lock-in** | Agents use Claude Code's CLI; the prompt-driven interface is portable to other providers with comparable capability. |

---

## Roadmap

**Shipping next**
- Dashboard authentication — password + cookie, optional Key Vault multi-user with invite flow.
- Configurable feature flags via App Settings — operators disable what they don't need.
- Operational hardening — broader audit logs, additional auto-remediation paths.

**Explicitly not on the roadmap**
- AWS or GCP support.
- Horizontal scaling.
- Multi-repository per fleet.

These are out of scope **by design** — each would compromise the single-Web-App simplicity that makes the project deployable in ~15 minutes.

---

## Summary and ask

**CodeLegion turns a labeled GitHub issue into a reviewed pull request — unattended, for pennies-per-task plus the platform floor.**

- Built on the proven capability of frontier coding LLMs.
- Deployable to Azure in ~15 minutes.
- Self-hostable, open source, no SaaS dependency.
- Active in production today.

**Decisions sought from stakeholders:**

1. Approval to extend deployment to additional teams / repositories.
2. Direction on the dashboard authentication priority — multi-user with invite flow, or single shared password first.
3. Feedback on scope criteria — which classes of issues to label `agent-ready` and which to keep manual.

---

## References

- McKinsey & Company. *Unleashing developer productivity with generative AI.* June 2023.
  https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/unleashing-developer-productivity-with-generative-ai
- Kalliamvakou, E. *Research: quantifying GitHub Copilot's impact on developer productivity and happiness.* GitHub Blog, September 2022.
  https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-on-developer-productivity-and-happiness/
- Jimenez, C. et al. *SWE-bench Verified: a human-validated subset of SWE-bench.* OpenAI / Princeton, 2024.
  https://openai.com/index/introducing-swe-bench-verified/
- Anthropic. *Claude model documentation and benchmarks.*
  https://www.anthropic.com/

Project repository: https://github.com/AtaNdr/CodeLegion · Implementation plan for auth: [`auth/IMPLEMENTATION-PLAN.md`](../auth/IMPLEMENTATION-PLAN.md)
