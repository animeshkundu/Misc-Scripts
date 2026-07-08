# condukt — Repository Deep-Dive and Fit as the Blogging Pipeline's "Final Piece"

**Date:** 2026-07-08
**Upstream:** https://github.com/animeshkundu/condukt
**Clone path (temp, outside this project):** `C:/Users/anikundu/AppData/Local/Temp/condukt-explore`
**HEAD SHA:** `1aab6af9c694ad744928e277e188722cba3c9aaf`
**HEAD date / subject:** 2026-03-19 — `fix: resolve relative MCP server paths to absolute before passing to CLI`
**Version:** `0.6.17` (published to npm as `condukt`, MIT)

> Freshness caveat: the working tree is v0.6.17 with a HEAD dated 2026-03-19. It is a published, tested package, not a fresh scaffold. All claims below are cited to `path:line` in the clone.

---

## 1. What condukt is (one paragraph, verified)

condukt is a **domain-agnostic AI-agent workflow framework**: you define a pipeline as a directed graph of typed nodes, and condukt executes it with fan-out parallelism, fan-in synchronization, and bounded loop-back, while event-sourcing every step to a JSONL log for crash recovery and shipping a React UI to visualize the running graph (`README.md:3`, `docs/ARCHITECTURE.md:5-15`). It is explicitly **not** a blog tool and carries **zero domain vocabulary** — enforced as the framework's Rule #1: "the framework must never import investigation-specific concepts" (`CLAUDE.md:5,59`; `docs/ARCHITECTURE.md:5`). The name in the temp clone path (`...-blog/...`) is incidental. It is best labeled an **orchestration/pipeline-execution engine bundled with a matching visualization UI and pluggable LLM runtimes** — one library, split into 12 sub-path exports so a consumer pulls only the layers it needs (`package.json:22-96`, `README.md:110-127`).

**Target user:** developers building LLM-agent pipelines that need human-in-the-loop gates, crash recovery, and live visualization — multi-agent research/write/review flows, approval-gated automation, CI/CD-style graphs. The shipped example is a generic lint→test→build→approve→deploy CI/CD flow with a human `gate` (`examples/counter-test/cicd.ts`), proving the genericity claim.

---

## 2. Stack, build, and how to run

| Aspect | Value |
|---|---|
| Language | TypeScript (strict), ESM, targets Node ≥ 22 |
| UI | React 19 + `@xyflow/react` (React Flow), dark "warm charcoal" theme |
| LLM runtime | GitHub **Copilot** CLI / SDK (`@github/copilot-sdk`) + a `MockRuntime` |
| Tests | Vitest — **50 test files, 659 tests** (the README badge verifies: 653 static `it/test` sites + a loop generating 7) |
| Deps (runtime) | only `react-markdown`, `remark-gfm`; React/xyflow/copilot-sdk are **optional peer deps** (`package.json:109-123`) |
| License | MIT |

**Commands** (`package.json:101-108`):
```bash
npm install          # install
npm run build        # tsc -p tsconfig.build.json → dist/ (+ copies xyflow style.css)
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

**How a consumer runs a pipeline** — it is a **library, not a CLI or server.** You wire it yourself (`README.md:47-60`):
```ts
import { run, validateGraph } from 'condukt';
import { StateRuntime } from 'condukt/state';
import { FileStorage } from 'condukt/state/server';
import { createBridge } from 'condukt/bridge';

validateGraph(pipeline);
const storage = new FileStorage('.flow-data');
const state   = new StateRuntime(storage);
const bridge  = createBridge(runtime, state);      // runtime = an AgentRuntime
const execId  = await bridge.launch({ executionId, graph: pipeline, dir, params });
```
`run()` itself is stateless — all persistence happens through callbacks you supply (`docs/API.md:12-21`). To get a live dashboard you host the `condukt/ui` React components against the bridge's SSE/REST surface yourself; condukt ships the components, not the HTTP server.

---

## 3. Architecture and module map

Six layers, top to bottom (`README.md:73-107`, `docs/ARCHITECTURE.md`):

```
Your code:  FlowGraph { nodes, edges, start }  ·  agent() deterministic() gate() verify()
   │
Execution   src/        DAG scheduler · fan-out · fan-in · bounded loop-back · emits typed events
   │
State       state/      pure reducer · JSONL event log · projection · crash recovery
   │
Bridge      bridge/     launch · stop · resume · retryNode · skipNode · approveGate + SSE
   │
