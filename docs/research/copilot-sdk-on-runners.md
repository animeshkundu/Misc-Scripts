# GitHub Copilot SDK/CLI on GitHub-hosted Runners — Empirical Findings

## Objective

Determine, empirically and not from documentation alone, whether the official
**GitHub Copilot CLI/SDK** (`@github/copilot`) can install and run *real
non-interactive inference* on a standard GitHub-hosted Actions runner
(`ubuntu-latest`), and under exactly which authentication token. Secondary
goal: discover the correct headless invocation and characterize the failure
modes.

## TL;DR verdict

**Yes — the Copilot CLI runs and performs real inference on a stock
`ubuntu-latest` runner, but only with a *user* token that carries a Copilot
entitlement.** The runner's built-in `GITHUB_TOKEN` (a `ghs_` app-installation
token) is rejected with an authentication error and cannot be used for Copilot
inference. Supplying a user token via a repo secret (`COPILOT_GITHUB_TOKEN`)
produced a genuine model response, consuming premium-request credits. The
correct headless invocation is `copilot -p "<prompt>" --allow-all-tools`.

---

## Environment & freshness

| Field | Value |
|---|---|
| Date of run | 2026-07-08 |
| Repository | `animeshkundu/Misc-Scripts` (public) |
| Workflow run URL | https://github.com/animeshkundu/Misc-Scripts/actions/runs/28974166618 (conclusion: **success**) |
| Runner | GitHub-hosted `ubuntu-latest`, runner version `2.335.1` |
| Node | v24 (via `actions/setup-node@v4`, `node-version: '24'`) |
| CLI package | `@github/copilot` (npm), homepage `github.com/github/copilot-cli` |
| CLI version installed | **1.0.69** (`GitHub Copilot CLI 1.0.69.`) |
| Install cost | `added 3 packages in 4s` (one runtime dep: `detect-libc`) |
| Default model | Claude Sonnet 4.5 (per CLI docs; `/model` switches to Sonnet 4 or GPT-5) |

Freshness note: `@github/copilot` publishes very frequently (744 versions;
1.0.69 was published ~23h before this run). Pin a version in production if you
need reproducibility.

---

## What was tested and how

A single workflow with **two parallel jobs** was pushed and run. Both jobs
install the CLI, print `--version` and `--help`, then attempt one
non-interactive inference call — differing only in which token they feed the
CLI.

- **Job `builtin-token`** — feeds the runner's built-in `GITHUB_TOKEN` (via
  `secrets.GITHUB_TOKEN`) as the Copilot auth token. Marked
  `continue-on-error: true` because failure was the expected, informative
  outcome. It also prints the token's *prefix and length only* (never the
  value) to classify the token type.
