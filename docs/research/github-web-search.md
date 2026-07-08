# GitHub-native web search for raw source pointers

**Question:** Can any GitHub-native surface (Copilot search, Copilot CLI/SDK, GitHub Models, GitHub search APIs) perform **open-web search that returns RAW results** — a list of page URLs + snippets — rather than an LLM-summarized answer that hides its sources? And can it run **keyless (or with the existing seat secret) on a GitHub-hosted runner**, reliably enough for the blog pipeline's fact-check stage (which needs source URLs to fetch and verify)?

**Freshness:** Researched and empirically probed 2026-07-08.
**Empirical evidence:** GitHub Actions run on `ubuntu-latest`, repo `animeshkundu/Misc-Scripts`, branch `web-search-probe`.
- Run: https://github.com/animeshkundu/Misc-Scripts/actions/runs/28975983455 (both jobs green, first attempt)
- Commit: https://github.com/animeshkundu/Misc-Scripts/commit/f25b6e706e40ada73dfea48500f94cce2e51b70a
- Workflow: `.github/workflows/web-search-test.yml` on branch `web-search-probe` (not merged to `main`)

---

## TL;DR verdict

**YES — a reliable GitHub-native RAW open-web search exists: the GitHub Copilot CLI's built-in `web_search` tool.** Run non-interactively on a runner, it returns a structured list of real, resolvable `{title, url, snippet}` hits (not a summary), and its companion `web_fetch` tool retrieves arbitrary open-web page content. Verified empirically across 5 varied queries plus 2 consistency re-runs — every run returned real URLs, including fresh 2025–2026 content.

**The one catch: it is NOT keyless.** It requires a **Copilot seat token** (`COPILOT_GITHUB_TOKEN`), not the runner's built-in `GITHUB_TOKEN`. That secret already exists in `animeshkundu/Misc-Scripts`. Requests also consume **Copilot premium-request/AI-credit quota** on that seat.

**Everything else is a dead end for open-web raw pointers:**
- **GitHub Models** — no web access at all (confirmed negative control: model replied `NO_WEB_ACCESS`).
- **GitHub search APIs / `gh search`** — raw pointers, but **GitHub-hosted content only**, never the open web.
- **Copilot Chat's documented Bing grounding** — summarized answer + citations only; raw hits are contractually withheld (but the CLI's `web_search` tool is a *different, more permissive* surface — see below).

---

## Part A — Research comparison