Runtimes    runtimes/   AgentRuntime interface → CopilotBackend (Subprocess/SDK) · MockRuntime
   │
UI          ui/         FlowGraph · MiniPipeline · NodePanel · 50+ tool formatters (React 19)
```

### 3.1 Core data model (`src/types.ts`)
- **`FlowGraph`** = `{ nodes: Record<id, NodeEntry>, edges: Record<source, Record<action, EdgeTarget>>, start: string[], maxIterations?, loopFallback? }` (`types.ts:88-94`). Edges are keyed by **action** — a node returns `{ action }` and the scheduler routes on it.
- **`NodeEntry`** carries `fn`, `nodeType` (`'agent'|'deterministic'|'gate'|'verify'`), `output` (artifact filename), `reads`, `model`, `timeout` (`types.ts:97-105`).
- **`NodeFn = (input: NodeInput, ctx: ExecutionContext) => Promise<NodeOutput>`** — the one callable contract. `NodeInput` gives `{ dir, params, artifactPaths, retryContext? }`; `NodeOutput` returns `{ action, artifact?, metadata? }` (`types.ts:30-52`). **Artifacts are files** written into a shared `dir`; nodes read predecessors' artifacts by path.
- **`EdgeTarget = string | string[]`** — a string[] target is **fan-out** to parallel branches (`types.ts:68`).
- **`LoopFallbackEntry`** — `{ source, action, fallbackTarget, maxIterations?, feedbackExtractor? }` bounds loop-back and extracts feedback for the retry (`types.ts:71-81`).

### 3.2 Scheduler (`src/scheduler.ts`)
- `validateGraph()` does **cycle detection via DFS**; any back-edge **requires** a matching `loopFallback` entry or validation throws (`scheduler.ts:43-127`).
- `run()` (`scheduler.ts:338`) walks the DAG in parallel batches: dispatches `start` nodes, follows edges by returned action, **fan-in waits for all predecessor edges** before dispatching a target (`docs/API.md:12-21`). `computeFrontier()` (`scheduler.ts:158`) picks the next runnable set.
- Loop-back is bounded: `maxIter = fallbackEntry?.maxIterations ?? graph.maxIterations ?? 3`; on exhaustion it routes to `fallbackTarget` (`scheduler.ts:656-699`).

### 3.3 Node types
| Factory | File | Behavior |
|---|---|---|
| `agent(config)` | `src/agent.ts:139` | Full LLM session lifecycle: delete stale artifact → `setup` hook → build prompt → `runtime.createSession()` (default model `'claude-opus-4.6'`, `agent.ts:177`) → stream `text`/`tool_*`/`reasoning` into `emitOutput` → send → await idle/error → read artifact → `teardown`. Has **GT-3 dual-condition crash recovery**: an errored session still counts as success if a completion indicator was seen AND the artifact exists with content (`docs/API.md`). |
| `deterministic(id, fn)` | `src/nodes.ts:38` | Pure async function, no LLM (parsing, validation, API/HTTP calls, git). |
| `gate(name?)` | `src/nodes.ts:94` | **Pauses** execution until a human resolves it via `bridge.approveGate(...)`. The human-in-the-loop primitive. |
| `verify(config)` | `src/verify.ts:91` | Wraps a producer NodeFn in a **check loop**: run producer → run all `VerifyCheck`s → if any fail, inject `RetryContext` feedback and retry, up to `maxIterations` (default 3) → return `{ action:'fail' }` if never passing (`verify.ts:1-38`). `property(name, predicate, msg)` is the convenience check factory (`verify.ts:91`). |

### 3.4 State / event-sourcing (`state/`)
- **17 execution event types** (`src/events.ts:35-172`): `run:started/completed/resumed`, `node:started/completed/failed/killed/skipped/gated/retrying/reset`, `gate:resolved`, `edge:traversed`, `artifact:written`, `cost:recorded`, `metadata`. Plus streaming output events (`node:output/tool/reasoning/intent/usage/subagent/permission`).
- **Pure reducer** recomputes the `ExecutionProjection` (materialized view the UI serves) from the event log — the state layer is event-sourced, not mutable.
- **`FileStorage`** (`state/storage.ts`) persists `{execId}/events.jsonl` (append-only), `{execId}/projection.json` (atomic tmp-then-rename write), and per-node `output/{nodeId}.log`. `MemoryStorage` is the in-memory variant. Crash recovery = replay the JSONL log.

### 3.5 Bridge (`bridge/bridge.ts:35-45`) — the operator API
```ts
interface BridgeApi {
  launch(params): Promise<string>;
  stop(executionId): Promise<void>;
  resume(executionId, graph): Promise<{ resumingFrom: string[] } | null>;
  retryNode(executionId, nodeId, graph, override?): Promise<void>;
  skipNode(executionId, nodeId): Promise<void>;
  approveGate(executionId, nodeId, resolution, reason?): Promise<void>;
  getExecution / listExecutions / isRunning
}
```
`bridge/sse.ts` streams events to the UI. This is the surface an app or CI harness drives.

---

## 4. LLM and GitHub integration (the load-bearing findings)

**The runtime is fully pluggable via one interface** (`src/types.ts:140-144`):
```ts
interface AgentRuntime {
  createSession(config: SessionConfig): Promise<AgentSession>;
  isAvailable(): Promise<boolean>;
  readonly name: string;
}
```
`SessionConfig` carries `{ model, thinkingBudget?, cwd, addDirs, timeout, heartbeatTimeout, systemMessage?, availableTools?, excludedTools? }` (`types.ts:148-161`). `AgentSession` is **agent-harness-shaped**: `send(prompt)` plus event streams `text` / `tool_start` / `tool_complete` / `reasoning` / `idle` / `error`, and rich SdkBackend-only events `usage` / `subagent_start|end` / `permission` / `compaction` (`types.ts:163-183`). This is a *coding-agent* contract (streaming tools + reasoning + subagents), not a bare chat-completions contract.

**Built-in backends** (`runtimes/copilot/`):
- **`SubprocessBackend`** — spawns the local `copilot` CLI via `child_process.spawn`. The command factory builds `copilot --model <model> --output-format json --allow-all --no-ask-user --autopilot --experimental --no-alt-screen [--add-dir ...] [--additional-mcp-config <json>] [--config-dir ...]` (`subprocess-backend.ts:95-152`). Binary resolution: `COPILOT_PATH` env → WinGet Links (Windows) → bare `copilot` on PATH (`subprocess-backend.ts:65-88`). **Supports MCP servers** via `--additional-mcp-config` and auto-discovery of `.copilot/mcp.json` (`subprocess-backend.ts:54-149`).
- **`SdkBackend`** — dynamically imports `@github/copilot-sdk`'s `CopilotClient` over JSON-RPC/stdio; a drop-in for the subprocess backend that also fires the rich events (`sdk-backend.ts:2-6,183-227`).
- **`MockRuntime`** (`runtimes/mock/`) — deterministic, used by all pipeline tests.

**Critical integration fact — condukt runs on Copilot, not GitHub Models:**
- Both real backends route inference through the **GitHub Copilot CLI/SDK**. The `SdkBackend` creates `new CopilotClient({ useStdio: true })` (`sdk-backend.ts:333`), which itself drives a `copilot` CLI process over JSON-RPC/stdio — so **there is no direct HTTP model call anywhere** in condukt.
- **condukt reads no token itself and has zero auth logic.** It forwards the ambient environment (`{ ...process.env }`, `subprocess-backend.ts:233`, `sdk-backend.ts:310`) to the spawned CLI and delegates 100% of authentication to the pre-authenticated `copilot` CLI. The only Copilot env var it touches is `COPILOT_PATH` (a binary-path override, `subprocess-backend.ts:70`), not a credential. Whatever Copilot login/token the CLI needs must already exist in the environment.
- Per this project's own empirical `docs/research/copilot-sdk-on-runners.md`, the Copilot CLI **requires a seat-bearing *user* token** (`gho_`/`ghu_`/fine-grained PAT with "Copilot Requests"); the keyless workflow `GITHUB_TOKEN` (`ghs_`) is **rejected**. So a condukt agent step needs a provisioned Copilot secret + an active seat, and each call **bills premium-request credits**.
- condukt has **no GitHub Models backend** — nothing points at `https://models.github.ai`, and there is no keyless-`GITHUB_TOKEN` inference path (verified: `rg 'models.github|models: read'` returns no runtime hits). If you want the zero-secret GitHub Models path documented in `github-models-on-runners.md`, you must **write a new `AgentRuntime`** (the interface is designed exactly for this).
- **No GitHub Actions workflow in condukt does inference.** `.github/workflows/ci.yml` runs only `npm run typecheck` and `npm test` on Node 22; `publish.yml` handles npm release. condukt is a **library you embed**, not a CI action.

