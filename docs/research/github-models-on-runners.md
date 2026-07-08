# GitHub Models on GitHub-hosted Runners — Findings

**Date:** 2026-07-08
**Repo:** `animeshkundu/Misc-Scripts`
**Branch:** `models-probe`
**Endpoint:** `https://models.github.ai`
**Auth account:** `animeshkundu` (free/standard GitHub Models tier)

## Objective

Determine whether the sanctioned **GitHub Models inference API** (`https://models.github.ai`) can be called from a GitHub-hosted Actions runner using **only the built-in `GITHUB_TOKEN`** plus a `models: read` permission — with **no secrets, no PAT, no external API key** — and identify which of the best-available models actually return completions on this account.

## TL;DR verdict

- **Keyless works.** `GITHUB_TOKEN` + `permissions: models: read` is sufficient to both list the catalog and run chat inference from an `ubuntu-latest` runner. No repo/org secret is required.
- **Best available model on this account: `openai/gpt-5`** (returned HTTP 200 + a completion). `openai/o3`, `openai/o4-mini`, `openai/gpt-4.1`, `deepseek/DeepSeek-R1`, and `meta/Llama-4-Maverick-17B-128E-Instruct-FP8` also return 200.
- **`openai/gpt-5.5` is not provisioned** for this account — it returns `HTTP 404 unknown_model`. The catalog tops out at `openai/gpt-5`.
- **One critical gotcha:** `gpt-5` and the o-series reasoning models **reject `max_tokens`** (`HTTP 400 unsupported_parameter`). They require **`max_completion_tokens`** instead.
- No `401`/`403`/`429` was observed at this test volume.
- The official `actions/ai-inference@v1` action also works (returns `OK`), with a non-fatal Node 20 deprecation warning.

## Freshness & evidence

Two runs were executed on branch `models-probe` (triggered via `on: push`):

| Run | Purpose | Result | URL |
|---|---|---|---|
| Run 1 | Initial probe; exposed the `max_tokens` 400 on `gpt-5`/`o3` | success | https://github.com/animeshkundu/Misc-Scripts/actions/runs/28974166699 |
| Run 2 | Fixed to send `max_completion_tokens` for reasoning models; all green | success | https://github.com/animeshkundu/Misc-Scripts/actions/runs/28974239087 |

All claims below are taken from the raw job logs of these runs (HTTP status + response body), not asserted from memory.

Runner environment (from Run logs): `ubuntu-24.04`, hosted compute, Azure region `eastus`, runner `2.335.1`. Effective token permissions reported by the runner: `Contents: read`, `Metadata: read`, `Models: read`.

## What was tested and how

A single workflow, `.github/workflows/github-models-test.yml`, with three independent jobs.

1. **`catalog`** — `GET https://models.github.ai/catalog/models` with `Authorization: Bearer $GITHUB_TOKEN`. Captures HTTP status, extracts and sorts the model `id`s with `jq`, and prints the raw head as a fallback. This is the authoritative list of what the account can call.
2. **`inference-curl`** — iterates a ranked list of best-available models and `POST`s a minimal chat request to `https://models.github.ai/inference/chat/completions`, recording HTTP code + completion (or classified error) per model. Sends `max_completion_tokens` for `gpt-5`/o-series and `max_tokens` for the rest.
3. **`inference-action`** — uses the official `actions/ai-inference@v1` action as a second, higher-level method (model `openai/gpt-4.1`), with `continue-on-error` so a failure is observable rather than fatal.

The token is passed via an env var and never printed; GitHub also masks it in logs (`***`).

### Full workflow content (verified against the file on branch `models-probe`)

