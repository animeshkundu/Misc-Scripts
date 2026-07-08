# Bing search via the internal "Fast Search API" (from the launch gist)

Freshness: 2026-07-08. Investigated locally (Windows Git Bash, `anikundu@microsoft.com`
Azure CLI login, Microsoft tenant `72f988bf-...`) and on a public GitHub-hosted
`ubuntu-latest` runner. Verdict at bottom.

## 1. What the gist actually is

Source gist: https://gist.github.com/animeshkundu/6ad4bc7fc71c6767f9e0b8cd3959ae35

```
npx bing-mcp-server --api-url https://eureka-search-bbbgamfpgxbkapcy.b02.azurefd.net \
  --search-scope api://31865153-1259-48aa-b2f1-424424d2f09a/.default --host 0.0.0.0
```

It is an MCP-server wrapper (`bing-mcp-server`, run via `npx`) in front of an
**internal Microsoft search HTTP API** exposed through **Azure Front Door**
(`eureka-search-bbbgamfpgxbkapcy.b02.azurefd.net`) and protected by an
**Entra ID (Azure AD) app scope** (`api://31865153-1259-48aa-b2f1-424424d2f09a/.default`).
The endpoint + scope are public in the user's own gist, so they are referenced
here by value. **No access token is ever printed or committed.**

### The wrapped API (authoritative: its own OpenAPI spec)

`GET /openapi.json` (200 with a valid bearer) self-describes as:

> **title:** "Fast Search API" — "Search API implementation using **Bing Grounding**."
> (some firecrawl params — tbs/filter/lang/country/location/timeout/origin — not supported)

Paths: `/HealthCheck`, `/api/v1/search`, `/api/v1/browse`, `/api/v1/finance`,
`/api/v1/sports`, `/api/v1/weather`. Security: `HTTPBearer`.

`POST /api/v1/search` request (`SearchRequest`):
- `query` (string, 1–1000 chars, required)
- `max_num_results` (int 1–20, default 10)
- `fulltext` (bool, default true — include full page text)
- `markdown` (bool, default false)
- `answers` (string[] optional — answer types)

Response (`SearchResponse`): `{ success: bool, data: Document[], text?, result?, warning?, error? }`
where **`Document = { url, title, answer_type, snippets?, metadata?, semanticDocument?, answer? }`**.

**This is a RAW-results backend, not a summarizer.** `data[]` is a list of
`{url, title, snippets}` objects — exactly what a fact-check stage needs (real
resolvable URLs + snippets), not a synthesized paragraph. (`fulltext:true` also
returns page body text per hit if wanted.)

### The `bing-mcp-server` npm package — NOT publicly installable

- `npm view bing-mcp-server` against the default registry (`registry.npmjs.org`)
  → **HTTP 404, package not found**. Same for `@microsoft/bing-mcp-server`,
  `bing-search-mcp`, `@eureka/bing-mcp-server`.
- The machine's `~/.npmrc` points a scoped registry at an **Azure DevOps feed**
  (`domoreexp.pkgs.visualstudio.com/_packaging/npm-mirror`), but that feed's
  auth token is currently **expired (npm E401)**, so the package cannot be
  fetched from it right now either.
- Conclusion: `bing-mcp-server` is an **internal Microsoft package**. The gist's
  plain `npx bing-mcp-server ...` command will NOT run as-is on a machine without
  a working corp ADO-feed login. This is a wrapper-availability blocker that is
  **separate from** the search API itself, which works fine when called directly.

The MCP wrapper's transport (`--host 0.0.0.0` implies a network HTTP/SSE
transport), default port, tool name/params, and its token-acquisition mechanism
could not be confirmed from source because the package is not fetchable.
Two independent research passes reached the same conclusion (public npm 404,
GitHub code-search 0 hits). The **leading, unverified** hypothesis for how the
`npx` server obtains the bearer token is **`DefaultAzureCredential` from
`@azure/identity`** — precisely because the launch command carries *no*
`--client-id` / `--tenant` / `--client-secret` flags, so the server must chain
its own credential sources (env vars → managed identity → **`az login` cached
CLI login** → azd → VS Code). On a laptop with `az login` already done, that
would make it "just work" with no secrets on the command line. A pre-fetched
token in an env var (candidates: `AZURE_ACCESS_TOKEN` / `BING_ACCESS_TOKEN`) is
the less-likely alternative. To settle it deterministically once the package is
installable: `rg -i "DefaultAzureCredential|getToken|ACCESS_TOKEN|AZURE_|StreamableHTTP|SSEServerTransport|\.listen\("`
over the shipped tarball.
(See "Residual" — the direct HTTP API sidesteps this entirely.)

## 2. Authentication model