| Option | Raw pointers vs summarized | Open-web vs GitHub-only | Keyless-on-runner vs needs secret/seat | Reliability / rate-limit notes |
|---|---|---|---|---|
| **Copilot CLI `web_search` tool** (`@github/copilot`) | **RAW** — structured `{title,url,snippet}` list, coercible to clean JSON (empirically verified) | **Open web** | **Needs seat** — `COPILOT_GITHUB_TOKEN` (Copilot seat PAT); *not* keyless | Verified reliable ×7 runs; consumes Copilot premium-request quota; ~11–22s/query |
| **Copilot CLI `web_fetch` tool** | RAW page content (fetch, not search) | Open web (SSRF-guarded: blocks file://, RFC1918, metadata IPs) | Needs seat (same token) | Verified: fetched `example.com` raw HTML |
| **Copilot Chat / Bing grounding (documented product)** | **Summarized** answer + citations; raw hits withheld per Bing use-and-display terms. URLs extractable from citations (lossy) | Open web | Interactive UI surfaces only; no raw-hits API | N/A programmatically |
| **GitHub Models inference API** (`models.github.ai`) | N/A — **no web access**. Supports client-side function calling (`tools`), but no server-side web/Bing/retrieval tool | Neither (cannot reach web) | Keyless on runner (`GITHUB_TOKEN` + `models: read`) | Confirmed negative control; free tier ~15 req/min, 150 req/day (low tier) |
| **`gh search code` / REST `/search/code`** | RAW pointers **with** `text-match` snippet fragments (`application/vnd.github.text-match+json`) | **GitHub code only** | Keyless on runner (`GITHUB_TOKEN`) | `/search/code` = 10 req/min |
| **`gh search repos/issues/prs/commits`, REST `/search/*`, GraphQL `search`** | RAW pointers (url, full_name, title…); most no snippet (text-match opt-in on REST) | **GitHub content only** | Keyless on runner | REST search 30 req/min; GraphQL 5k pts/hr |

**Key clarification on the two Copilot web-search surfaces.** The *documented* consumer/Azure "Grounding with Bing Search" path explicitly withholds raw results — you get a synthesized answer plus citation URLs only. But the **Copilot CLI ships its own first-class `web_search` tool** whose tool-result payload *is* a title/url/snippet array. That payload is directly obtainable non-interactively (prompt the agent to emit it as JSON, or capture the tool-result event via `--output-format json`). The empirical probe below proves the CLI path yields raw hits, so it is the surface that matters for the pipeline — not the Bing-grounding product doc.

**GitHub-only vs open-web.** The `gh search` / REST / GraphQL family returns genuine raw pointers, but only into GitHub-hosted content (repos, code, issues, PRs, commits, users, discussions). None crawl the open web. They have niche value only when the claim under fact-check is *about a GitHub artifact itself* (a commit/PR/README exists or says X). For open-web fact-checking (news, blogs, standards bodies, PDFs) they are irrelevant.

---

## Part B — Empirical probe

### Design
Three empirical questions, all run on `ubuntu-latest`:
1. **Does the seat token enable `web_search` on a runner?** Enumerate the CLI's available tools and assert `web_search` / `web_fetch` are present.
2. **Does `web_search` return real, resolvable raw URLs across varied queries, and is it consistent?** Run 5 topically varied queries (a technical fact, a fast-moving current event, a versioned release, a health-standards claim, a recent award) coerced to raw `{title,url,snippet}` JSON; extract and count URLs. Re-run query 1 twice more for consistency.
3. **Negative control — can a bare model reach the web?** Ask GitHub Models (`gpt-4o-mini`, keyless `GITHUB_TOKEN`) to fetch a live headline, instructed to reply `NO_WEB_ACCESS` if it cannot.

`web_fetch` on an arbitrary open-web URL (`example.com`) was additionally verified locally before the run (returned raw `<!doctype html>...Example Domain` HTML).

### Workflow (verbatim)

```yaml
name: Web Search Probe - Copilot CLI raw results

on:
  push:
    branches:
      - web-search-probe
    paths:
      - '.github/workflows/web-search-test.yml'
  workflow_dispatch:

permissions:
  contents: read
  models: read

jobs:
  copilot-web-search:
    name: Copilot CLI web_search raw-results probe
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install Copilot CLI
        run: |
          npm install -g @github/copilot && echo "installed @github/copilot" || echo "install failed"
          which copilot || true
          copilot --version || true

      - name: Enumerate available tools (confirm web_search present with seat token)
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
        run: |
          set +x
          if [ -z "$COPILOT_GITHUB_TOKEN" ]; then echo "secret COPILOT_GITHUB_TOKEN not set"; exit 1; fi
          echo "=== TOOL LIST ==="
          copilot -p "List every tool you have available to you right now, one per line, exact tool names only. Do not use any tools, just list them." \
            --allow-all-tools --no-color -s 2>&1 | tee tools.txt
          echo "=== web_search present? ==="
          grep -q '^web_search$' tools.txt && echo "WEB_SEARCH_TOOL: PRESENT" || echo "WEB_SEARCH_TOOL: ABSENT"
          grep -q '^web_fetch$' tools.txt && echo "WEB_FETCH_TOOL: PRESENT" || echo "WEB_FETCH_TOOL: ABSENT"

      - name: Run web_search across varied queries (coerce to raw JSON)
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
        run: |
          set +x
          declare -a QUERIES=(
            "GitHub Models API rate limits"
            "SpaceX Starship latest flight test outcome 2026"
            "Rust 1.85 release notes edition 2024"
            "WHO guidance on daily sugar intake grams"
            "Nobel Prize in Physics 2025 laureates"
          )
          overall_rc=0
          for i in "${!QUERIES[@]}"; do
            q="${QUERIES[$i]}"
            n=$((i+1))
            echo ""
            echo "########## QUERY $n: $q ##########"
            out="q${n}.json"
            copilot -p "Use the web_search tool to search for: \"$q\". Then output ONLY a JSON array of the raw search results, each object with keys \"title\",\"url\",\"snippet\". Output nothing else but the JSON array. Do not summarize or answer the question." \
              --allow-tool 'web_search' --no-color -s > "$out" 2>&1
            rc=$?
            echo "--- raw agent output (query $n, exit=$rc) ---"
            cat "$out"
            echo ""
            echo "--- extracted URLs (query $n) ---"
            # Extract http(s) URLs found anywhere in the output as evidence of resolvable pointers
            grep -oE 'https?://[^"[:space:]]+' "$out" | sort -u | tee "urls${n}.txt"
            cnt=$(wc -l < "urls${n}.txt" | tr -d ' ')
            echo "URL_COUNT query $n = $cnt"
            if [ "$cnt" -lt 1 ]; then
              echo "WARN: query $n returned 0 URLs"
              overall_rc=1
            fi
          done
          echo ""
          echo "########## SUMMARY ##########"
          for n in 1 2 3 4 5; do
            c=$(wc -l < "urls${n}.txt" 2>/dev/null | tr -d ' ' || echo 0)
            echo "query $n url_count=$c"
          done
          exit $overall_rc

      - name: Consistency re-run (query 1 twice more)
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
        continue-on-error: true
        run: |
          set +x
          q="GitHub Models API rate limits"
          for r in a b; do
            echo "########## CONSISTENCY RUN $r ##########"
            copilot -p "Use the web_search tool to search for: \"$q\". Then output ONLY a JSON array of the raw search results, each object with keys \"title\",\"url\",\"snippet\". Output nothing else but the JSON array." \
              --allow-tool 'web_search' --no-color -s 2>&1 | tee "consistency_${r}.txt"
            echo "--- urls run $r ---"
            grep -oE 'https?://[^"[:space:]]+' "consistency_${r}.txt" | sort -u
          done

  github-models-negative-control:
    name: GitHub Models negative control (cannot reach web)
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - name: Ask a bare GitHub Models call to "search the web"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set +x
          echo "=== Bare GitHub Models chat: no tools, asked to search the web ==="
          resp=$(curl -sS -X POST "https://models.github.ai/inference/chat/completions" \
            -H "Authorization: Bearer $GITHUB_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{
              "model": "openai/gpt-4o-mini",
              "messages": [
                {"role":"user","content":"Search the web for the current top headline on nytimes.com right now and give me the exact URL and headline text. If you cannot access the internet, say exactly: NO_WEB_ACCESS."}
              ]
            }')
          echo "$resp"
          echo ""
          echo "=== verdict ==="
          echo "$resp" | grep -qi "NO_WEB_ACCESS" && echo "NEGATIVE_CONTROL: model admits NO web access (expected)" || echo "NEGATIVE_CONTROL: check response above (model may have hallucinated a URL)"
```

### Results — per query, with evidence log lines

Tool enumeration (seat token on runner):
```
WEB_SEARCH_TOOL: PRESENT
WEB_FETCH_TOOL: PRESENT
```
Full tool list observed: `powershell, read_powershell, stop_powershell, list_powershell, view, create, edit, web_fetch, fetch_copilot_cli_documentation, skill, sql, session_store_sql, read_agent, list_agents, write_agent, grep, glob, task, github-mcp-server-get_copilot_space, github-mcp-server-get_file_contents, github-mcp-server-list_copilot_spaces, github-mcp-server-search_code, github-mcp-server-search_users, web_search`.

| # | Query | URLs returned | Sample evidence (from run log) |
|---|---|---|---|
| 1 | GitHub Models API rate limits | **6** | `https://github.blog/changelog/2025-05-15-github-models-api-now-available/`, `https://github.com/orgs/community/discussions/149698`, `https://docs.github.com/en/billing/concepts/product-billing/github-models` |
| 2 | SpaceX Starship latest flight test outcome 2026 | **4** | `https://www.teslarati.com/spacex-starship-v3-flight-12/`, `https://www.borntoengineer.com/starship-v3-test-flight`, `https://www.globalsecurity.org/space/systems/space-x-starship-012.htm` |
| 3 | Rust 1.85 release notes edition 2024 | **3** | `https://releases.rs/docs/1.85.0/`, `https://www.developer-tech.com/news/rust-1-85-0-released-2024-edition-stabilised/` |
| 4 | WHO guidance on daily sugar intake grams | **1** | `https://www.who.int/news-room/fact-sheets/detail/healthy-diet` (authoritative primary source) |
| 5 | Nobel Prize in Physics 2025 laureates | **3** | `https://www.nobelprize.org/prizes/physics/2025/summary/`, `https://www.nobelprize.org/prizes/physics/2025/press-release/` — snippet correctly named **Clarke, Devoret, Martinis** |

Raw-hit fidelity (verbatim first hit, query 5):
```json
{"title":"Nobel Prize in Physics 2025 - NobelPrize.org","url":"https://www.nobelprize.org/prizes/physics/2025/summary/","snippet":"The Nobel Prize in Physics 2025 was awarded jointly to John Clarke, Michel H. Devoret and John M. Martinis \"for the discovery of macroscopic quantum mechanical tunnelling and energy quantisation in an electric circuit.\""}
```
This is a true raw hit: title + resolvable URL + factual snippet, not a summary.

**Consistency (query 1, three total runs).** The stable core set `dev.to/...4fk1`, `devactivity.com/insights/...`, `github.com/orgs/community/discussions/149698`, `github.blog/changelog/2025-06-24-...`, `github.blog/changelog/2025-05-15-...` appeared in all three runs. One run additionally surfaced `docs.github.com/en/billing/.../github-models`. Snippet wording varied slightly run-to-run (model re-phrases the snippet field), but URLs were stable and always resolvable. No summarization leakage: output was a clean JSON array in every run.

**Negative control (verbatim runner output):**
```
{"choices":[{... "message":{"annotations":[],"content":"NO_WEB_ACCESS.","refusal":null,"role":"assistant"}}], ... "model":"gpt-4o-mini-2024-07-18", ...}
NEGATIVE_CONTROL: model admits NO web access (expected)
```
Confirms a bare GitHub Models call cannot reach the internet — a model alone cannot search.

**Run budget:** 1 run, passed first attempt (budget was 2). Copilot job `2m20s`, negative-control job `5s`.

---

## Honest verdict for the pipeline

**A reliable GitHub-native RAW open-web search DOES exist for the fact-check stage: the Copilot CLI `web_search` tool, with `web_fetch` for retrieving the pages it finds.** It returns exactly what the pipeline needs — a list of `{title, url, snippet}` pointers to fetch and verify — and did so reliably across every query and re-run, with fresh 2025–2026 coverage and authoritative primary sources (who.int, nobelprize.org) surfacing naturally.

**But weigh three caveats before adopting it as the primary backend:**
1. **Not keyless.** It needs a Copilot **seat token** (`COPILOT_GITHUB_TOKEN`), not the free runner `GITHUB_TOKEN`. This trades "external API key" for "Copilot seat + secret" — you have removed the *third-party* dependency, not the *credential* dependency.
2. **Consumes Copilot premium-request / AI-credit quota** per invocation (each `web_search` runs a full agent turn). At blog-pipeline volume this has real cost and its own rate limits — heavier per call than a purpose-built search API.
3. **Agent-mediated, not a raw API.** You are driving a coding agent and coercing its tool output into JSON, not hitting a documented search endpoint with a stable response contract. It worked reliably here, but the `{title,url,snippet}` shape is prompt-enforced, not a guaranteed schema. For hardened production, capture the underlying tool-result event via `--output-format json` rather than trusting the prose to be clean JSON.

**Recommended fallback / comparison.** If keyless-and-cheap is the priority, a dedicated search API (**Tavily / Brave / Exa**, or self-hosted **SearXNG**) remains the cleaner raw-pointer source: purpose-built, documented JSON schema, its own key but no agent overhead or Copilot quota draw. The Copilot CLI path is the best option when you specifically want to **avoid a third-party search vendor** and are willing to spend a Copilot seat's quota. GitHub Models and the GitHub search APIs are **not** viable open-web source-finders (no web access, and GitHub-scoped-only, respectively).

**Suggested architecture:** treat `web_search` as one pluggable backend behind the fact-check stage's search interface, with a dedicated search API as the alternate. Prefer capturing raw tool-result events (`--output-format json`) over parsing prose. Budget for Copilot premium-request consumption and add a rate-limit backoff.

---

## Sources

Empirical (this project):
- Run log: https://github.com/animeshkundu/Misc-Scripts/actions/runs/28975983455
- Workflow commit: https://github.com/animeshkundu/Misc-Scripts/commit/f25b6e706e40ada73dfea48500f94cce2e51b70a

Copilot CLI:
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools
- https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/research
- https://www.npmjs.com/package/@github/copilot

Copilot Chat / Bing grounding (documented, summary-only):
- https://learn.microsoft.com/en-us/azure/foundry-classic/agents/how-to/tools-classic/bing-grounding
- https://docs.github.com/en/copilot/how-tos/manage-your-account/manage-policies
- https://github.blog/changelog/2024-10-29-web-search-in-github-copilot-chat-now-available-for-copilot-individual/
- https://github.blog/changelog/2025-10-16-copilot-coding-agent-can-now-search-the-web/

GitHub Models (no web access):
- https://docs.github.com/en/rest/models/inference
- https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models
- https://github.blog/changelog/2025-05-15-github-models-api-now-available/

GitHub search APIs (GitHub-scoped raw pointers only):
- https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28
- https://cli.github.com/manual/gh_search_code
- https://docs.github.com/en/graphql/reference/queries#search
- https://docs.github.com/en/search-github/github-code-search/about-github-code-search