---

## 5. Extensibility seams

The framework is a set of interfaces, so integration is first-class:
1. **New LLM backend** — implement `AgentRuntime` (`types.ts:140`). This is the intended seam for a **GitHub Models runtime**, an OpenAI/Anthropic runtime, or anything OpenAI-compatible. The `SessionConfig`/`AgentSession` event contract is the only thing to satisfy.
2. **New pipeline stage** — author a `NodeFn` and register it as a `NodeEntry`. Use `agent()` for LLM work (with `setup`/`teardown`/`promptBuilder`/`actionParser`/`completionIndicators` hooks, `types.ts:196-219`), `deterministic()` for pure logic (git commit, PR open, HTTP calls, file writes), `gate()` for human approval, `verify()` for a self-correcting check loop.
3. **Human-in-the-loop** — `gate` node + `bridge.approveGate()`. Resolutions are arbitrary strings routed as edge actions (e.g. `approved`/`rejected`).
4. **Quality gate with retries** — `verify()` + `property()` checks; a check that re-fetches a cited URL and rejects unsupported sentences is a natural fit.
5. **UI extension** — `renderToolExpanded` callback + 50+ built-in tool formatters (`condukt/ui/tool-display`); `condukt/theme` Tailwind preset.
6. **Wiring into external systems** — deterministic nodes are the seam for a git/PR publish step or a research-tool call; a custom runtime is the seam for a different model provider; gate callbacks are the seam for external approval systems.

