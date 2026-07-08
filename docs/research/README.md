# Research index

Research and empirical findings behind an autonomous, human-gated blogging pipeline that runs on GitHub infrastructure. All dates 2026-07-08.

Reading order follows the argument: **can we run inference on a runner? → what stack should the blog be? → what pipeline turns that into human-like posts?**

| # | Doc | What it answers | Confidence |
|---|---|---|---|
| 1 | [`copilot-inference-from-actions.md`](./copilot-inference-from-actions.md) | Can you call Copilot APIs / inference from GitHub runners? The Copilot-vs-GitHub-Models distinction, SDK auth, proxy ToS. | Web/doc research (has an empirical-update banner) |
| 2 | [`github-models-on-runners.md`](./github-models-on-runners.md) | **Empirical:** GitHub Models from a runner with `GITHUB_TOKEN` + `models: read`, no secrets. Full 37-id catalog, per-model results, the `max_completion_tokens` gotcha. | Verified on live runs |
| 3 | [`copilot-sdk-on-runners.md`](./copilot-sdk-on-runners.md) | **Empirical:** the Copilot CLI/SDK on a runner. Which token works (`ghs_` fails, seat user token succeeds), the `--allow-all-tools` headless invocation, cost. | Verified on a live run |
| 4 | [`blog-interface.md`](./blog-interface.md) | Best static-blog stack + agent write-interface + publishing pipeline. SSG comparison, why Astro+Zod, hosting, quality mechanics. | Primary-source research |
| 5 | [`autonomous-blogging-pipeline.md`](./autonomous-blogging-pipeline.md) | Reuse-first design for the full research→fact-check→write→review→publish agent. Existing OSS projects, the truth stage, honest detectability read, build-vs-reuse verdict. | Research; stars/licenses live-verified |
| 6 | [`github-web-search.md`](./github-web-search.md) | **Empirical:** can a GitHub-native surface do raw open-web search (URL+snippet pointers, not summaries) for the fact-check stage? Copilot CLI `web_search` yes; GitHub Models no web; `gh search` GitHub-only. | Verified on a live run |
| 7 | [`condukt.md`](./condukt.md) | **The orchestration spine.** Deep-dive of `animeshkundu/condukt` — a TS-native agent-workflow framework (DAG + fan-out/loop-back, event-sourced resumable state, human gates, verify loops, pluggable runtime, React UI). Maps onto the pipeline; ships Copilot backend, **no GitHub Models path**. | Verified against cloned source (`path:line`) |
| 8 | [`bing-search.md`](./bing-search.md) | **Empirical:** the gist's Bing "Fast Search API" (Entra-authed internal Azure endpoint) as a raw-search backend. Returns raw `{url,title,snippets}`; reachable from a public runner (401, not blocked); needs Entra OIDC auth. | Verified locally + on a live run |

## The through-line

1. **Inference on a runner is solved two ways** (docs 2–3): **GitHub Models** — keyless, `gpt-5`/`o3` class, OpenAI-compatible, the default engine; **Copilot SDK/CLI** — needs a Copilot-seat user token as a secret, gives the agentic runtime and Claude models. Note: GitHub Models has **no Claude/Gemini** and **no `gpt-5.5`** on this account; best id is `openai/gpt-5`.
2. **The blog should be Astro + MDX + Zod-validated content collections** (doc 4), authored as Markdown committed via git — the Zod frontmatter gate is the one build-time guardrail that catches the agent's main failure mode.
3. **The pipeline is a reuse-first assembly** (doc 5): a stateful/resumable/human-gated **spine** + a purpose-built citation-grounded fact-check stage, a voice/specificity editor (framed as quality, **not** detector evasion), a cross-review gate on a *different* model, and publish via PR-merge — the merge is the zero-infra human gate. It runs in one GitHub Actions workflow.
4. **The spine already exists in-house: `condukt`** (doc 7). It's a TS-native LangGraph-equivalent — DAG scheduler, event-sourced resumable state, `gate()` human approval, `verify()` loops, per-node model selection, React UI — i.e. exactly the "assemble-it-yourself" orchestration part. The content stages become nodes authored on top. Its one gap: it ships only a **Copilot** runtime, so getting the keyless **GitHub Models** path (docs 1–2) means writing a small `AgentRuntime`.
5. **Raw source-finding for fact-check has three verified options** (docs 6, 8): Copilot CLI `web_search` (raw hits, needs seat token), the internal Bing "Fast Search API" (raw docs, reachable from a runner, needs Entra OIDC), or an external API/SearXNG. GitHub Models alone has **no** web access.

## Companion example workflows

Verified probe workflows live in [`../../examples/workflows/`](../../examples/workflows/): `github-models-test.yml` (keyless Models probe) and `copilot-sdk-test.yml` (Copilot SDK probe). Both were run in `animeshkundu/Misc-Scripts`.

## Key residual decisions (carried from docs 4–8)

- **Orchestration spine: `condukt` vs LangGraph.** condukt is in-house, TypeScript, UI-rich, Copilot-agentic (doc 7); LangGraph is Python-native with GPT-Researcher's existing `multi_agents/` skeleton + mature checkpointers. A condukt spine calls Python research tools out-of-process.
- **Inference runtime: write a GitHub Models `AgentRuntime` (keyless) or run condukt on Copilot (seat + credits).** The interface is built for a new backend; this is the single biggest wiring task if condukt is chosen.
- **Deploy host:** Cloudflare Pages (free per-PR previews + instant rollback, one secret) vs GitHub Pages (fully native, self-built previews).
- **Fact-check rigor vs cost:** full per-claim CoVe + self-consistency vs a lighter citations-required + spot-check pass.
- **Autonomy & disclosure:** autonomous-to-PR with human merge vs a mid-pipeline human checkpoint; plus per-platform AI-disclosure policy.
- **Search backend for fact-check:** Copilot CLI `web_search` (GitHub-native **raw** URL pointers, verified on a runner — needs the Copilot **seat** token, burns quota) vs the internal Bing "Fast Search API" (raw docs, reachable from a public runner, needs **Entra OIDC** auth — doc 8) vs a dedicated API (Tavily/Brave/Exa) vs self-host SearXNG. GitHub Models has **no** web access; `gh search` is GitHub-only. See [`github-web-search.md`](./github-web-search.md) and [`bing-search.md`](./bing-search.md).
