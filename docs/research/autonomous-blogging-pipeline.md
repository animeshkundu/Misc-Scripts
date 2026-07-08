# Autonomous Blogging Agent — Reuse-First Pipeline Research Brief

**Date:** 2026-07-08
**Goal:** Assemble a fully autonomous, human-gated blogging agent —
`research deeply → cross-validate / fact-check → write like a human → self-review → cross-review → strip agent giveaways → publish` —
by **reusing** existing open-source pipelines/frameworks rather than building from scratch.

**Scope note:** This brief inventories reusable components, recommends an assembled stack, designs the
truth/fact-check stage, gives an honest read on "human-likeness / removing AI giveaways," maps the pipeline
onto a GitHub Actions runner, and gives a build-vs-reuse verdict. Star counts / licenses below were
**verified live against the GitHub API on 2026-07-08** where marked ✓; treat unmarked figures as approximate.

---

## Executive summary

- **No single open-source project covers the full pipeline.** Every real deliverable is an assembly of 2–4 components. The closest single artifact is **GPT-Researcher's `multi_agents/` LangGraph example** (Researcher → Editor → Reviewer → Revisor → Writer → Publisher) — the only mainstream project shipping genuine self-review **and** cross-review roles plus multi-format publish.
- **Recommended spine:** **GPT-Researcher** (Apache-2.0) for research+draft, orchestrated by **LangGraph** (MIT) for the stateful, resumable, human-gated draft→critique→revise→cross-review loop, with a **purpose-built citation-grounded fact-check stage** (no OSS repo ships this end-to-end — compose it), and **publish via a PR-merge flow on a Git-backed static site**.
- **Honest reality check on "removing AI giveaways":** surface tic-removal (em-dashes, "delve", "in conclusion") is cosmetic and largely irrelevant to strong detectors, which measure token-probability curvature and cross-model perplexity — properties of *how* text was generated, not word choice. Detector-evasion is an unstable arms race. The durable win is genuinely good, specific, sourced, opinionated, actually-revised writing. See §3.
- **CI-native:** the whole pipeline runs on a GitHub Actions runner using GitHub Models (`https://models.github.ai`, `GITHUB_TOKEN` + `models: read`) or the Copilot CLI, both already verified working on runners in this project. See §7.

---

## 1. Existing autonomous research→write→publish pipelines (open source)