The API is a standard Entra ID protected resource (HTTPBearer). A caller needs an
Entra access token for the scope `api://31865153-.../.default`.

- **Local (user):** `az account get-access-token --scope <scope> --query accessToken -o tsv`.
  Works **non-interactively** off the existing `az login` cache (no browser/device
  prompt) as long as the signed-in user's tenant/identity is entitled to the scope.
- **CI (automation):** a GitHub runner would authenticate with `azure/login@v2`
  via **OIDC workload-identity federation** (`AZURE_CLIENT_ID` / `AZURE_TENANT_ID`
  / `AZURE_SUBSCRIPTION_ID` secrets + a federated credential on the app that trusts
  the repo/branch), then `az account get-access-token --scope <scope>`. A
  service-principal-with-client-secret path also works. Either way the SP must be
  **granted/consented** to that API's scope, or the token request is refused.

**Two caveats that bite end-to-end (from Microsoft Learn):**
- **`azure/login` green ≠ authorized to this API.** OIDC login only proves
  *authentication*. The client-credentials `.default` token carries only the
  **app roles already admin-consented** for that SP on `api://31865153-...`, or the
  API must ACL-authorize the SP's `appid`/`iss`. With neither, you get AADSTS
  650056 / 500011 / resource-side rejection even with a valid-looking token. The SP
  needs an app-role assignment + admin consent (or an entry in the API's allow-list).
- **OIDC federated-credential subject must match exactly.** The federated cred's
  subject (`repo:ORG/REPO:ref:refs/heads/BRANCH` or `:environment:NAME`) must match
  the workflow's trigger context or the token exchange "fails without error".
  Audience `api://AzureADTokenExchange`, issuer `token.actions.githubusercontent.com`.

**Network:** `*.azurefd.net` is public-anycast by design and reachable from any
internet client including GitHub runners; Private Link only secures the AFD→origin
hop, never client→AFD. The only thing that can block a public runner is a **WAF
custom IP-restriction rule** (→ 403). Our runner probe got **401, not 403**, so no
such WAF rule is in force — reachability is confirmed open.

## 3. LOCAL result (evidence)

Environment: `az` 2.83.0, logged in as `anikundu@microsoft.com`
(tenant `72f988bf-86f1-41af-91ab-2d7cd011db47`), Node v24.18.0, npx 11.16.0.

**Token — obtainable non-interactively.**
`az account get-access-token --scope api://31865153-.../.default` → exit 0,
`expiresOn = 2026-07-08 15:32:13`. (Token length ~1719 chars; value never printed.)

**Reachability + auth gate (consistent both ways):**
| request | no auth | with token |
|---|---|---|
| `GET /` | 401 | 404 (path n/a, auth passed) |
| `GET /openapi.json` | — | 200 |
| `POST /api/v1/search` | 401 | 200 |

**Reliability across 5 varied live queries** (`max_num_results:5`), each
`success=true`, `warning=null`, `error=null`, 5 real resolvable hits:

- *who won the 2022 FIFA World Cup* → en.wikipedia.org/wiki/2022_FIFA_World_Cup_final,
  fifa.com/.../qatar2022, history.com/.../argentina-messi-2022-world-cup-win …
- *OpenAI GPT-4 release date* → openai.com/index/gpt-4/, en.wikipedia.org/wiki/GPT-4 …
- *Azure Front Door pricing* → azure.microsoft.com/en-us/pricing/details/frontdoor/,
  github.com/MicrosoftDocs/azure-docs/.../understanding-pricing.md …
- *latest Kubernetes stable version* → kubernetes.io/releases/,
  github.com/kubernetes/kubernetes/releases …
- *population of Tokyo 2024* → toukei.metro.tokyo.lg.jp/…/2024, stat.go.jp/…/2024np …

**Local verdict: works reliably as a RAW-search backend** (5/5, real URLs +
titles + snippets, `answer_type=webPages`), *when called as a direct HTTP API*.
The `bing-mcp-server` npm wrapper itself could **not** be launched (package 404
on public npm; corp ADO feed 401), so the gist's exact `npx` command is blocked
locally — but that blocker is bypassable by calling `POST /api/v1/search` directly.

## 4. GITHUB RUNNER result (evidence)

Isolation: repo `animeshkundu/Misc-Scripts`, new branch `bing-search-probe`,
cloned to `C:/Users/anikundu/Software/Misc-Scripts-bing`, single new file
`.github/workflows/bing-search-test.yml`. `main` and other branches/workflows
untouched.

Run: https://github.com/animeshkundu/Misc-Scripts/actions/runs/28976138168 —
**status success**, 1 run.

**Reachability from public `ubuntu-latest` (no auth):**
```
REACHABILITY_SUMMARY root=401 openapi=401 search_noauth=401
```
All three probes returned **HTTP 401** — not a timeout (000), not a 403 WAF/AFD
block page, and the 401 body was **empty** (a bare FastAPI HTTPBearer challenge,
identical to what the local machine returns unauthenticated). **The internal AFD
endpoint IS reachable from public GitHub-hosted runners; it is not IP/network/
private-link restricted.** The only gate is the Entra bearer token.

**Auth feasibility:** the workflow detected no Azure secrets and reported
gracefully (did not fail opaquely):
```
have_oidc=false  have_secret=false
AUTH_CONFIG=absent — no AZURE_CLIENT_ID/TENANT_ID secrets found; skipping token+search.
```
`gh secret list` on the repo shows only `COPILOT_GITHUB_TOKEN` — no Azure
credentials — so a real authenticated CI search was correctly not attempted.

**Runner verdict: reachable (401), auth-not-configured.** A real CI search is
feasible the moment Entra OIDC/SP credentials entitled to the scope are added as
repo secrets; the network path is already open.

## 5. Workflow YAML (verbatim)

```yaml
name: bing-search-test

# Probe whether the internal "Fast Search API" (Bing Grounding) behind Azure
# Front Door is usable from a public GitHub-hosted runner.
#   Endpoint: https://eureka-search-bbbgamfpgxbkapcy.b02.azurefd.net  (public in the source gist)
#   Auth scope: api://31865153-1259-48aa-b2f1-424424d2f09a/.default
# Cheapest-first: (1) reachability without auth, (2) auth feasibility (detect
# whether Azure OIDC/SP secrets are configured; only then attempt a token + search).
# No credentials are hardcoded. Nothing is printed that could leak a token.

on:
  push:
    branches: [bing-search-probe]
  workflow_dispatch:

permissions:
  id-token: write   # required for azure/login OIDC, harmless if unused
  contents: read

jobs:
  probe:
    runs-on: ubuntu-latest
    env:
      SEARCH_BASE: https://eureka-search-bbbgamfpgxbkapcy.b02.azurefd.net
      SEARCH_SCOPE: api://31865153-1259-48aa-b2f1-424424d2f09a/.default
    steps:
      # ----- Step 1: Reachability (NO auth). An internal AFD endpoint may be
      # network/WAF/private-link restricted and unreachable from public runners.
      # We expect 401/403 if reachable-but-unauthenticated; a timeout/000 or a
      # generic AFD block page means network-restricted.
      - name: Reachability (root, no auth)
        run: |
          set -x
          echo "== curl root, no auth =="
          code=$(curl -sS -o /tmp/root.body -w '%{http_code}' --max-time 30 "$SEARCH_BASE/" || echo "000")
          echo "ROOT_HTTP_CODE=$code"
          echo "-- first 400 bytes of body --"
          head -c 400 /tmp/root.body || true
          echo
          echo "== curl /openapi.json, no auth =="
          oc=$(curl -sS -o /tmp/openapi.body -w '%{http_code}' --max-time 30 "$SEARCH_BASE/openapi.json" || echo "000")
          echo "OPENAPI_HTTP_CODE=$oc"
          echo "== curl /api/v1/search (POST, no auth) — expect 401/403 if reachable =="
          sc=$(curl -sS -o /tmp/search.body -w '%{http_code}' --max-time 30 \
            -X POST "$SEARCH_BASE/api/v1/search" \
            -H 'Content-Type: application/json' \
            -d '{"query":"reachability probe","max_num_results":1}' || echo "000")
          echo "SEARCH_NOAUTH_HTTP_CODE=$sc"
          head -c 300 /tmp/search.body || true
          echo
          echo "REACHABILITY_SUMMARY root=$code openapi=$oc search_noauth=$sc"

      # ----- Step 2: Detect whether Azure auth is even configured in this repo.
      # We look for the standard OIDC vars/secrets. If absent, we report
      # "auth not configured" and skip the auth path (do NOT fail opaquely).
      - name: Detect Azure auth configuration
        id: authcfg
        env:
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
        run: |
          have_oidc=false
          have_secret=false
          if [ -n "$AZURE_CLIENT_ID" ] && [ -n "$AZURE_TENANT_ID" ]; then
            if [ -n "$AZURE_CLIENT_SECRET" ]; then have_secret=true; else have_oidc=true; fi
          fi
          echo "have_oidc=$have_oidc"   >> "$GITHUB_OUTPUT"
          echo "have_secret=$have_secret" >> "$GITHUB_OUTPUT"
          if [ "$have_oidc" = "true" ] || [ "$have_secret" = "true" ]; then
            echo "AUTH_CONFIG=present (oidc=$have_oidc secret=$have_secret)"
          else
            echo "AUTH_CONFIG=absent — no AZURE_CLIENT_ID/TENANT_ID secrets found; skipping token+search."
          fi

      # ----- Step 3 (conditional): Azure login via OIDC workload-identity
      # federation (the id-token: write permission above enables this). A
      # client-secret path would instead pass `creds` JSON; OIDC is preferred
      # and needs no long-lived secret.
      - name: Azure login (OIDC, only if configured)
        if: steps.authcfg.outputs.have_oidc == 'true'
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      # ----- Step 4 (conditional): mint a token for the CUSTOM scope and run a
      # real search. The token is written to a file and never echoed; only the
      # HTTP code, result count, and titles/urls are printed.
      - name: Authenticated search (only if logged in)
        if: steps.authcfg.outputs.have_oidc == 'true'
        run: |
          set -o pipefail
          echo "== minting token for custom scope (not printed) =="
          if ! az account get-access-token --scope "$SEARCH_SCOPE" \
                --query accessToken -o tsv > /tmp/tok 2>/tmp/tokerr; then
            echo "TOKEN_MINT=failed"
            head -c 300 /tmp/tokerr
            exit 0
          fi
          echo "TOKEN_MINT=ok (len=$(wc -c < /tmp/tok))"
          for q in "who won the 2022 FIFA World Cup" "latest Kubernetes stable version" "Azure Front Door pricing"; do
            echo "== QUERY: $q =="
            code=$(curl -sS -o /tmp/r.json -w '%{http_code}' --max-time 40 \
              -X POST "$SEARCH_BASE/api/v1/search" \
              -H "Authorization: Bearer $(cat /tmp/tok)" \
              -H 'Content-Type: application/json' \
              -d "{\"query\":\"$q\",\"max_num_results\":5,\"fulltext\":false}" || echo "000")
            echo "SEARCH_HTTP_CODE=$code"
            jq -r 'if .success then "count=\(.data|length)" else "resp=\(.|tostring[0:200])" end' /tmp/r.json 2>/dev/null || head -c 200 /tmp/r.json
            jq -r '.data[]? | "  - \(.title[0:60]) | \(.url)"' /tmp/r.json 2>/dev/null | head -5 || true
          done
          rm -f /tmp/tok
```

## 6. Verdict

**Is this a reliable raw-search backend?**

- **Locally: YES, via the direct HTTP API.** Token mints non-interactively off
  `az login`; `POST /api/v1/search` returns raw `{url,title,snippets}` hits;
  5/5 varied queries succeeded with real resolvable URLs. **Caveat:** the gist's
  literal `npx bing-mcp-server` command does **not** run (the package is internal,
  404 on public npm, and the corp ADO feed login is expired). Use the direct API
  call, or restore the ADO-feed npm login to get the MCP wrapper.
- **On a public GitHub runner: REACHABLE, blocked only on auth.** The AFD endpoint
  answers 401 (empty challenge body) from `ubuntu-latest` — **not** network-blocked.
  A real search will work as soon as Entra credentials entitled to the scope are
  configured; none are today.

**What is blocking, and what unblocks it:**

| Blocker | Where | Unblock |
|---|---|---|
| `bing-mcp-server` not on public npm (404) | local + CI | Auth to the corp ADO npm feed (`domoreexp.pkgs.visualstudio.com`), or skip the wrapper and call `POST /api/v1/search` directly |
| No Entra credentials on the runner | CI | Add `azure/login@v2` OIDC (federated cred on the app trusting the repo) or an SP secret, granted/consented to `api://31865153-.../.default` |
| Corp ADO feed token expired | local (wrapper only) | `npm login` / refresh the ADO PAT (only needed if you want the MCP wrapper, not the raw API) |
| Network reachability | — | **Not a blocker** — public runner reaches the endpoint (401, not timeout/WAF) |

Reachability is the cheapest thing that could have killed this, and it passed on
a public runner. The remaining work is purely Entra auth wiring plus (optionally)
the internal-npm-feed login for the MCP wrapper. A self-hosted corp runner would
additionally guarantee reachability if the endpoint is ever tightened, and could
reuse an existing managed identity for the token.

## 7. Sources

- Source gist: https://gist.github.com/animeshkundu/6ad4bc7fc71c6767f9e0b8cd3959ae35
- Authoritative API contract: `GET https://eureka-search-bbbgamfpgxbkapcy.b02.azurefd.net/openapi.json`
  (title "Fast Search API", Bing Grounding; `POST /api/v1/search` → `Document[]`)
- Runner evidence: https://github.com/animeshkundu/Misc-Scripts/actions/runs/28976138168
  (branch `bing-search-probe`)
- `az account get-access-token --scope` (Entra token for a custom scope);
  `azure/login@v2` OIDC — Microsoft Learn.