```yaml
name: GitHub Models on Runner - Probe

on:
  push:
    branches: [models-probe]
  workflow_dispatch:

permissions:
  contents: read
  models: read

jobs:
  catalog:
    runs-on: ubuntu-latest
    steps:
      - name: List available models
        env:
          GH_MODELS_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set +e
          curl -s https://models.github.ai/catalog/models \
            -H "Authorization: Bearer $GH_MODELS_TOKEN" \
            -H "Accept: application/json" \
            -w '\nCATALOG_HTTP %{http_code}\n' -o cat.json
          echo "=== raw HTTP status line above ==="
          echo "=== catalog ids (sorted) ==="
          jq -r '.[].id' cat.json 2>/dev/null | sort
          echo "=== count ==="
          jq -r 'length' cat.json 2>/dev/null || echo "jq-parse-failed"
          echo "=== head of raw body (in case not an array) ==="
          head -c 2000 cat.json; echo

  inference-curl:
    runs-on: ubuntu-latest
    steps:
      - name: Try best models via curl
        env:
          GH_MODELS_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set +e
          # Ranked best-available. gpt-5.5 is not in the catalog for this account.
          # gpt-5 / o-series reasoning models reject max_tokens and require
          # max_completion_tokens, so send that field for them.
          MODELS="openai/gpt-5 openai/o3 openai/o4-mini openai/gpt-4.1 deepseek/DeepSeek-R1 meta/Llama-4-Maverick-17B-128E-Instruct-FP8"
          for M in $MODELS; do
            echo "======================================================"
            echo "=== MODEL: $M ==="
            case "$M" in
              openai/gpt-5*|openai/o1*|openai/o3*|openai/o4*)
                # reasoning models burn tokens on hidden reasoning; give headroom
                TOKFIELD="max_completion_tokens"; TOKN=2048 ;;
              *)
                TOKFIELD="max_tokens"; TOKN=16 ;;
            esac
            body=$(printf '{"model":"%s","messages":[{"role":"user","content":"Reply with exactly: OK"}],"%s":%s}' "$M" "$TOKFIELD" "$TOKN")
            resp=$(curl -s -w $'\nHTTP_CODE:%{http_code}' \
              https://models.github.ai/inference/chat/completions \
              -H "Authorization: Bearer $GH_MODELS_TOKEN" \
              -H "Content-Type: application/json" \
              -d "$body")
            code=$(printf '%s' "$resp" | sed -n 's/.*HTTP_CODE:\([0-9]*\)$/\1/p')
            payload=$(printf '%s' "$resp" | sed 's/HTTP_CODE:[0-9]*$//')
            echo "HTTP $code"
            content=$(printf '%s' "$payload" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
            if [ -n "$content" ]; then
              echo "COMPLETION: $content"
              echo "VERDICT: WORKS ($M)"
            else
              err=$(printf '%s' "$payload" | jq -r '.error.code // .error.message // empty' 2>/dev/null)
              echo "ERROR: ${err:-<none-parsed>}"
              echo "RAW: $(printf '%s' "$payload" | head -c 600)"
              case "$code" in
                403) echo "VERDICT: FORBIDDEN/ENTITLEMENT ($M)";;
                404) echo "VERDICT: NOT-AVAILABLE ($M)";;
                429) echo "VERDICT: RATE-LIMITED ($M)";;
                401) echo "VERDICT: AUTH-FAILED ($M)";;
                *)   echo "VERDICT: FAILED-$code ($M)";;
              esac
            fi
          done

  inference-action:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/ai-inference@v1
        id: inf
        continue-on-error: true
        with:
          model: openai/gpt-4.1
          prompt: "Reply with exactly: OK"
      - name: Show action response
        run: |
          echo "action-outcome: ${{ steps.inf.outcome }}"
          echo "response<<EOF"
          echo "${{ steps.inf.outputs.response }}"
          echo "EOF"
```

## Catalog — 37 model ids (`GET /catalog/models` → HTTP 200)

Grouped by provider. IDs are returned lowercase by the catalog; the inference endpoint accepted mixed-case ids too (e.g. `deepseek/DeepSeek-R1`, `meta/Llama-4-Maverick-...`).