**Public exports (12 sub-paths, `package.json:22-96`):** `condukt` (core), `/state`, `/state/server` (FileStorage, Node-only), `/bridge`, `/runtimes/copilot`, `/runtimes/mock`, `/ui`, `/ui/core`, `/ui/graph`, `/ui/tool-display`, `/theme`, `/utils`.

---

## 6. Maturity assessment (honest)

**Strong:**
- Published npm package at v0.6.17, MIT, clean manifest with granular exports and optional peer deps.
- **No `TODO`/`FIXME`/`HACK`/`XXX`** anywhere in source, **zero `any` types** in `src/` — deferred items are tracked externally in `docs/HANDOFF.md`, not inline. Readonly interfaces, discriminated unions throughout.
- CI runs typecheck + test on every push (`ci.yml`); a `publish.yml` release workflow does typecheck+test+build then `npm publish --provenance` via OIDC. **20 versions published** on npm (`0.1.0` Mar 2026 → `0.6.19` latest), so the release path is real and active.
- Real end-to-end pipeline test through the bridge: `__tests__/e2e-dip-pipeline.test.ts` builds a 7-node fan-out→fan-in→convergence-loop-back(`maxIterations:3`)→gate graph and runs it against a **real** `StateRuntime`+`MemoryStorage`+tmpdir, asserting execution order, iteration counts, on-disk artifact contents, and `node:reset` event counts — a genuine e2e of the **framework** (only the `AgentRuntime` is mocked, so no live LLM).
- Extensive design docs in `docs/` (ARCHITECTURE, API, COMPOSITION_GUIDE, plus DESIGN/PHILOSOPHY/IMPLEMENTATION/PLAN sets for fan-out-loop-back, output rendering, reasoning artifacts, shortcomings).

**Caveats / gaps:**
- **The runtime layer (real LLM backends) is the least-tested subsystem.** The pipeline/e2e tests mock the `AgentRuntime`, so the live Copilot CLI/SDK path is never exercised end-to-end. Worse, `subprocess-jsonl.test.ts` tests a **copy-pasted mirror** of the parser (admitted in its header), not the shipped `subprocess-backend.ts` — so no test hits a real subprocess or real SDK.
- **One documented-but-unbuilt subsystem, self-flagged as a pre-production blocker.** `docs/adr/ADR-005-graph-registry.md` + `docs/HANDOFF.md:88` describe a `GraphRegistry` as "accepted, not yet implemented" and "before first production deployment"; **zero code exists** for it. A planned `ShellRuntime` (`HANDOFF.md:86`) is likewise unbuilt.
- **Docs carry count-drift.** `docs/API.md:3` says "six sub-path exports" (there are 12); `src/events.ts` comment says 15 events (the union has 16/17); `API.md`/`ARCHITECTURE.md` undercount output events. Prose is mostly true-to-code but out of sync as features accrete.
- **CI never builds or smoke-tests the package on PRs** — only `typecheck` + `test` (Node 22 only, no lint, no coverage gate, no Node matrix, no export-resolution check). `dist/` and sub-path exports are only exercised in the publish job.
- **No CLI, no bundled server** — you assemble the bridge + an HTTP layer + the UI host yourself. There is no turnkey "run this pipeline" binary.
- **Docs are dense and design-heavy** — good for understanding intent, but there is more architecture-narrative than task-oriented "how do I ship X" recipe (beyond the CI/CD example).
- Single-author, single-repo, HEAD ~4 months old relative to this brief's date; healthy but not a large-community project.