| Project | Stars (✓ = live 2026-07-08) | License | Stages covered | Maturity | Reuse |
|---|---|---|---|---|---|
| **Stanford STORM** + Co-STORM ([stanford-oval/storm](https://github.com/stanford-oval/storm)) | 29,951 ✓ | MIT ✓ | research (multi-perspective Q&A), write (cited report), light polish; Co-STORM adds human-in-loop discourse (soft cross-review). No publish, no de-AI. | Active org project (EMNLP/NAACL papers); last push ~Sep 2025. Knowledge-curation grade, not CMS publishing. | **Component** — `knowledge-storm` PyPI pkg, swappable retrieval/LM modules |
| **GPT-Researcher** core ([assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)) | 28,150 ✓ | Apache-2.0 ✓ | research, write, publish (PDF/Docx/MD export). Citations; no dedicated fact-checker. | Very active (weekly commits, MCP server, Docker, docs). Production-ready, widely embedded. | **Component** — pip lib + REST/MCP server + CLI |
| ↳ **GPT-Researcher `multi_agents/`** (LangGraph) ([multi_agents README](https://github.com/assafelovic/gpt-researcher/blob/master/multi_agents/README.md)) | (same repo) | Apache-2.0 | research, write, **self-review + cross-review** (Reviewer + Revisor agents), publish. No de-AI. | Maintained example in an active repo. | **Reference architecture** — fork/adapt |
| **AutoGPT** ([Significant-Gravitas/AutoGPT](https://github.com/Significant-Gravitas/AutoGPT)) | 185,435 ✓ | Dual: MIT (classic) + PolyForm Shield (platform) | General autonomous agent; nothing blog-specific. | Extremely active but classic single-agent superseded by the Platform pivot. | **Monolith/app**, not a content component |
| **CrewAI** ([crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)) | 55,162 ✓ | MIT ✓ | Framework — you define research/write/review agents. | Very active, commercial backing. | **Library** (Crews + Flows) |
| ↳ **crewAI-examples** (blog/book crews) | ~6k | none (no LICENSE) | research+write, some editor roles; no de-AI/publish. | **ARCHIVED (read-only)** — unmaintained. | Demo/reference only |
| **LangChain `open_deep_research`** ([langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research)) | ~12k | MIT | scope→research→write; research reflection/gap-check. No fact-check/cross-review/publish. | Active, ranks on Deep Research Bench. | **Component** — LangGraph graph to import/extend |
| **local-deep-researcher** ([langchain-ai/local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher)) | ~9k | MIT | research (fully local, iterative reflection) + write. | Active, local-LLM focused. | **Component** — small embeddable LangGraph app |
| **Agno** ([agno-agi/agno](https://github.com/agno-agi/agno)) | 41,056 ✓ | Apache-2.0 ✓ (MPL-2.0 in older docs) | Framework (Agents/Teams/Workflows + memory/knowledge). No shipped blog pipeline. | Very active, large scope. | **Library** — most batteries-included SDK here |
| **n8n** ([n8n-io/n8n](https://github.com/n8n-io/n8n)) | 195,696 ✓ | Sustainable Use License (source-available, **not OSI**) | Hosts community templates chaining research→write→WordPress/Notion, some approval gates. No cross-review/de-AI. | Platform very active; templates vary wildly. | **App**; templates are low-code graphs |
| **Dify** ([langgenius/dify](https://github.com/langgenius/dify)) | 148,205 ✓ | Dify OSS License (Apache-derivative; bans reselling Dify as SaaS) | Templates for research→outline→draft→proofread/SEO; no first-party fact-check/cross-review/de-AI. | Very active. | **App**; workflow DSL, not a lib |
| **Flowise** ([FlowiseAI/Flowise](https://github.com/FlowiseAI/Flowise)) | 54,437 ✓ | Apache-2.0 core + Commercial `enterprise/` | Visual builder; no first-party blog pipeline. | Active. | **App**; nodes reusable only within Flowise |
| **Long-tail "AI blog-writer" clones** (`vipulawl/blogging-agent`, `JBahulika/AI-MultiAgent-blog-writer`, `KalyanM45/Multi-Agentic-Blog-Generation`, …) | 1–63 | often no LICENSE | mostly research+write; rare fact-checker/style-polisher. | **Demo/portfolio** — single contributor, no releases. | Copy-paste inspiration only |

**Key findings:**
- **Cross-review and de-AI are the two rarest stages.** Only GPT-Researcher's `multi_agents/` ships cross-review; **no** research→publish project ships a humanization stage.
- **Frameworks ≠ pipelines.** AutoGPT / CrewAI / Agno / LangGraph are build-your-own; n8n / Dify / Flowise are the same one layer up (unversioned community templates of variable quality).
- **Licensing caution:** n8n (Sustainable Use), Dify (SaaS restriction), AutoGPT platform (PolyForm Shield), Flowise `enterprise/` are **not OSI-approved**. Clean MIT/Apache libraries: STORM, GPT-Researcher, CrewAI, LangChain repos, Agno, LangGraph, DSPy, LlamaIndex.

---

## 2. Truth pillar — deep research + citation-grounded fact-checking

**Bottom line: no single OSS repo does rigorous, citation-grounded fact-checking end-to-end. Compose it.**

### 2a. Research / aggregation front-ends (reuse wholesale)
- **GPT-Researcher** (Apache-2.0, 28k ✓): planner → sub-questions → parallel crawlers pull **20+ sources/report** → each chunk retains `source_url` → `ContextCompressor` prunes by similarity → LLM cites inline `[1][2]` mapped back to metadata. Citation is **structurally traceable**, but its anti-hallucination is a "most-frequent-info-wins" majority heuristic, **not** formal per-claim verification. Ideal research front-end; needs a verifier bolted on.
- **STORM** (MIT, 30k ✓): discovers distinct **perspectives**, runs **simulated expert conversations** grounded in retrieved sources to force iterative, source-grounded question refinement. Best for the ideation/outline/breadth phase; not a verifier.

### 2b. Verification techniques (build from papers; reference repos are stale/unlicensed)

| Technique | What it does | OSS impl | License | Reuse |
|---|---|---|---|---|
| **FActScore** | Decompose long text into **atomic facts**, score precision vs. a knowledge source | [shmsw25/FActScore](https://github.com/shmsw25/FActScore) | **MIT** ✅ | Best fit for atomic-claim decomposition + stage eval metric |
| **CoVe** (Chain-of-Verification) | Draft → plan verification Qs → answer each **independently** → revise | [ritun16/chain-of-verification](https://github.com/ritun16/chain-of-verification) | ⚠️ **no LICENSE** | Prompt-only pattern; port from [paper](https://arxiv.org/abs/2309.11495). The "independent re-answering" is the key idea |
| **RARR** | Retrieve evidence per claim, then **revise** text to match evidence | [anthonywchen/RARR](https://github.com/anthonywchen/RARR) | ⚠️ **no LICENSE**, stale (2023) | Reimplement retrieve→revise loop from [paper](https://arxiv.org/abs/2210.08726) |
| **Self-RAG** | LM emits reflection tokens (`[Retrieve]`, `[Fully/Partial/No support]`, `[Utility]`) | [AkariAsai/self-rag](https://github.com/AkariAsai/self-rag) | **MIT** ✅ | Wholesale needs a fine-tuned model; **mimic the token scheme via prompting** on any LLM |
| Self-consistency | Sample N verdicts, majority-vote | prompting pattern | N/A | Cheap variance reducer — run the judge 3–5× on low-confidence claims |

> **Legal flag:** RARR and CoVe reference repos ship **no LICENSE** → treat as all-rights-reserved. The underlying papers are open knowledge; **reimplement, don't fork.**

### 2c. Search backends

| Backend | Cost | Self-host | License | Notes |
|---|---|---|---|---|
| **Tavily** | Free 1k/mo; ~$0.008/credit | ❌ SaaS | Proprietary | LLM/RAG-native, pre-summarized; GPT-Researcher default |
| **SearXNG** ([searxng/searxng](https://github.com/searxng/searxng), 33,612 ✓) | Free (infra only) | ✅ Docker | **AGPL-3.0** ✓ | Only genuinely free + self-host + open option; noisier/less structured |
| **Serper** | ~$1/1k | ❌ SaaS | Proprietary | Real Google SERPs, cheapest true-Google index |
| **Brave Search API** | ~$5/1k | ❌ SaaS | Proprietary | Independent index, SOC2 + ZDR, citation-ready "Answers" endpoint |
| **Exa (Metaphor)** | Free 20k/mo; ~$7/1k | ❌ SaaS (client MIT) | client MIT / svc proprietary | Neural/semantic "find pages like X"; dedicated agent product w/ citations |
| **DuckDuckGo (ddgs)** | Free (unofficial) | ✅ client lib | MIT | Fragile/ToS-risky — prototyping only |

*Takeaway:* **SearXNG** if self-host/copyleft matters; **Brave** or **Exa** for rigorous, citation-ready structured results; **Tavily** for fastest integration with GPT-Researcher.

### 2d. Forcing citations (every claim source-grounded)
- **Instructor + Pydantic** ([567-labs/instructor](https://github.com/567-labs/instructor), MIT): require a `source_url: HttpUrl` per claim; validation failure re-triggers generation. Turns "every claim has a source" from a prompting hope into a **schema-validated hard constraint** — the most directly reusable enforcement.
- **Verifier/critic agent** that **re-fetches each cited URL** and rejects any sentence the citation doesn't entail (NLI / LLM-judge). This is the actual rigor layer; no framework ships it — compose it.

### 2e. Recommended fact-check stage design

```
topic
  → [STORM perspective questions]              (optional breadth)
  → [GPT-Researcher: retrieve + draft w/ inline citations]   (retriever swappable: Tavily → Brave / SearXNG / Exa)
  → [FActScore-style atomic-claim decomposition]             (MIT)
  → per claim:
        re-retrieve evidence
        → CoVe-style INDEPENDENT verification  (judge does NOT see the draft)
        → Instructor/Pydantic verdict schema:
             { claim, verdict: supported|refuted|unverifiable, source_url: HttpUrl, supporting_quote }
        → (low-confidence) self-consistency ×3
        → (unsupported) RARR-style targeted rewrite → re-verify
  → report where EVERY surviving claim carries a schema-validated source_url
```
**Why:** GPT-Researcher gives production retrieval for free; FActScore/CoVe/RARR supply the decompose→verify→revise algorithm; **Instructor** makes "no claim without a source" a hard schema constraint. Self-RAG is worth mimicking (via prompting), not adopting (needs fine-tuning). Use a **different model** for the verifier than the writer to decorrelate errors.

---

## 3. Human-likeness and "removing AI giveaways" — the honest section

### 3a. What actually makes LLM prose detectable
**Empirically supported (peer-reviewed):**
- **Perplexity + curvature.** LLM output sits in negative-curvature regions of a model's own log-probability surface — the mechanism behind [DetectGPT (Mitchell et al., 2023)](https://arxiv.org/abs/2301.11305) (AUROC up to 0.95, zero-shot).
- **Cross-model perplexity contrast.** [Binoculars (Hans et al., ICML 2024)](https://arxiv.org/abs/2401.12070) contrasts perplexity from two related LMs — >90% of ChatGPT text caught at **0.01% FPR**, generalizing to unseen LLMs. [Code](https://github.com/ahans30/Binoculars).
- **Lexical fingerprinting is real, not folklore.** Words like "delve", "underscore", "meticulous", "intricate" surged up to **85-fold** in scientific abstracts post-ChatGPT ([COLING 2025](https://aclanthology.org/2025.coling-main.426/); [medRxiv corpus study](https://www.medrxiv.org/content/10.1101/2024.05.14.24307373v2)).
- **Burstiness** (sentence-length variance) — human writing has higher variance; vendor detectors (GPTZero) explicitly compute it.

**Folklore / weakly supported:** em-dash overuse, "in conclusion", "it's important to note", listicle formatting, over-hedging — widely observed anecdotally but **not individually validated** by peer-reviewed detection studies as reliable standalone tells.

*Priority of what strong detectors key on:* (1) token log-probability/perplexity + curvature, (2) cross-model perplexity contrast, (3) corpus-scale lexical drift, (4) burstiness (vendor-claimed).

### 3b. Techniques + the humanizer-repo landscape
**Legitimate techniques** (consistent with detection science): voice/style priming via few-shot or persona prompts (raises lexical/structural variance — the opposite of what perplexity detectors flag); explicit sentence-length / anti-formulaic-transition instruction; **DSPy** ([stanfordnlp/dspy](https://github.com/stanfordnlp/dspy), MIT, 35,951 ✓) to *optimize* a writing/critic prompt against a scoring function — a legitimate optimizer, **not** validated against AI detectors.

**Open-source "humanizer" repos — blunt assessment:**

| Repo | License | Mechanism | Verdict |
|---|---|---|---|
| [lynote-ai/humanize-text](https://github.com/lynote-ai/humanize-text) | MIT | Round-trip MT (EN→ZH→JA→FI→EN) + high-temp rewrite | Mechanistically plausible (back-translation genuinely disrupts token stats) but **self-graded** on cherry-picked examples; understates semantic-drift quality cost |
| [rudra496/StealthHumanizer](https://github.com/rudra496/StealthHumanizer) | MIT | Browser rewriter, "12-metric detection engine", "anti-detection prompts" | **Openly markets GPTZero/Turnitin bypass**; scores users against its **own house detector**. Closer to snake oil than proven efficacy |
| [blader/humanizer](https://github.com/blader/humanizer) | MIT | Style/prompt pass | Higher-traction, but still a bolt-on prompt layer, not a maintained API with third-party efficacy data |

**No independent peer-reviewed benchmark of any of these repos exists.** Every "bypass rate" is self-reported against the tool's own or an unnamed detector.

### 3c. The detector landscape — real numbers
| Detector | FPR (claimed vs measured) | Source |
|---|---|---|
| **Turnitin** | doc-level <1% (own); Pangram measured 0.51%; sentence-level ~4% (Turnitin's own) | [Turnitin](https://www.turnitin.com/blog/understanding-the-false-positive-rate-for-sentences-of-our-ai-writing-detection-capability) / [Pangram](https://www.pangram.com/blog/all-about-false-positives-in-ai-detectors) |
| **GPTZero** | claims ~1%; measured **2.01%**; perplexity + burstiness | [Pangram](https://www.pangram.com/blog/how-does-pangram-compare-against-gptzero) |
| **Originality.ai** | claims ~0.5%; third-party **1.5%–12%** by type; flags AI-*assisted* editing | third-party reviews |
| **Pangram** | self-reports ~0.01%; transparent but vendor-published | [Pangram](https://www.pangram.com/blog/all-about-false-positives-in-ai-detectors) |
| **RAID benchmark** (independent) | most commercial detectors' recall **collapses to near-zero** at a forced 1% FPR | [RAID (Dugan et al.)](https://arxiv.org/abs/2405.07940) |
| **Binoculars** (OSS) | >90% recall @ 0.01% FPR, zero-shot; needs two local LLMs | [repo](https://github.com/ahans30/Binoculars) |

**Two load-bearing facts:**
1. **OpenAI discontinued its own text classifier (2023-07-20)** — it caught only **26%** of AI text while flagging **9%** of human text; the company building the models concluded reliable text detection wasn't achievable and pivoted to watermarking/provenance ([announcement](https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/)).
2. **Detectors are biased against non-native English writers** — real TOEFL essays misclassified as AI up to **61%** because simpler vocabulary produces low perplexity, exactly the AI signal ([Liang et al. 2023, *Patterns*](https://arxiv.org/abs/2304.02819)). The same paper shows trivial prompting both fixes the bias and bypasses detectors — proving the signal's fragility.

### 3d. Ethics / ToS gray areas (do not ignore)
- **Google** doesn't ban AI content but prohibits [**scaled content abuse**](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content) (mass low-value pages, AI or human); ranking is quality/**E-E-A-T**-based, and disclosure for reader context is recommended.
- **FTC** [Endorsement Guides](https://www.ftc.gov/business-guidance/blog/2023/06/real-deal-ftcs-updated-endorsement-guides): undisclosed AI-generated reviews/testimonials material to consumers can be deceptive.
- Platform/journalistic norms increasingly expect AI-assistance disclosure for editorial content.

### 3e. Honest one-paragraph reality check
Stripping em-dashes, swapping "delve" for a synonym, and jittering sentence lengths is cheap, cosmetic, and — per the actual detection science — largely irrelevant to what strong detectors (Binoculars, Pangram, DetectGPT-style) measure: token-probability curvature and cross-model perplexity contrast, which are properties of *how* text was generated, not surface word choice. No tic-removal pass reliably defeats a well-built detector; every humanizer claiming otherwise is either grading itself against its own detector or riding a temporary gap that closes on the next retrain. Evasion is an unstable arms race, and aggressive rewriting (round-trip translation, high-temp paraphrase) measurably degrades quality and voice. The durable, defensible path is not evasion — it is writing that is **substantively specific** (real numbers, named sources, concrete examples a generic model wouldn't produce), **genuinely sourced**, **opinionated** (a stance you'd defend), and **structurally varied because you actually revised it**. That writing is harder to produce and also harder for both detectors and human readers to dismiss as filler.

**Design implication:** frame the "de-AI" stage as a **voice-and-specificity editor**, not a detector-evasion tool: enforce a persona/style guide, inject concrete specifics from the fact-check stage, vary sentence length, remove the folklore tics as a cheap bonus — and **disclose AI assistance** per platform norms rather than chase undetectability. Optionally run **Binoculars** as an *internal* quality signal (is this draft generic?), not as an evasion target.

---

## 4. Orchestration framework comparison

Requirements for our pipeline: **stateful + resumable**, **human-in-the-loop approval gate**, **cyclic draft↔critique↔revise loops**, easy critic/fact-checker/style-reviewer roles, production observability.

| Framework | Stars ✓ | License ✓ | Stateful+resumable | Human gate | Cyclic loops | Critic roles | Observability | Learning curve |
|---|---|---|---|---|---|---|---|---|
| **LangGraph** ([langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)) | 36,807 | MIT | **High** — durable checkpointers (SQLite/Postgres), resume from any node | **High** — `interrupt()` + `Command(resume=...)`, approve-before-act | **High** — cycles are the core value prop | High — explicit node per role | **High** — LangSmith + LangGraph Platform | Steep (graph/state model) |
| **CrewAI** ([crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)) | 55,162 | MIT | Medium — Flows persist state; weaker resumability | Medium — `human_input=True`, blocking | Medium — Flows `@router`/loops; Crews linear | **High** — role/goal/backstory agents | Medium–High — AgentOps | **Gentle** |
| **AutoGen v0.4** ([microsoft/autogen](https://github.com/microsoft/autogen)) | 59,586 | CC-BY-4.0 (docs) + MIT (code) | Medium — `save/load_state`; not full graph resume | Medium — `UserProxyAgent` | **High** — conversation loops native | High — multi-agent debate is home turf | Medium — OTel, churny history | Steep (layered API) |
| **AG2** ([ag2ai/ag2](https://github.com/ag2ai/ag2)) | 4,749 | Apache-2.0 | Low–Med — conversation state, no durable checkpoint | Medium — `UserProxyAgent` | High — conversational looping | High | Low–Med — smaller ecosystem | Moderate |
| **Agno** ([agno-agi/agno](https://github.com/agno-agi/agno)) | 41,056 | Apache-2.0 | Medium — session state + DB; session-centric | Medium — tool-confirmation HITL | Medium | Medium–High — clean agent/team API | Medium–High — AgentOS | Gentle–Moderate |
| **LlamaIndex Workflows** ([run-llama/llama_index](https://github.com/run-llama/llama_index)) | 50,733 | MIT | **High** — `WorkflowCheckpointer` + `Context` serialization | **High** — `InputRequiredEvent`/`HumanResponseEvent` | **High** — event loops | High — steps as roles | Medium–High — OTel/Arize | Moderate |
| **DSPy** ([stanfordnlp/dspy](https://github.com/stanfordnlp/dspy)) | 35,951 | MIT | **Low** — no durable state/resume | Low — none native | Low — bounded retries only | Medium — optimizes prompts, not orchestration | N/A (pairs with MLflow) | Moderate |

*(All stars/licenses live-verified 2026-07-08. AutoGen license reports `CC-BY-4.0` at the repo root — docs are CC-BY, code is MIT.)*

**Standard patterns to implement:** separate **generator from critic** (don't let a critic grade its own work); **reflection loop** (draft→critique→revise, capped by max-iterations AND a quality threshold — [Reflexion](https://arxiv.org/abs/2303.11366)); **adversarial fact-checker** with a **different model** ([CoVe](https://arxiv.org/abs/2309.11495), [Constitutional AI](https://arxiv.org/abs/2212.08073)); **cross-review / multi-critic debate** ([Du et al.](https://arxiv.org/abs/2305.14325)); **LLM-as-judge quality gate** ([Zheng et al.](https://arxiv.org/abs/2306.05685)) that must pass before the publish edge.

### Recommendation
**Winner: LangGraph.** It is the only framework where all four load-bearing requirements are simultaneously first-class rather than bolt-on: durable checkpoint+resume (Postgres/SQLite), a purpose-built human approval gate (`interrupt()` composed with the checkpointer so the pause is *durable*, not in-memory), cyclic reflection/cross-review loops (its core reason to exist), and real production observability (LangSmith + Platform). Cost: a steeper graph/state learning curve — which, for a long-running human-gated pipeline, is rigor, not tax. It also composes naturally with GPT-Researcher, whose `multi_agents/` example is already a LangGraph graph.

**Runner-up: LlamaIndex Workflows** — closest structural match (`WorkflowCheckpointer` + `InputRequiredEvent`), gentler curve, trails on durable-execution/observability maturity for multi-day human-in-the-loop runs.

**Use DSPy inside the orchestrator**, not as it — to optimize the critic/judge/writer prompts. **CrewAI** if developer speed dominates and resumability needs are light; **AutoGen/AG2** for emergent debate over a rigid state machine; **Agno** for raw performance + batteries-included runtime.

---

## 5. Publishing / posting automation

| Target | How to post | Auth | Draft state? | OSS clients |
|---|---|---|---|---|
| **Static site via Git (Astro/Hugo/Eleventy/Next.js)** | Agent commits MD+frontmatter to a branch, opens a PR ([peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request)); CI (Netlify/Vercel/Cloudflare Pages/Actions) deploys on merge | Git PAT / GitHub App; CI holds deploy creds | **Yes — best possible** (nothing live until a human merges; the diff *is* the review) | `create-pull-request`, `actions/checkout`, `actions/github-script` |
| **Ghost** ([ghost.org/docs/admin-api](https://ghost.org/docs/admin-api/)) | `POST /ghost/api/admin/posts/` with `status:"draft"` | Admin key → short-lived HS256 JWT (`exp` ≤ 5 min) | Yes (`draft\|published\|scheduled`) | [`@tryghost/admin-api`](https://www.npmjs.com/package/@tryghost/admin-api) |
| **WordPress REST** ([docs](https://developer.wordpress.org/rest-api/reference/posts/)) | `POST /wp/v2/posts` with `status` | **Application Passwords** (core ≥5.6, HTTP Basic over HTTPS) | Yes (`publish\|future\|draft\|pending\|private`) | Application Passwords + any HTTP lib |
| **Dev.to / Forem** ([docs](https://developers.forem.com/api/v1)) | `POST /api/articles`, `article.published:false` | `api-key` header | Yes (`published:false` = draft) | REST direct |
| **Hashnode** ([schema](https://github.com/Hashnode/gql-skill)) | GraphQL `createDraft`→`publishDraft`; also `submitDraftForReview`/`rejectDraftSubmission` | `Authorization: Bearer <PAT>` | Yes | GraphQL client |
| **Medium** | historically `POST /v1/users/{id}/posts` | OAuth2 | — | **DEPRECATED — do not build on this** ([archived docs](https://github.com/Medium/medium-api-docs)) |

**Review-gating patterns:**
- **(a) PR-based flow (static site) — RECOMMENDED.** Agent commits MD → opens PR → human reviews the **diff** → merges → CI deploys. The review artifact *is* the content diff; merge = publish (one auditable, reversible action via `git revert`); absorbs orchestrator rigor **for free** via GitHub [required-reviewer branch/environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments); minimal token/rate-limit surface.
- **(b) CMS draft-then-publish** — only if committed to Ghost/WordPress for editorial reasons and reviewers won't touch Git (WYSIWYG approval), at the cost of Git's diff/rollback guarantees.
- **(c) Orchestrator approval step** — only to gate several destinations at once (e.g., Ghost + Dev.to cross-post) behind one approval with timeout/escalation. n8n `Wait` (resume-on-webhook), or GH environment protection, or Temporal signal.

**Caveats:** Medium API deprecated (archived 2023-03). **Hashnode is now paid-only** — every mutation requires the publication on an active Pro plan ([2026-05-13 changelog](https://hashnode.com/changelog/2026-05-13-graphql-api-paid-access)). GitHub Actions `schedule:` is unreliable for time-critical publishes (min 5 min, can be delayed/dropped, auto-disables after 60 days of no repo activity, default-branch only) — use a CMS scheduler or dedicated cron host if punctuality matters.

---

## 6. Recommended assembled architecture

```
                          AUTONOMOUS BLOGGING AGENT  (orchestrated by LangGraph, MIT)
                          durable checkpointer (SQLite/Postgres) + interrupt() human gate

 ┌────────────┐   ┌──────────────────────┐   ┌─────────────────────────┐   ┌──────────────────┐
 │  1. TOPIC  │──▶│  2. DEEP RESEARCH     │──▶│  3. TRUTH / FACT-CHECK   │──▶│  4. WRITE (human │
 │  (prompt / │   │  GPT-Researcher       │   │  (composed, §2e)         │   │     voice)       │
 │   queue)   │   │  + STORM perspectives │   │  FActScore decompose →   │   │  GPT-Researcher  │
 └────────────┘   │  retriever: Tavily /  │   │  per-claim re-retrieve → │   │  writer, primed  │
                  │  Brave / SearXNG/Exa  │   │  CoVe independent verify │   │  w/ persona +    │
                  │  → cited draft, every │   │  → Instructor schema     │   │  style guide +   │
                  │  chunk keeps source_url│  │  (source_url per claim)  │   │  fact-checked     │
                  └──────────────────────┘   │  → RARR targeted rewrite │   │  specifics       │
                                             │  unsourced claims REJECTED│  └────────┬─────────┘
                                             └─────────────────────────┘           │
                                                                                    ▼
 ┌──────────────────────────┐   ┌──────────────────────────┐   ┌───────────────────────────┐
 │  7. PUBLISH (gated)      │◀──│  6. CROSS-REVIEW +       │◀──│  5. SELF-REVIEW +         │
 │  Git PR → static site    │   │     QUALITY GATE          │   │     "VOICE / SPECIFICITY  │
 │  (Astro/Hugo) →          │   │  2nd-agent critic         │   │      EDITOR"  (§3e)       │
 │  human merges PR →        │   │  (DIFFERENT model):       │   │  reflection loop:         │
 │  CI (Netlify/Vercel/      │   │  adversarial fact-checker │   │  draft→critique→revise    │
 │  Cloudflare) deploys.     │   │  + style reviewer +       │   │  cap: max-iter AND        │
 │  Required-reviewer branch │   │  LLM-as-judge gate.       │   │  quality threshold.       │
 │  protection = the human   │   │  MUST pass before the     │   │  Enforce persona, inject  │
 │  gate.                    │   │  publish edge is taken.   │   │  concrete specifics, vary │
 └──────────────────────────┘   └──────────────────────────┘   │  sentence length. Binoculars│
                                                                 │  as internal quality signal │
                                                                 │  (not evasion target).      │
                                                                 └───────────────────────────┘

  Tool per stage:  1 queue/prompt · 2 GPT-Researcher(+STORM)+Tavily/Brave/SearXNG · 3 FActScore+CoVe+Instructor(composed)
                   4 GPT-Researcher writer + persona/style guide (DSPy-optimized prompt) · 5 LangGraph reflection loop
                   6 LangGraph cross-review, DIFFERENT model, LLM-as-judge gate · 7 create-pull-request → SSG → CI deploy
```

**Fork target:** GPT-Researcher's `multi_agents/` LangGraph graph (Researcher → Editor → Reviewer → Revisor → Writer → Publisher) is the closest existing skeleton — adopt it as the reference architecture and extend it with the fact-check stage (§2e), the voice/specificity editor (§3e), and the PR-based publisher.

---

## 7. GitHub-native option — running the pipeline in CI

Both paths are **already verified working on runners in this project** (see `docs/research/copilot-inference-from-actions.md`, and the empirical `docs/research/github-models-on-runners.md` / `docs/research/copilot-sdk-on-runners.md`).

- **GitHub Models:** `https://models.github.ai`, OpenAI-compatible, auth with the workflow `GITHUB_TOKEN` + `permissions: { models: read }`. Models include gpt-5 / o3 class. Zero extra secret to manage; billed against the repo/org. Ideal for the writer, critic, fact-check verifier, and LLM-as-judge calls — use **different model IDs** for writer vs verifier to decorrelate.
- **Copilot CLI:** seat token, drives the same catalog from the runner shell.

**CI mapping:**
```
on: workflow_dispatch | issues (topic in an issue) | schedule (see caveat §5)
permissions: { contents: write, pull-requests: write, models: read }
job:
  1. checkout
  2. run the LangGraph pipeline (stages 2–6), model calls → https://models.github.ai with GITHUB_TOKEN
     - fact-check verifier + cross-reviewer use a DIFFERENT model id than the writer
     - checkpoint state to the runner FS or an artifact so a resumed run continues
  3. write the finished MD + frontmatter into the site's content dir
  4. peter-evans/create-pull-request → opens a PR
  5. HUMAN GATE: PR review + required-reviewer branch protection; merge triggers the deploy workflow
  6. deploy job (on merge to main): SSG build → Netlify/Vercel/Cloudflare Pages
```
The **human approval gate is the PR merge** — no separate approval infra. For a fully-in-CI pause, GitHub **environment protection rules with required reviewers** give a native "wait for human" gate on the deploy job. Store the fact-check verdict JSON and cross-review notes as PR comments / workflow artifacts so the reviewer sees the evidence, not just the prose.

---

## 8. Build vs reuse verdict

**Adopt wholesale (reuse):**
- **GPT-Researcher** (Apache-2.0) — research + draft + citation-traceable sourcing + writer. The spine.
- **LangGraph** (MIT) — orchestrator: durable checkpoint/resume, `interrupt()` human gate, cyclic loops.
- **Instructor** (MIT) — schema-enforced "no claim without a source_url".
- **create-pull-request** action + a Git-backed SSG (Astro/Hugo) — the publish + human-gate layer.
- **STORM** `knowledge-storm` (MIT) — optional breadth/perspective phase.
- **GitHub Models** — CI inference with zero secret management.

**Fork / adapt (reference architecture, not a package):**
- **GPT-Researcher `multi_agents/`** LangGraph graph — the Researcher/Reviewer/Revisor/Publisher skeleton to extend.
- **DSPy** (MIT) — optional, to optimize the writer/critic/judge prompts.

**Write ourselves (no reusable OSS ships it):**
- **The citation-grounded fact-check stage** (§2e) — FActScore-style decomposition + CoVe-style independent per-claim verification + Instructor schema + RARR-style targeted rewrite. Reimplement CoVe/RARR from their papers (reference repos are unlicensed/stale); FActScore/Self-RAG are MIT and reusable.
- **The voice / specificity editor** (§3e) — persona + style guide, concrete-specifics injection, sentence-length variation, tic removal as a bonus. Framed as a quality editor, **not** a detector-evasion tool.
- **The cross-review quality gate wiring** — a second-agent critic on a **different model** + LLM-as-judge that blocks the publish edge. Only GPT-Researcher's example ships anything close; harden it.

---

## 9. Open risks and residual decisions

**Risks:**
- **Detectability is an arms race** — do not sell "undetectable." Frame the de-AI stage as quality, disclose AI assistance, and stay clear of Google's scaled-content-abuse and FTC endorsement lines.
- **Fact-check is the hardest custom piece** — a weak verifier is worse than none (false confidence). It must use a different model and hard-reject unsourced claims; budget the most engineering here.
- **Unlicensed reference repos** (CoVe, RARR, crewAI-examples archived, long-tail clones) — reimplement from papers; do not vendor unlicensed code.
- **Cost/latency** — per-claim re-retrieval + self-consistency + cross-review multiplies calls. GitHub Models mitigates cost in CI but watch rate limits; make the fact-check depth configurable.
- **Non-native-writer detector bias** and vendor FPR inflation mean any detector score is advisory only, never a gate.

**Residual decisions for the user:**
1. **Publish surface:** Git-backed static site (Astro/Hugo, recommended — cleanest human gate) vs an existing CMS (Ghost/WordPress draft flow). This choice drives stage 7 and the review UX.
2. **Fact-check rigor vs cost:** full per-claim CoVe + self-consistency + re-retrieval (rigorous, expensive) vs a lighter "citations-required + spot-check" pass. Pick the depth and where the quality gate hard-fails.
3. **Search backend:** Tavily (fastest integration, SaaS) vs Brave/Exa (rigorous, citation-ready, SaaS) vs SearXNG (free, self-host, AGPL, noisier). Cost/self-host/quality trade-off.
4. **Autonomy level & disclosure:** fully autonomous-to-PR with a human merge (recommended) vs a human checkpoint mid-pipeline; and the AI-disclosure policy per target platform.
5. **Runtime home:** GitHub Actions runner (GitHub Models, zero-secret, recommended for CI) vs a long-lived server (better for multi-day durable human-in-the-loop runs where Actions' `schedule` unreliability bites).

---

## Sources

Pipelines: [STORM](https://github.com/stanford-oval/storm) · [GPT-Researcher](https://github.com/assafelovic/gpt-researcher) · [multi_agents](https://github.com/assafelovic/gpt-researcher/blob/master/multi_agents/README.md) · [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) · [CrewAI](https://github.com/crewAIInc/crewAI) · [open_deep_research](https://github.com/langchain-ai/open_deep_research) · [local-deep-researcher](https://github.com/langchain-ai/local-deep-researcher) · [Agno](https://github.com/agno-agi/agno) · [n8n](https://github.com/n8n-io/n8n) · [Dify](https://github.com/langgenius/dify) · [Flowise](https://github.com/FlowiseAI/Flowise)

Fact-check: [FActScore](https://github.com/shmsw25/FActScore) · [self-rag](https://github.com/AkariAsai/self-rag) · [CoVe repo](https://github.com/ritun16/chain-of-verification) / [paper](https://arxiv.org/abs/2309.11495) · [RARR repo](https://github.com/anthonywchen/RARR) / [paper](https://arxiv.org/abs/2210.08726) · [Self-RAG paper](https://arxiv.org/abs/2310.11511) · [FActScore paper](https://arxiv.org/abs/2305.14251) · [STORM paper](https://arxiv.org/abs/2402.14207) · [Co-STORM paper](https://arxiv.org/abs/2408.15232) · [instructor](https://github.com/567-labs/instructor) · [searxng](https://github.com/searxng/searxng) · [Tavily](https://tavily.com/pricing) · [Brave API](https://brave.com/search/api/) · [Exa](https://exa.ai/pricing) · [Serper](https://serper.dev)

Human-likeness/detection: [DetectGPT](https://arxiv.org/abs/2301.11305) · [Binoculars paper](https://arxiv.org/abs/2401.12070) / [code](https://github.com/ahans30/Binoculars) · [GLTR](https://arxiv.org/abs/1906.04043) · [COLING 2025 lexical](https://aclanthology.org/2025.coling-main.426/) · [medRxiv corpus](https://www.medrxiv.org/content/10.1101/2024.05.14.24307373v2) · [RAID](https://arxiv.org/abs/2405.07940) · [Liang et al. bias](https://arxiv.org/abs/2304.02819) · [OpenAI classifier discontinued](https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/) · [Turnitin FPR](https://www.turnitin.com/blog/understanding-the-false-positive-rate-for-sentences-of-our-ai-writing-detection-capability) · [Pangram FPR](https://www.pangram.com/blog/all-about-false-positives-in-ai-detectors) · [Google scaled-content](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content) · [Google gen-AI guidance](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) · [FTC endorsements](https://www.ftc.gov/business-guidance/blog/2023/06/real-deal-ftcs-updated-endorsement-guides) · [DSPy](https://github.com/stanfordnlp/dspy)

Orchestration: [LangGraph](https://github.com/langchain-ai/langgraph) · [AutoGen](https://github.com/microsoft/autogen) · [AG2](https://github.com/ag2ai/ag2) · [LlamaIndex](https://github.com/run-llama/llama_index) · [Reflexion](https://arxiv.org/abs/2303.11366) · [CoVe](https://arxiv.org/abs/2309.11495) · [Constitutional AI](https://arxiv.org/abs/2212.08073) · [Multi-Agent Debate](https://arxiv.org/abs/2305.14325) · [LLM-as-Judge](https://arxiv.org/abs/2306.05685)

Publishing: [create-pull-request](https://github.com/peter-evans/create-pull-request) · [Ghost Admin API](https://ghost.org/docs/admin-api/) · [WordPress REST](https://developer.wordpress.org/rest-api/reference/posts/) · [Dev.to/Forem API](https://developers.forem.com/api/v1) · [Hashnode paid-access](https://hashnode.com/changelog/2026-05-13-graphql-api-paid-access) · [Medium archived](https://github.com/Medium/medium-api-docs) · [GH environments/required reviewers](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

*Star counts / licenses marked ✓ verified live via the GitHub API on 2026-07-08; others approximate and drift over time. The load-bearing facts are the maturity/license/stage findings and the detection science, not exact stars.*
