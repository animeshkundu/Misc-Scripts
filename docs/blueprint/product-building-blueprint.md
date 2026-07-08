# Product-Building Blueprint: How We Think About Building Products

**Premise.** This is a living document about *method*, not about any single product. It captures the way we reason from a raw idea to a shipped thing: how we test whether something is even possible before we design it, how we treat every claim as a hypothesis until a real machine proves it, and how we assemble validated pieces into a working whole. The object-level product below is the worked example. The durable value is the reusable thinking pattern — usable on the next product, and the one after that. Read it when you are staring at an ambitious idea and unsure where to push first.

---

## The product in one paragraph

We are building a **fully autonomous, human-gated blogging agent that runs entirely on GitHub infrastructure**: deep internet research → cross-validate and fact-check for truth → write in a human voice → self-review → cross-review on a different model → a quality/voice editing pass → publish by opening a pull request that a human merges. The merge is the human gate; there is no server to run. The design leans on keyless GitHub Models inference on Actions runners (with the Copilot SDK as an escalation path when agentic Claude-class models are needed), an Astro + MDX + Zod static blog as the write surface, and a reuse-first pipeline built on the GPT-Researcher + LangGraph lineage rather than from scratch. **Full depth — the empirical runner findings, the SSG comparison, the pipeline design, residual decisions — lives in [`../research/README.md`](../research/README.md).** This blueprint does not duplicate it; it points at it.

---

## The method

The principles below are the actual product. Each is tied to a concrete moment from the build so it stays honest and copyable, not abstract.

### 1. Start from feasibility, not the solution
Open with the question that can kill the project, not with a design. The first move here was not "let's build a blogging agent" — it was **"Can we call GitHub Copilot APIs / inference from a GitHub runner at all?"** Feasibility is the cheapest thing to check and the most expensive thing to get wrong late. If the answer is no, every hour of design downstream was waste. Ask *is X even possible, and is it sanctioned* before you ask *how should X look*.

### 2. Research, then distrust the research — verify empirically on real infrastructure
A document, a blog post, even official docs — those are **hypotheses**. A green run on an actual runner is **proof**. We researched the Copilot-vs-Models landscape thoroughly, then deliberately **pivoted from reading to proving**: stand up a repo, add a workflow, run it, read the logs. This is the spine of everything. It is also self-correcting about our *own* research: once the live runs came in, they contradicted parts of the written brief (a "Grok-3 available" claim, a "gpt-5.5 present" assumption), and the runs won. The research told us where to look; the runner told us what is true. Verify, don't assert — and when the machine disagrees with the doc, the machine is right.

### 3. Disambiguate the things everyone conflates
Before you can test feasibility you often have to *split the question*. Early research separated three things that are casually treated as one: **GitHub Models** (official, keyless, OpenAI-compatible catalog), **Copilot's private internal API** (`api.githubcopilot.com`, IDE-only, not a sanctioned surface), and the **Copilot SDK/CLI** (agentic runtime, needs a seat token). A later push — "are gpt-5.5 / opus-4.8 / gemini-3.1-pro available?" — forced the same discipline again, surfacing that the Copilot model *picker* and the GitHub *Models* catalog are different lists with different contents. Naming things precisely is not pedantry; it is what makes a feasibility test actually testable.

### 4. Prefer the keyless / native / no-secret path; escalate only when forced
Rank your options by how little trust and setup they demand, and reach for the cheapest first. The order here was explicit: **GitHub Models (keyless, `GITHUB_TOKEN` + `models: read`, zero secrets) → Copilot seat token (a real secret, but native) → external API keys (last resort).** We only escalated to the Copilot-seat path once we confirmed GitHub Models has no Claude/Gemini and no `gpt-5.5` on this account, i.e. only when the cheaper path genuinely could not do the job. Every secret you don't provision is an attack surface, a rotation burden, and a portability tax you avoided.

### 5. Handle secrets like they're radioactive
When a secret *is* required, move it without ever exposing it. The Copilot seat token was **piped from the OS keyring straight into a GitHub secret, never printed, never echoed, never pasted into a prompt or a log.** Reference secrets by path and by pipe, not by value. This is a standing rule, not a one-off courtesy to this project.