**OpenAI (17)**
- `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `openai/gpt-4.1-nano`
- `openai/gpt-4o`, `openai/gpt-4o-mini`
- `openai/gpt-5`, `openai/gpt-5-chat`, `openai/gpt-5-mini`, `openai/gpt-5-nano`
- `openai/o1`, `openai/o1-mini`, `openai/o1-preview`
- `openai/o3`, `openai/o3-mini`, `openai/o4-mini`
- `openai/text-embedding-3-large`, `openai/text-embedding-3-small`

**Meta (7)**
- `meta/llama-3.2-11b-vision-instruct`, `meta/llama-3.2-90b-vision-instruct`
- `meta/llama-3.3-70b-instruct`
- `meta/llama-4-maverick-17b-128e-instruct-fp8`, `meta/llama-4-scout-17b-16e-instruct`
- `meta/meta-llama-3.1-405b-instruct`, `meta/meta-llama-3.1-8b-instruct`

**Microsoft / Phi (5)**
- `microsoft/phi-4`, `microsoft/phi-4-mini-instruct`, `microsoft/phi-4-mini-reasoning`
- `microsoft/phi-4-multimodal-instruct`, `microsoft/phi-4-reasoning`

**Mistral AI (4)**
- `mistral-ai/codestral-2501`, `mistral-ai/ministral-3b`
- `mistral-ai/mistral-medium-2505`, `mistral-ai/mistral-small-2503`

**DeepSeek (3)**
- `deepseek/deepseek-r1`, `deepseek/deepseek-r1-0528`, `deepseek/deepseek-v3-0324`

**Cohere (1)**
- `cohere/cohere-command-a`

### Notable catalog observations

- **Zero `anthropic/*` ids.** No Claude models are offered on GitHub Models for this account.
- **Zero `gemini*` / `google/*` ids.** No Gemini models are offered.
- **`openai/gpt-5.5` is absent.** Calling it returns `HTTP 404 {"error":{"code":"unknown_model","message":"Unknown model: openai/gpt-5.5"}}`. The best OpenAI model actually present is `openai/gpt-5`.
- The catalog spans OpenAI, Meta (Llama), Microsoft (Phi), Mistral, DeepSeek, and Cohere only.

## Per-model inference results (`POST /inference/chat/completions`)

| Model | HTTP | Verdict | Output (key line) |
|---|---|---|---|
| `openai/gpt-5.5` | 404 | not in catalog | `unknown_model: Unknown model: openai/gpt-5.5` |
| `openai/gpt-5` | **200** | **WORKS** | `OK` |
| `openai/o3` | **200** | **WORKS** | `OK` |
| `openai/o4-mini` | **200** | **WORKS** | `OK` |
| `openai/gpt-4.1` | **200** | **WORKS** | `OK` |
| `deepseek/DeepSeek-R1` | **200** | **WORKS** | `<think>` … (emits a reasoning trace before its answer) |
| `meta/Llama-4-Maverick-17B-128E-Instruct-FP8` | **200** | **WORKS** | `OK` |

Notes:
- `deepseek/DeepSeek-R1` streams a `<think>...</think>` reasoning block; downstream code must strip or account for it.
- Reasoning models (`gpt-5`, `o3`, `o4-mini`) consume output budget on hidden reasoning. With a tiny cap the completion can come back empty; the probe used `max_completion_tokens: 2048` so the visible answer surfaced.

## Critical gotcha — `max_tokens` vs `max_completion_tokens`

In Run 1, `openai/gpt-5` and `openai/o3` returned:

```
HTTP 400
{
  "error": {
    "message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    "param": "max_tokens",
    "code": "unsupported_parameter"
  }
}
```

**Fix:** send `max_completion_tokens` for gpt-5 and the o-series (and give it real headroom, since reasoning tokens count against it). Correct curl body:

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  https://models.github.ai/inference/chat/completions \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "openai/gpt-5",
        "messages": [{"role":"user","content":"Reply with exactly: OK"}],
        "max_completion_tokens": 2048
      }'
```

The `gpt-4.1`, DeepSeek, and Llama families still accept the classic `max_tokens`. After switching reasoning models to `max_completion_tokens`, all six returned HTTP 200 in Run 2.

## `actions/ai-inference@v1` result

The official action (model `openai/gpt-4.1`, prompt "Reply with exactly: OK") succeeded:

```
Model response: OK
action-outcome: success
response: OK
```

**Caveat — Node 20 deprecation warning** (non-fatal):

```
Node.js 20 is deprecated. The following actions target Node.js 20 but are being
forced to run on Node.js 24: actions/ai-inference@v1.
```

The action still ran to success on the forced Node 24; the warning is informational. Expect a future `@v1` bump (or a newer major) to move it off Node 20 officially.

## Auth, permissions, and rate-limit observations

- **Auth:** `Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}` is accepted directly by both the catalog and inference endpoints. No `401` was seen. No secret, PAT, or Azure key was configured.
- **Permission:** `permissions: models: read` at the workflow level is what unlocks the Models scope on `GITHUB_TOKEN`; the runner confirmed `Models: read` in its permission group. Without this scope the token would not carry Models access.
- **No entitlement blocks:** no `403` on any catalog-listed model — every id present in the catalog that was attempted returned a completion. The only `404` was `gpt-5.5`, which is simply not in the catalog.
- **No rate-limiting at test volume:** six sequential inference calls plus the action produced no `429`. This does **not** mean premium models are unthrottled — GitHub Models applies per-model rate-limit tiers (the catalog exposes a `rate_limit_tier` field, e.g. `high` for `gpt-4.1`, `low` for the mini/nano variants). Sustained or parallel production traffic can hit `429`; the probe volume was well under any limit.

## Recommendations for production use

1. **Model choice.** For the strongest general model on this account, use `openai/gpt-5`. For lower latency/cost use `openai/gpt-4.1` (which accepts `max_tokens` and needs no reasoning headroom). Reserve o-series (`o3`, `o4-mini`) for genuine reasoning workloads where the hidden-reasoning cost is justified.
2. **Parameters.** Branch on the model family: send `max_completion_tokens` (with generous headroom, e.g. 1–4k) for `gpt-5*` and `o*`; `max_tokens` is fine for `gpt-4.1*`, DeepSeek, Llama, Mistral, Phi. Do not hardcode a single token param across families.
3. **Response parsing.** Strip `<think>...</think>` blocks from reasoning-model output (DeepSeek-R1) before using the content. Always read `.choices[0].message.content`; treat empty content as a "budget exhausted on reasoning" signal and retry with a larger cap.
4. **Error handling.** Classify by HTTP status: `404 unknown_model` (bad/absent id — validate against `/catalog/models` first), `400 unsupported_parameter` (wrong token field), `429` (back off / retry with jitter; consider a cheaper fallback model), `403` (entitlement — pick a different model), `401` (missing `models: read`). Fetch the catalog once and validate ids against it rather than hardcoding.
5. **Rate limits.** For anything beyond occasional calls, add retry-with-backoff on `429` and a model fallback chain (e.g. `gpt-5` → `gpt-4.1` → `llama-4-maverick`). Do not fan out many parallel premium calls from one workflow.
6. **When this beats the Copilot SDK path.** Prefer the GitHub Models + `GITHUB_TOKEN` path when you want **zero secret management** inside CI, a **standard OpenAI-compatible chat API**, and access to a **multi-vendor catalog** (OpenAI, Meta, DeepSeek, Mistral, Phi, Cohere) from the same endpoint. It is the simplest keyless way to add inference to an Actions workflow. Choose the Copilot SDK path instead when you specifically need Copilot-branded/agentic features or Copilot-seat semantics that the raw Models inference API does not cover. For plain "call a good LLM from CI without provisioning keys," the Models API is the lighter, sanctioned option.
7. **Pin the action.** If using `actions/ai-inference`, pin to a specific ref/SHA and track the Node 20 deprecation; move to a Node-24-native release when published.

## Sources

- GitHub Models — REST API and inference: https://docs.github.com/en/rest/models
- GitHub Models overview / catalog: https://docs.github.com/en/github-models
- Using GitHub Models in Actions (`models: read` permission): https://docs.github.com/en/github-models/use-github-models/integrating-ai-models-into-your-development-workflow
- `actions/ai-inference` action: https://github.com/actions/ai-inference
- Node 20 deprecation on Actions runners: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

## Reproducibility

- Workflow file: `.github/workflows/github-models-test.yml` on branch `models-probe` of `animeshkundu/Misc-Scripts`.
- Triggered by pushing to `models-probe` (`on: push`), or manually via `workflow_dispatch`.
- No secrets required; only `permissions: models: read` (and `contents: read`).