- **Job `user-pat`** — feeds a repo secret `COPILOT_GITHUB_TOKEN` (a real user
  token with a Copilot seat) into all three env vars the CLI honors
  (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`). This is the "real path"
  and is expected to succeed. It includes a fallback that retries without
  `--allow-all-tools` if the primary invocation fails for a flag reason (it did
  not need to).

### Full workflow file

Path: `.github/workflows/copilot-sdk-test.yml` (verified against the committed
file before pasting).

```yaml
name: Copilot SDK on Runner - Probe

on:
  workflow_dispatch:
  push:
    paths:
      - '.github/workflows/copilot-sdk-test.yml'

permissions:
  contents: read
  models: read

jobs:
  builtin-token:
    name: Built-in GITHUB_TOKEN (expected fail)
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - name: Install Copilot CLI/SDK
        run: |
          npm install -g @github/copilot && echo "installed @github/copilot" || echo "install failed"
          which copilot || true
      - name: CLI info
        run: |
          copilot --version || true
          echo "----- help -----"
          copilot --help || true
      - name: Attempt inference (built-in token)
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          COPILOT_GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set +x
          echo "=== attempt 1: copilot -p --allow-all-tools ==="
          copilot -p "Reply with exactly: OK" --allow-all-tools 2>&1 | tee out.txt; echo "exit=${PIPESTATUS[0]}"
          echo "=== token type (masked; only prefix shown) ==="
          echo "${COPILOT_GITHUB_TOKEN:0:4}****  len=${#COPILOT_GITHUB_TOKEN}"

  user-pat:
    name: COPILOT_GITHUB_TOKEN secret (real path)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - name: Install Copilot CLI/SDK
        run: |
          npm install -g @github/copilot && echo "installed" || echo "install failed"
          which copilot || true
      - name: CLI info
        run: |
          copilot --version || true
          echo "----- help -----"
          copilot --help || true
      - name: Attempt inference (user PAT)
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
          GH_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
        run: |
          set +x
          if [ -z "$COPILOT_GITHUB_TOKEN" ]; then echo "secret COPILOT_GITHUB_TOKEN not set"; exit 1; fi
          echo "=== attempt: copilot -p --allow-all-tools ==="
          copilot -p "Reply with exactly: OK" --allow-all-tools 2>&1 | tee out.txt; rc=${PIPESTATUS[0]}
          echo "exit=$rc"
          if [ "$rc" -ne 0 ]; then
            echo "=== retry without --allow-all-tools (in case flag unsupported) ==="
            copilot -p "Reply with exactly: OK" 2>&1 | tee out2.txt; echo "exit=${PIPESTATUS[0]}"
          fi
          exit $rc
```

---

## Non-interactive invocation (from the runner's own `--help`)

The invocation was confirmed directly from `copilot --help` printed *on the
runner*, not just from external docs.

```
copilot -p "<prompt>" --allow-all-tools
```

- `-p` / `--prompt` — supplies a single prompt; the CLI completes the task and
  exits (this is what makes it non-interactive rather than launching the TUI).
- `--allow-all-tools` — help text: *"Allow all tools to run automatically
  without confirmation; **required for non-interactive mode** (env:
  `COPILOT_ALLOW_ALL`)."* The env equivalent means you can instead export
  `COPILOT_ALLOW_ALL=1` and omit the flag.
- Related permission flags seen in `--help`: `--allow-all` (superset of
  `--allow-all-tools --allow-all-paths --allow-all-urls`), `--allow-tool`,
  `--allow-url`, `--deny-tool` (takes precedence over allow), `--add-dir`.

### Auth token precedence

The CLI reads the Copilot auth token from these environment variables, in this
order of precedence:

```
COPILOT_GITHUB_TOKEN  →  GH_TOKEN  →  GITHUB_TOKEN
```

(Official docs enumerate `GH_TOKEN` / `GITHUB_TOKEN`; the CLI's own error text
adds `COPILOT_GITHUB_TOKEN` as the first-checked variable.)

---

## Per-job results with evidence

### Job `builtin-token` — built-in `GITHUB_TOKEN` → **auth failure (expected)**

Exit code **1**. Verbatim log lines:

```
=== attempt 1: copilot -p --allow-all-tools ===
Error: Authentication failed (Request ID: 6411:CC580:7E3E85:8B2F55:6A4EB5BE)

Your GitHub token may be invalid, expired, or lacking the required permissions.

To resolve this, try the following:
  • Start 'copilot' and run the '/login' command to re-authenticate
  • If using a Fine-Grained PAT, ensure it has the 'Copilot Requests' permission enabled
  • If using COPILOT_GITHUB_TOKEN, GH_TOKEN or GITHUB_TOKEN environment variable, verify the token is valid and not expired
  • Run 'gh auth status' to check your current authentication status
exit=1
=== token type (masked; only prefix shown) ===
ghs_****  len=377
```

**Why it's rejected:** The built-in `GITHUB_TOKEN` is a `ghs_`-prefixed **GitHub
App installation token** (here 377 chars long), minted per-run for the
`github-actions[bot]` app. It authorizes repo/API scopes for the workflow but is
**not a token type Copilot accepts** — Copilot inference is billed against a
*user* (or org-seat) entitlement, and an app-installation identity has no
Copilot seat. Classification: **auth/entitlement failure**, not a flag/usage or
network error (the request reached GitHub and returned a structured
Authentication-failed error with a Request ID).

### Job `user-pat` — user token secret → **success**

Exit code **0**. Verbatim log lines:

```
=== attempt: copilot -p --allow-all-tools ===
OK


Changes    +0 -0
AI Credits 5.59 (4s)
Tokens     ↑ 22.3k (22.3k written) • ↓ 4
Resume     copilot --resume=5f171ea0-c4d0-42bf-b0c0-cb29346c2598
exit=0
```

The model replied exactly `OK`. This is genuine inference, not a stub: the CLI
reported real usage — **AI Credits 5.59** for a 4-second call, **~22.3k tokens
written up / 4 tokens down**, and a resumable session id. The fallback branch
(retry without `--allow-all-tools`) never fired because the primary invocation
succeeded on the first try. Default model is Claude Sonnet 4.5.

Only **one** workflow run was needed; no flag corrections were required.

---

## Token-type findings

| Token type | Prefix | Works for Copilot inference? | Notes |
|---|---|---|---|
| App installation token (built-in `GITHUB_TOKEN`) | `ghs_` | **No** | No Copilot seat; rejected with "Authentication failed". This is what every Actions job gets for free. |
| OAuth user token (e.g. from `gh auth`) | `gho_` | **Yes** (if the user has a Copilot seat) | The active `gh auth token` used here belongs to a user with a seat; it worked. |
| User-to-server token | `ghu_` | **Yes** (with seat) | User identity → carries entitlement. |
| Fine-grained PAT | `github_pat_` | **Yes**, if it has the **"Copilot Requests"** permission enabled | Documented path; scope the PAT to `Copilot Requests` only. |
| Classic PAT | `ghp_` | Generally yes with a seat, but prefer fine-grained | Broader scopes than needed; avoid for least-privilege. |

Rule of thumb: **Copilot needs a token tied to a human/seat identity.** The
machine identity that Actions hands you by default (`ghs_`) does not qualify.

### Security handling used for the secret

- The secret was set by **piping**, so the token value never appeared in a
  command argument, prompt, shell history, or log:
  ```
  gh auth token | gh secret set COPILOT_GITHUB_TOKEN --repo animeshkundu/Misc-Scripts
  ```
- Existence was confirmed with `gh secret list` (which shows only the name and
  timestamp, never the value).
- In the workflow, the token is injected only via `env:` from
  `${{ secrets.* }}`; GitHub Actions auto-masks registered secrets in logs
  (visible as `***`). The probe deliberately prints only the token's **4-char
  prefix and length** for classification, never the body.

---

## Cost, credits & entitlement observations

- A single trivial "Reply with exactly: OK" prompt cost **5.59 AI credits** and
  counted as one premium request against the account's monthly quota. Even
  minimal prompts have non-trivial fixed overhead (~22.3k input tokens written)
  because the agent harness sends a large system prompt / tool schema.
- Each submitted prompt reduces the monthly premium-request quota by one (per
  official docs). Budget accordingly for CI that runs Copilot on every push/PR.
- The `animeshkundu` account **has a working Copilot seat** — the successful
  run consumed credits and returned a response, so there is no entitlement gap.
- No rate-limit or throttling error was observed in this single-run probe;
  rate/entitlement limits were not stress-tested.

---

## Gotchas & recommendations for production use

1. **Do not rely on the built-in `GITHUB_TOKEN`.** It will always fail Copilot
   auth (`ghs_` app token). You must provision a seat-bearing user token.
2. **Provision the secret securely.** Prefer a **fine-grained PAT scoped to only
   the "Copilot Requests" permission**, stored as an encrypted repo/org secret,
   set via a pipe (`... | gh secret set ...`) so the value never lands in a log
   or shell history. Rotate it and set an expiry.
3. **Seat requirement.** The token's owner must have an active Copilot
   subscription/seat. An org can disable Copilot CLI at the org/enterprise
   level, which would block this even with a valid seat — verify org policy.
4. **`--allow-all-tools` is mandatory for headless mode** (or export
   `COPILOT_ALLOW_ALL=1`). Without it the CLI pauses for interactive tool
   approval and will hang in CI. For safety, prefer the least-privilege form:
   grant specific tools with `--allow-tool='shell(git)'` and/or block dangerous
   ones with `--deny-tool='shell(rm)'` / `--deny-tool='shell(git push)'` rather
   than blanket `--allow-all-tools`, since headless approval means Copilot can
   run arbitrary shell commands with the runner's privileges.
5. **Pin the CLI version** (`npm install -g @github/copilot@1.0.69`) for
   reproducible CI; the package ships new versions almost daily.
6. **Model selection.** Default is Claude Sonnet 4.5; in interactive mode
   `/model` switches models, but in `-p` headless mode confirm the flag/config
   for pinning a model if you need determinism (not exercised in this probe).
7. **Cost control.** Because each call is a billed premium request with large
   fixed token overhead, gate Copilot steps behind explicit triggers
   (`workflow_dispatch`, labels, path filters) rather than running them on every
   commit.
8. **Node 24.** `actions/setup-node@v4` still targets Node 20 internally and is
   force-run on Node 24 with a deprecation warning; harmless here but expect the
   annotation.

---

## When to use Copilot SDK vs GitHub Models on a runner

Use the **Copilot CLI/SDK** when you want an *agentic* assistant on the runner —
one that can read the repo, edit files, run shell commands, and reason across a
task with a coding-agent harness — and you are willing to consume Copilot
premium-request credits under a seat-bearing user token. It is the right tool
for "have an agent do work in this checkout" scenarios. Use **GitHub Models**
(the `models: read` permission + the Models inference API) when you just need
raw **LLM inference** — a prompt in, a completion out — without the agent
harness, tool execution, or a Copilot seat; Models is authenticated by the
built-in `GITHUB_TOKEN` (with `permissions: models: read`), so it needs no extra
secret and no per-user entitlement, making it simpler and cheaper for pure
text-generation/classification steps. In short: **Copilot SDK = agent that acts
on your repo (needs a seat + secret); GitHub Models = plain model calls (needs
only the built-in token).** This is also why the probe workflow keeps
`permissions: models: read` — it is harmless and lets a companion experiment hit
GitHub Models with zero extra setup.

---

## Sources / links

- Run: https://github.com/animeshkundu/Misc-Scripts/actions/runs/28974166618
- Repo: https://github.com/animeshkundu/Misc-Scripts
- npm package: `@github/copilot` — https://www.npmjs.com/package/@github/copilot
- Copilot CLI source/readme: https://github.com/github/copilot-cli
- Official docs — About Copilot CLI: https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli
- Premium requests: https://docs.github.com/copilot/managing-copilot/monitoring-usage-and-entitlements/about-premium-requests
- Copilot plans: https://github.com/features/copilot/plans
- Evidence for all quoted log lines: `gh run view 28974166618 --repo animeshkundu/Misc-Scripts --log`