### 6. Parallelize independent explorations — and isolate them so they can't interfere
Work that doesn't depend on each other should run at the same time, in separate lanes. We ran the two infra probes (Copilot SDK, GitHub Models) *concurrently* with two product-research streams (best blog interface, existing autonomous pipelines) — four investigations in flight at once. Crucially they were **isolated**: separate repos/branches/dirs/files, so a mess in one couldn't corrupt another and each produced an independent, attributable result. Parallelism buys speed; isolation is what keeps that speed from turning into cross-contamination.

### 7. Insist on durable, reviewable artifacts — then check they're actually thorough
Every exploration had to leave behind a written review doc; ephemeral findings don't count. But the harder discipline came next: we **challenged whether the docs were genuinely thorough**, which triggered a line-by-line verification pass. That pass caught real defects — a superseded "Grok-3 available" claim, stale cross-links, a miscount — and fixed them. Thoroughness is a property you *verify*, not one you assume because a doc exists and looks complete. A polished doc that's wrong is more dangerous than no doc.

### 8. Reuse-first when you build — fork the closest skeleton, write only the missing rigor
Don't rebuild what already exists well. The pipeline verdict was to **stand on GPT-Researcher + a LangGraph spine** and spend our own effort only on the parts that are genuinely missing or genuinely ours: the citation-grounded fact-check stage, the voice/quality editor, the cross-model review gate. Find the nearest working skeleton, adopt it, and invest your scarce attention in the rigor no one else built for you.

### 9. Be honest about blockers and gray areas — a well-characterized "blocked by X" is a result
Do not paper over the parts that don't work. We named the gray zones plainly: the private Copilot proxy's ToS status, the fact that stripping "AI giveaways" is an arms race with no durable win (so the real edge is genuinely specific, sourced writing — framed as quality, not detector evasion), network reachability of an Entra-authed internal endpoint, and seat entitlement limits. A clearly documented "this is blocked by X, here's why" is worth more than an optimistic maybe, because the next person can act on it. Overpromising is a debt that comes due at the worst time.

### 10. Sequence the whole effort: what's possible → what's best → assemble
The macro-shape of the work is a gate chain. **Feasibility gates design; design gates build.** First we established what is *possible* (can we run inference on a runner, and how). Only then did we ask what is *best* (which SSG, which pipeline shape). Only then did we start *assembling* the final pieces. Doing these out of order — designing before feasibility, or building before choosing — is how projects sink cost into foundations that later prove impossible.

---

## Decision log

Chronological beats, phrased as **question → what we did → what we learned → what it changed.** This log is extensible; append new beats as the build continues.

### 2026-07-08 — 1. The opening feasibility question
- **Question:** Can we use GitHub Copilot APIs / inference *from GitHub runners*?
- **What we did:** Refused to start from a solution; demanded thorough research on this single feasibility question first.
- **What we learned:** This is the pivot the whole product hinges on — if inference can't run on a runner, the "no-server, GitHub-native" premise collapses.
- **What it changed:** Framed the entire effort as feasibility-first. Everything downstream became conditional on answering this.

### 2026-07-08 — 2. Disambiguating three "Copilot" things
- **Question:** What exactly are we allowed to call, and by what path?
- **What we did:** Separated GitHub Models (official, keyless, OpenAI-compatible) from Copilot's private internal API (`api.githubcopilot.com`, IDE-only) from the Copilot SDK.
- **What we learned:** The sanctioned surfaces are GitHub Models and the Copilot SDK; the private proxy is a gray area.
- **What it changed:** Gave us a clean two-path model (keyless Models vs seat-token SDK) to test, instead of one muddled "Copilot" idea.

### 2026-07-08 — 3. Pushing on specific models
- **Question:** Are gpt-5.5 / opus-4.8 / gemini-3.1-pro actually available?
- **What we did:** Pressed past the general answer to specific model IDs.
- **What we learned:** The Copilot model *picker* and the GitHub *Models* catalog are different lists; you cannot assume a model in one is in the other.
- **What it changed:** Set up the empirical catalog check and pre-emptively flagged that "available in Copilot" ≠ "available via Models."