**Verdict:** a **real, actively-shipped, disciplined pre-1.0 framework** — well past prototype, genuine large test suite (659 verifies), unusually clean code (zero `any`, zero inline TODOs, provenance-published), and honest self-documentation of its own gaps. But it is a **single-developer framework extracted from one downstream app** (`taco-helper`, per `CLAUDE.md`), the runtime layer is the least-tested part, CI never builds/smoke-tests on PRs, and it carries one documented-but-unbuilt subsystem its own `HANDOFF.md` calls a pre-production blocker. Accurately "early production **candidate**," not "production-hardened." The abstractions (event-sourced state, pluggable runtime, four node types, bounded loops) are exactly right for an agent pipeline.

---

## 7. How condukt fits the autonomous blogging pipeline

Recall the recommended pipeline (from `docs/research/autonomous-blogging-pipeline.md`): **topic → deep research → citation-grounded fact-check → write (human voice) → self-review/voice-editor → cross-review + quality gate → PR-merge publish**, orchestrated by a stateful, resumable, human-gated engine, running in CI on GitHub Models or Copilot.

**What role does condukt own? The orchestration spine — the engine that ties the stages together — NOT the content logic and NOT the publish surface.** It is a **credible domestic alternative to LangGraph** for this project's specific stack, because every one of the pipeline's four load-bearing orchestration requirements maps to a first-class condukt primitive:

| Pipeline requirement | condukt primitive | Status |
|---|---|---|
| Stateful + **resumable** | event-sourced JSONL log + `bridge.resume()` / `retryNode()` | **Already there** |
| **Human approval gate** | `gate()` node + `bridge.approveGate()` (durable — pause is a persisted event) | **Already there** |
| **Cyclic** draft→critique→revise loops | bounded `loopFallback` + `verify()` check-loop with feedback injection | **Already there** |
| Distinct critic/writer roles on **different models** | per-node `model` field; `agent()` sets `SessionConfig.model` per node | **Already there** |
| Live **observability** of a long run | 17 event types + React `FlowGraph`/`NodePanel` UI + SSE | **Already there (richer than LangGraph's default)** |

**Stage-by-stage map (build-vs-already-there):**

| Pipeline stage | condukt provides | You still build/wire |
|---|---|---|
| 1. Topic intake | `params` on `launch()`; a `deterministic` node | Trigger (issue/dispatch) + param shaping |
| 2. Deep research | an `agent()` node (Copilot agent can browse/search via MCP tools) | The research **logic/prompt**, or a `deterministic` node calling GPT-Researcher/STORM; a **web-search MCP** or tool wiring |
| 3. Fact-check | `verify()` loop + `property()` checks; a `deterministic` re-fetch node | The **entire fact-check algorithm** (FActScore decompose + CoVe independent verify + schema-enforced source_url). condukt gives the retry-until-pass *shape*, not the verifier |
| 4. Write (voice) | `agent()` node with `systemMessage`/persona prompt, per-node `model` | The persona/style guide + specifics injection |
| 5. Self-review / voice editor | `verify()` or an `agent()`→`gate()` loop | The editor prompt + quality thresholds |
| 6. Cross-review + quality gate | `agent()` on a **different `model`** + `verify()` gate that blocks the publish edge | The judge rubric; the "different-model" selection |
| 7. PR-merge publish | a `deterministic()` node shelling `git`/`gh`/`peter-evans/create-pull-request`; final `gate()` = the PR review | The publish node itself (commit MD + open PR); the SSG/site |
| Runtime home (CI) | — | condukt is a **library**, so you write the GitHub Actions job that hosts it |
| Inference | Copilot backend (seat token, premium credits) | **A GitHub Models `AgentRuntime`** if you want the keyless-`GITHUB_TOKEN` path |

**Already provided by condukt (no build):** the DAG scheduler, fan-out/fan-in, bounded loop-back, event-sourced durable state + crash recovery, resume/retry/skip, human gates, per-node model selection, verify-with-feedback loops, and the whole visualization UI. **This is the "spine" the blogging brief said had to be assembled** — condukt is that spine, in-house and in TypeScript.

**Still to build/wire (condukt gives the shape, not the content):** every stage's *actual logic* (research, the fact-check verifier, the voice editor, the cross-review rubric, the git-PR publish node), the **CI host job** that runs the library on a runner, and — the one real stack **mismatch** — a **GitHub Models runtime**, because condukt ships only a Copilot backend.

**Mismatches / decisions to flag vs the recommended stack:**
1. **Inference provider.** The blogging brief's default is **GitHub Models** (keyless `GITHUB_TOKEN` + `models: read`, zero secret, gpt-5/o3-class). condukt ships **only Copilot** (seat token, premium credits, but agentic + MCP tools). Either write a GitHub Models `AgentRuntime` (small, the interface is built for it) or accept Copilot's seat/credit model. This is the single biggest wiring decision.
2. **Orchestrator choice.** condukt vs LangGraph. condukt wins on being in-house, TypeScript-native, and shipping a purpose-built UI + Copilot-agent runtime; LangGraph wins on ecosystem, Python research-tool integration (GPT-Researcher's `multi_agents/` is already a LangGraph graph), and battle-tested checkpointers. If the research stage reuses GPT-Researcher/STORM (Python), a condukt spine means calling them out-of-process from `deterministic` nodes rather than composing in-graph.
3. **Language split.** condukt is TypeScript; most recommended research/fact-check OSS (GPT-Researcher, STORM, FActScore) is Python. A condukt-centered design runs those as subprocess/HTTP calls from deterministic nodes — clean, but a process boundary the LangGraph path wouldn't have.
4. **It is a library, not a runner.** condukt has no CLI/server; you own the CI job and (if you want a dashboard) the HTTP host for the UI. That is real integration work, not a config file.

**Bottom line — the "final piece" verdict:** condukt is **the orchestration engine/runtime spine**, and a strong, self-authored one. It already *is* the stateful, resumable, human-gated, loop-capable, observable graph executor the pipeline needs — the part the blogging brief flagged as "assemble it yourself." It does **not** own the content stages (research, fact-check, voice, cross-review logic) or the publish surface (Astro/MDX site, PR flow) — those become nodes you author on top of it — and it needs a **GitHub Models runtime** written to match this project's preferred keyless inference path. Framed against the brief: condukt is the **LangGraph-equivalent spine**, not a stage.

---

## 8. Open questions / decisions for the user

1. **Orchestrator: condukt or LangGraph?** condukt is yours, TypeScript, UI-rich, Copilot-agentic; LangGraph is Python-native with the existing GPT-Researcher `multi_agents/` skeleton and mature checkpointers. Picking condukt means a TS spine calling Python research tools out-of-process.
2. **Inference: write a GitHub Models `AgentRuntime`, or run on Copilot?** GitHub Models = keyless `GITHUB_TOKEN`, zero secret, cheap plain inference; Copilot (what condukt ships) = seat token + premium credits but agentic (tools/MCP/subagents). The `AgentRuntime` interface makes a Models backend a bounded, well-scoped build.
3. **Maturity check before betting the pipeline on it:** condukt is pre-1.0, single-developer, extracted from one downstream app. The **runtime layer (real LLM backends) is its least-tested subsystem** — pipeline tests mock the runtime, and a planned `GraphRegistry` its own `HANDOFF.md` calls a "before-first-production-deployment" blocker is documented-but-unbuilt. The framework core is solidly tested (659 real tests); the model-integration edge is where to expect rough edges.

---

## Sources

All `path:line` references are within the clone at `C:/Users/anikundu/AppData/Local/Temp/condukt-explore` @ `1aab6af`. Key files: `README.md`, `package.json`, `CLAUDE.md`, `src/types.ts`, `src/scheduler.ts`, `src/agent.ts`, `src/nodes.ts`, `src/verify.ts`, `src/events.ts`, `state/storage.ts`, `bridge/bridge.ts`, `runtimes/copilot/{copilot-backend,subprocess-backend,sdk-backend}.ts`, `examples/counter-test/cicd.ts`, `.github/workflows/ci.yml`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/COMPOSITION_GUIDE.md`. Cross-referenced against this project's `docs/research/autonomous-blogging-pipeline.md`, `copilot-sdk-on-runners.md`, and `github-models-on-runners.md`.
