# Research: Using GitHub Copilot APIs / inferencing from GitHub runners

- **Date:** 2026-07-08
- **Repo path:** C:\Users\anikundu\Software\blog (not a git repo; no HEAD/diff)
- **Termination:** saturated (2 rounds, primary sources reached)
- **Downstream consumer:** user (decision facts)

> **Empirical update (2026-07-08):** This brief was written from web/doc sources
> *before* the live runner probes. Where it differs from the empirically-verified
> companion docs, **the empirical docs win**: see
> [`github-models-on-runners.md`](./github-models-on-runners.md) and
> [`copilot-sdk-on-runners.md`](./copilot-sdk-on-runners.md). Corrections proven on
> the `animeshkundu` account: the GitHub Models catalog has **no Grok, no Claude,
> no Gemini** (37 ids: OpenAI/Meta/Phi/Mistral/DeepSeek/Cohere only), **`gpt-5.5`
> is absent** (best OpenAI id is `gpt-5`), and the web-sourced per-tier rate limits
> below were **not** hit — `gpt-5`/`o3` returned 200 with no `429` at probe volume.

## Ask

Is it possible to use GitHub Copilot APIs / inferencing from GitHub Actions runners?

## Key disambiguation

The question conflates two very different products. The answer depends entirely on which one you mean:

1. **GitHub Models** — GitHub's *official, sanctioned* AI inference product (OpenAI-compatible). **Yes**, callable from Actions runners.
2. **GitHub Copilot's internal inference backend** (`api.githubcopilot.com`, `copilot_internal/v2/token`) — the private endpoint the IDE plugins use. **Not** a public API. Reverse-engineered proxies exist but violate ToS.
3. **Copilot SDK** (Feb 2026 preview) — programmatic agent runtime, but wraps a *local* Copilot CLI over JSON-RPC; not designed for headless CI.

## Root-cause / decision facts (confidence tagged)

- **[verified-source] GitHub Models works from Actions runners out of the box.** Grant `permissions: { models: read }`, then call `https://models.github.ai/inference/chat/completions` with `Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}`. No extra secret needed. Official wrapper: `actions/ai-inference@v1`.
- **[verified-source] GitHub Models is OpenAI-compatible** (Azure AI Inference SDK; `model: "openai/gpt-4.1"`, plus o1/o3/gpt-5, DeepSeek-R1, Llama-4, Phi-4, Mistral, Cohere, embeddings). *(Empirically confirmed catalog — earlier "Grok-3" mention was web speculation and is NOT in the catalog; see `github-models-on-runners.md`.)*
- **[verified-source] Rate limits are tied to your Copilot plan tier** (Free/Pro/Business/Enterprise) with per-minute/day request + token caps and low concurrency (e.g. Low tier: 15 req/min, 150/day, 5 concurrent). Premium models (gpt-5, o3, DeepSeek-R1) are 1–3 req/min, single-digit/day, 1 concurrent, and unavailable on Copilot Free. Paid/BYOK usage unlocks "production grade" limits (Azure Foundry quotas).
- **[verified-source] The Copilot code-completion / chat backend (`api.githubcopilot.com`) is NOT a public inference API.** It is private to the approved IDE clients (VS Code, JetBrains, Neovim). The official Copilot REST API only covers admin/usage-metrics, not completions.
- **[verified-source] Reverse-engineered Copilot proxies** (`ericc-ch/copilot-api`, `messense/copilot-api-proxy`, npm variants) expose Copilot as an OpenAI/Anthropic-compatible endpoint, but every project warns "use at your own risk" — they trip GitHub's abuse detection and can suspend Copilot access.
- **[cross-lab-agreed] Using such proxies inside GitHub Actions / CI is the *highest* ban-risk scenario** — non-interactive, scripted, high-volume automation is exactly what GitHub's Acceptable Use policy flags. (Independent web sources agreed.)
- **[verified-source] Copilot SDK (tech preview, Feb 2026)** gives programmatic access (Node/Python/Go/.NET) but connects to a *local Copilot CLI instance via JSON-RPC*, requiring a Copilot subscription or BYOK. Runnable in a runner in principle, but it is agent orchestration, not a raw inference endpoint, and the same automation/ToS caution applies.

## Bottom line

- Want sanctioned inference in a runner → **GitHub Models** (`models: read` + `GITHUB_TOKEN`). This is the supported path and effectively lets you use the same frontier models (incl. GPT-5) that back Copilot.
- Want the actual Copilot *completions* endpoint → not officially available; only via IDE plugins or unsupported reverse-engineered proxies that risk your account, and CI is the worst place to try.

## Evidence table

| Claim | Tag | Source |
|---|---|---|
| Models callable from Actions w/ GITHUB_TOKEN + models:read | verified-source | actions/ai-inference; GitHub blog; docs quickstart |
| Endpoint models.github.ai/inference/chat/completions | verified-source | GitHub blog / docs |
| Rate limits by Copilot plan | verified-source | docs/github-models/prototyping-with-ai-models |
| api.githubcopilot.com is private/IDE-only | verified-source | docs REST copilot; multiple |
| Proxies violate ToS, CI = highest risk | cross-lab-agreed | ericc-ch/copilot-api README; web consensus |
| Copilot SDK = local CLI JSON-RPC | verified-source | github/copilot-sdk; github.blog; docs copilot-sdk |

## Residual unknowns

- Exact current GitHub Models paid-tier numbers (docs defer to Azure Foundry quotas — recheck if you need hard SLAs).
- Whether GitHub has, since Feb 2026, shipped a *remote* Copilot SDK transport (docs only show local CLI JSON-RPC as of research date).

## Sources

- https://github.com/actions/ai-inference
- https://docs.github.com/en/github-models/quickstart
- https://github.blog/ai-and-ml/generative-ai/automate-your-project-with-github-models-in-actions/
- https://docs.github.com/en/github-models/prototyping-with-ai-models
- https://docs.github.com/en/rest/copilot/copilot-user-management
- https://github.blog/news-insights/company-news/build-an-agent-into-any-app-with-the-github-copilot-sdk/
- https://docs.github.com/en/copilot/how-tos/copilot-sdk
- https://github.com/ericc-ch/copilot-api
- https://github.com/messense/copilot-api-proxy