### 2026-07-08 — 4. Pivot from reading to proving (Copilot SDK)
- **Question:** Does the Copilot SDK actually run on a runner?
- **What we did:** Via a subagent, created a **public** repo `Misc-Scripts`, added a workflow, and provisioned the Copilot seat token as a secret piped from the OS keyring — never printed.
- **What we learned (empirical):** The SDK works **only** with a Copilot-seat *user* token; the built-in `ghs_` token fails. Headless invocation needs `--allow-all-tools`.
- **What it changed:** Confirmed the escalation path is real but secret-gated, and set the secure secret-provisioning pattern for the project.

### 2026-07-08 — 5. Proving GitHub Models in parallel
- **Question:** Can we get keyless inference from a runner, and which models?
- **What we did:** In parallel with the SDK probe, ran "the best GitHub Models in a workflow."
- **What we learned (empirical):** GitHub Models works **keyless** with `GITHUB_TOKEN` + `models: read`. `gpt-5`/`o3` class: yes. Claude/Gemini: **no**. `gpt-5.5`: absent. Gotcha: use `max_completion_tokens`, not `max_tokens`.
- **What it changed:** Made keyless Models the default engine and `openai/gpt-5` the best available id; scoped the SDK path to when Claude-class agentic models are actually required.

### 2026-07-08 — 6. Product research in parallel with the infra probes
- **Question:** What should the blog *be*, and does a human-like autonomous pipeline already exist?
- **What we did:** Ran two more streams concurrently: best blog interface for an agent pipeline, and a meta-research on existing autonomous blogging pipelines.
- **What we learned:** Blog → **Astro + MDX + Zod** content collections (the Zod frontmatter gate catches the agent's main failure mode). Pipeline → **reuse GPT-Researcher + LangGraph**; and, honestly, removing "AI giveaways" is an arms race — the durable edge is genuinely specific, sourced writing.
- **What it changed:** Locked the write surface and the build-vs-reuse verdict, and reframed the "de-AI" stage as a quality/voice editor rather than a detector-evasion trick.

### 2026-07-08 — 7. Process discipline and the thoroughness audit
- **Question:** Are the research docs actually thorough, or just present?
- **What we did:** Required every subagent to produce a comprehensive review doc, then challenged whether the docs held up — triggering a line-by-line verification pass.
- **What we learned:** Real defects existed — a superseded "Grok-3 available" claim, stale cross-links, a miscount — and got fixed.
- **What it changed:** Organized everything into `docs/research/` + `examples/workflows/` with an index, and established that thoroughness is verified, not assumed.

### 2026-07-08 — 8. Assembling the final pieces (in flight)
- **Question:** What are the remaining pieces, and do they work end to end?
- **What we did:** Started validating three assembly candidates the same way (understand → verify locally/on a runner → document): **`condukt`** (a repo explored as a possible orchestrator / "final piece"), **GitHub-native *raw* web search** (raw URL pointers vs summarized answers, for the fact-check stage), and a **Bing-search MCP** from a gist (an Entra-authed internal Azure endpoint), tested locally then on a runner.
- **What we learned:** In progress — see the running log below.
- **What it changed:** Moving the project from "what's possible / what's best" into active assembly of the shipping pipeline.

---

## Running log — append below

> **This document is living.** New milestones, decisions, empirical results, and course-corrections get appended here over time — newest at the bottom, each stamped with a date and phrased the same way as the decision log (question → did → learned → changed). Keep the sections above stable; grow the story here.

### 2026-07-08 — 3 meta-exploration agents in flight
Three assembly probes running concurrently, each to be validated understand → verify → document: **condukt** (candidate orchestrator / final piece), **GitHub-native raw web search** (raw URL pointers for the fact-check stage), and the **Bing-search MCP** gist (Entra-authed internal Azure endpoint, local-then-runner test). Results to be logged here as they land.

### 2026-07-08 — GitHub-native raw web search — found, with a caveat
- **Question:** For the fact-check stage we need **raw source pointers** (URL + snippet lists to fetch and verify), not a summarized answer. Is there a GitHub-native surface that gives raw open-web results, ideally keyless on a runner?
- **Did:** Ran a meta-agent that fanned out research (Copilot CLI/SDK tools, Copilot Bing grounding, GitHub Models tool-calling, `gh search` / REST / GraphQL search), then empirically probed the most promising path on an `ubuntu-latest` runner across 5 varied queries + consistency re-runs + a negative control. Isolated on branch `web-search-probe`.
- **Learned:** The Copilot CLI's built-in `web_search` tool returns genuine raw `{title, url, snippet}` hits (verified: real 2025–2026 URLs, who.int / nobelprize.org primary sources), and `web_fetch` retrieves arbitrary pages. But it is **not keyless** — it needs the Copilot **seat** token (not the free `GITHUB_TOKEN`), consumes Copilot premium-request quota, and is agent-mediated (prompt-coerced JSON, not a documented schema). Negative control confirmed a bare GitHub Models call has **no** web access; `gh search` returns raw pointers but only into GitHub-hosted content, never the open web.
- **Changed:** Corrected an earlier prior that "GitHub-native = summaries only." The fact-check search backend is now a pluggable choice: Copilot `web_search` (removes the third-party *vendor* but not the *credential*, and costs seat quota) vs a dedicated API (Tavily / Brave / Exa) vs self-hosted SearXNG. Meta-lesson, reinforcing the spine: the *documented product* behavior and the *actual tool* behavior diverged — the product docs said Bing grounding withholds raw hits, but the CLI's separate tool surface proved more permissive on a real runner, and only the runner probe surfaced it. A green run beats a doc claim.

### 2026-07-08 — condukt is the spine (the biggest reframe yet)
- **Question:** We knew the autonomous pipeline needed a stateful, resumable, human-gated orchestration engine and assumed we'd fork LangGraph. Does `animeshkundu/condukt` fill that role?
- **Did:** Meta-agent cloned condukt to a temp dir and fanned out five explorers (purpose, architecture, how-to-run, LLM/GitHub integration, maturity); wrote `docs/research/condukt.md` with every load-bearing claim cited to `path:line`.
- **Learned:** condukt **is** the orchestration spine — a self-authored, TypeScript-native LangGraph-equivalent (v0.6.17, MIT, 659 tests). Every load-bearing pipeline requirement is already a first-class primitive: DAG scheduler with fan-out/fan-in + bounded loop-back, event-sourced JSONL state with resume/retry, `gate()` human approval, `verify()` retry-until-check loops with feedback injection, per-node model selection, and a React observability UI. It is domain-agnostic (forbids domain imports as Rule #1) and is a library (no CLI/server). The one real gap vs our stack: it ships **only** a Copilot backend (seat token + premium credits, delegates all auth to the pre-authenticated CLI) and has **no** GitHub Models path — the `AgentRuntime` interface is designed for exactly that extension. Honest maturity: pre-1.0, single-developer, the runtime layer is the least-tested subsystem, and a self-flagged pre-production `GraphRegistry` is documented-but-unbuilt.
- **Changed:** The architecture crystallized. The "assemble-it-yourself spine" the pipeline brief flagged is already built and in-house. The build shifts from "pick and wire an orchestrator" to two decisions: **condukt vs LangGraph** (TS in-house + UI vs Python ecosystem + GPT-Researcher skeleton), and — if condukt — writing a small **GitHub Models `AgentRuntime`** to get the keyless inference path. Content stages (research, fact-check, voice editor, cross-review, PR-publish) become nodes authored on top.

### 2026-07-08 — Bing "Fast Search API" — raw hits, reachable from a runner, gated only on Entra auth
- **Question:** Can the Bing search from the gist (an Entra-authed internal Azure Front Door endpoint) be a reliable **raw**-search backend — first locally, then on a GitHub runner?
- **Did:** Meta-agent probed it locally (Azure CLI token, direct API calls, 5 live queries) and on an isolated runner branch (`bing-search-probe`), reachability-first; wrote `docs/research/bing-search.md`.
- **Learned:** The wrapped API is a FastAPI "Fast Search API (Bing Grounding)"; `POST /api/v1/search` returns **raw** `{url, title, snippets}` docs (proven by its own OpenAPI schema + 5/5 live queries with real resolvable URLs). Locally it works via a non-interactive `az` token. The gist's literal `npx bing-mcp-server` does **not** run (internal package, 404 on public npm, corp ADO feed login expired) — but the direct API call bypasses that. Crucially, on a public `ubuntu-latest` runner the endpoint returned **HTTP 401** (a bare auth challenge, empty body) on every path — **not** a timeout or 403 WAF block — so it is **not** network/IP/private-link restricted; a public runner reaches it. The only blocker is Entra auth, which OIDC workload-identity federation solves with no long-lived secret (caveat: the SP must be admin-consented to the scope's app-role, and the federated-credential subject must match exactly).
- **Changed:** Added a third verified raw-search option for the fact-check stage (alongside Copilot `web_search` and external APIs). Reinforced two method principles: **test the cheapest thing that could kill it first** (reachability, no auth needed) — it passed; and **characterize a blocker precisely** (401 auth-gate, not a network wall) so the unblock path is clear (OIDC + app-role consent) rather than a vague "it didn't work."

> **Feasibility phase essentially complete.** With condukt (spine), inference (GitHub Models / Copilot), raw search (three verified options), fact-check design, blog stack (Astro + Zod), and publish (PR-merge) all now characterized, the "what's possible" phase is essentially done — the effort is moving toward decisions + build.

<!-- Append new entries above this line, newest at the bottom. Keep the question → did → learned → changed shape. -->

---

## Open questions / decisions ahead

Carried forward from the research (see [`../research/README.md`](../research/README.md) for the full framing):

- **Deploy host:** Cloudflare Pages (free per-PR previews, instant rollback, one secret) vs GitHub Pages (fully native, self-built previews).
- **Fact-check rigor vs cost:** full per-claim chain-of-verification + self-consistency vs a lighter citations-required + spot-check pass.
- **Autonomy & disclosure:** autonomous-to-PR with human merge vs a mid-pipeline human checkpoint; plus a per-platform AI-disclosure policy.
- **Search backend:** GitHub-native raw search vs a SaaS (Tavily / Brave / Exa) vs self-hosted SearXNG — and how the raw-vs-summarized distinction serves the truth stage.
- **Orchestrator:** does `condukt` (or another spine) earn its place as the "final piece," or does a plain LangGraph flow suffice?
- **Model escalation policy:** when is a run allowed to spend the Copilot seat token for Claude-class agentic models instead of staying keyless on GitHub Models?
- **Reachability of the Bing MCP:** is the Entra-authed internal endpoint reachable from a public GitHub-hosted runner at all, or does it force self-hosted runners?

---

## Pointers to the research

- **[`../research/README.md`](../research/README.md)** — the index and through-line; start here.
- **[`../research/copilot-inference-from-actions.md`](../research/copilot-inference-from-actions.md)** — the Copilot vs GitHub Models vs SDK distinction; auth; proxy ToS.
- **[`../research/github-models-on-runners.md`](../research/github-models-on-runners.md)** — empirical keyless Models on a runner; full catalog; the `max_completion_tokens` gotcha.
- **[`../research/copilot-sdk-on-runners.md`](../research/copilot-sdk-on-runners.md)** — empirical Copilot SDK on a runner; which token works; headless invocation; cost.
- **[`../research/blog-interface.md`](../research/blog-interface.md)** — SSG comparison, why Astro + Zod, hosting, quality mechanics.
- **[`../research/autonomous-blogging-pipeline.md`](../research/autonomous-blogging-pipeline.md)** — reuse-first pipeline design, the truth stage, the honest detectability read, build-vs-reuse verdict.
- **[`../research/condukt.md`](../research/condukt.md)** — the orchestrator candidate under evaluation.
- **Example workflows:** [`../../examples/workflows/`](../../examples/workflows/) — the verified probe workflows (`github-models-test.yml`, `copilot-sdk-test.yml`).
