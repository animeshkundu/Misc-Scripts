import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type { SessionConfig as CopilotSdkSessionConfig } from '@github/copilot-sdk';
import type {
  AgentConfig,
  AgentRuntime,
  ExecutionEvent,
  ExecutionProjection,
  FlowGraph,
  NodeEntry,
  OutputEvent,
} from 'condukt';

const require = createRequire(import.meta.url);
const { agent } = require('condukt') as typeof import('condukt');
const { createBridge } = require('condukt/bridge') as typeof import('condukt/bridge');
const { StateRuntime } = require('condukt/state') as typeof import('condukt/state');
const { FileStorage } = require('condukt/state/server') as typeof import('condukt/state/server');
const { SdkBackend, adaptCopilotBackend } = require('condukt/runtimes/copilot') as typeof import('condukt/runtimes/copilot');

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'crashed', 'stopped']);
const spikeDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(spikeDir, '../..');
const runRoot = path.join(spikeDir, 'run-output');
const mcpConfigPath = path.join(os.tmpdir(), `condukt-sdk-spike-mcp-${process.pid}.json`);
const observedOutputEvents: OutputEvent[] = [];

type InstrumentedClientFields = {
  connectionConfig?: { kind?: string };
  resolvedCliPath?: string;
  options?: { useLoggedInUser?: boolean; gitHubToken?: string; logLevel?: string; mode?: string };
};

type WebNodeVerification = {
  toolFired: boolean;
  artifactUrlCount: number;
  outputUrlCount: number;
  blockedMessageSeen: boolean;
};

type MainVerification = {
  executionId: string;
  status: string;
  helloOk: boolean;
  modelOk: boolean;
  strictWebSearch: WebNodeVerification;
  qualifiedWebSearch: WebNodeVerification;
  openWebSearch: WebNodeVerification;
  searchOk: boolean;
};

type MaxVerification = {
  executionId: string;
  status: string;
  artifact: string | null;
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'string') {
        return val.length > 1800 ? `${val.slice(0, 1800)}...[truncated ${val.length - 1800} chars]` : val;
      }
      return val;
    });
  } catch (err) {
    return JSON.stringify({ stringifyError: err instanceof Error ? err.message : String(err) });
  }
}

function safeLog(label: string, value: unknown): void {
  console.log(`${label} ${safeJson(value)}`);
}

function shellOut(command: string, args: string[] = []): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = e.stdout ? String(e.stdout).trim() : '';
    const stderr = e.stderr ? String(e.stderr).trim() : '';
    return [stdout, stderr, e.message].filter(Boolean).join('\n').trim();
  }
}

function packageVersion(packageName: string): string {
  try {
    let current = path.dirname(fileURLToPath(import.meta.resolve(packageName)));
    const root = path.parse(current).root;
    while (current && current !== root) {
      const packageJson = path.join(current, 'package.json');
      if (fs.existsSync(packageJson)) {
        const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { name?: string; version?: string };
        if (parsed.name === packageName && parsed.version) return parsed.version;
      }
      current = path.dirname(current);
    }
  } catch {
    // ignored; caller gets unknown
  }
  return 'unknown';
}

function logEnvironment(): void {
  const which = process.platform === 'win32' ? 'where' : 'which';
  console.log('=== ENVIRONMENT ===');
  safeLog('ENV', {
    cwd: process.cwd(),
    spikeDir,
    repoRoot,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    conduktVersion: packageVersion('condukt'),
    copilotSdkVersion: packageVersion('@github/copilot-sdk'),
    copilotPath: shellOut(which, ['copilot']),
    copilotVersion: shellOut('copilot', ['--version']),
    copilotGithubTokenPresent: Boolean(process.env.COPILOT_GITHUB_TOKEN),
    ghTokenPresent: Boolean(process.env.GH_TOKEN),
    githubTokenPresent: Boolean(process.env.GITHUB_TOKEN),
  });
}

function writeMcpConfig(): void {
  const token = process.env.COPILOT_GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    safeLog('[MCP_CONFIG]', { path: mcpConfigPath, written: false, reason: 'no token env present' });
    return;
  }

  const config = {
    mcpServers: {
      'github-mcp-server': {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/readonly',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2), 'utf8');
  safeLog('[MCP_CONFIG]', {
    path: mcpConfigPath,
    written: true,
    server: 'github-mcp-server',
    url: 'https://api.githubcopilot.com/mcp/readonly',
    authHeaderPresent: true,
  });
}

function installSdkInstrumentation(): void {
  const originalCreateSession = CopilotClient.prototype.createSession;
  let callIndex = 0;

  CopilotClient.prototype.createSession = async function instrumentedCreateSession(
    this: CopilotClient,
    config: CopilotSdkSessionConfig,
  ) {
    callIndex += 1;
    const id = callIndex;
    const clientFields = this as unknown as InstrumentedClientFields;
    const rawConfig = config as CopilotSdkSessionConfig & {
      configDir?: unknown;
      configDirectory?: unknown;
      mcpServers?: Record<string, unknown>;
    };
    if (rawConfig.configDir && !rawConfig.configDirectory) {
      rawConfig.configDirectory = String(rawConfig.configDir);
    }
    safeLog(`[SDK_CREATE_SESSION ${id}]`, {
      clientConnectionKind: clientFields.connectionConfig?.kind,
      clientUseStdio: clientFields.connectionConfig?.kind === 'stdio',
      clientResolvedCliPath: clientFields.resolvedCliPath,
      clientMode: clientFields.options?.mode,
      clientLogLevel: clientFields.options?.logLevel,
      clientUseLoggedInUser: clientFields.options?.useLoggedInUser,
      clientGitHubTokenOptionPresent: Boolean(clientFields.options?.gitHubToken),
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      availableTools: config.availableTools,
      excludedTools: config.excludedTools,
      workingDirectory: config.workingDirectory,
      configDir: rawConfig.configDir,
      configDirectory: rawConfig.configDirectory,
      mcpServers: rawConfig.mcpServers
        ? Object.fromEntries(
            Object.entries(rawConfig.mcpServers).map(([name, server]) => {
              const typed = server as { type?: unknown; url?: unknown; tools?: unknown; headers?: unknown };
              return [
                name,
                {
                  type: typed.type,
                  url: typed.url,
                  tools: typed.tools,
                  headerNames:
                    typed.headers && typeof typed.headers === 'object' ? Object.keys(typed.headers) : undefined,
                },
              ];
            }),
          )
        : undefined,
      streaming: config.streaming,
      hasPermissionHandler: Boolean(config.onPermissionRequest),
      systemMessageMode:
        typeof config.systemMessage === 'object' && config.systemMessage !== null
          ? 'mode' in config.systemMessage
            ? config.systemMessage.mode
            : 'append-default'
          : undefined,
      infiniteSessions: config.infiniteSessions,
    });

    try {
      const session = await originalCreateSession.call(this, config);
      safeLog(`[SDK_CREATE_SESSION_OK ${id}]`, {
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        capabilities: session.capabilities,
      });

      try {
        await session.rpc.tools.initializeAndValidate();
        const metadata = await session.rpc.tools.getCurrentMetadata();
        safeLog(`[SDK_TOOL_METADATA ${id}]`, {
          tools: metadata.tools?.map((tool) => ({
            name: tool.name,
            namespacedName: tool.namespacedName,
            mcpServerName: tool.mcpServerName,
            mcpToolName: tool.mcpToolName,
            deferLoading: tool.deferLoading,
          })),
        });
      } catch (err) {
        safeLog(`[SDK_TOOL_METADATA_ERROR ${id}]`, {
          name: err instanceof Error ? err.name : undefined,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      session.on((event) => {
        const data = 'data' in event ? event.data : undefined;
        if (
          event.type === 'assistant.usage' ||
          event.type === 'tool.execution_start' ||
          event.type === 'tool.execution_complete' ||
          event.type === 'tool.execution_partial_result' ||
          event.type === 'session.idle' ||
          event.type === 'session.task_complete' ||
          event.type === 'session.error' ||
          event.type === 'assistant.message' ||
          event.type === 'assistant.message_delta'
        ) {
          safeLog(`[SDK_EVENT ${id}]`, { type: event.type, data });
        }
      });

      return session;
    } catch (err) {
      safeLog(`[SDK_CREATE_SESSION_ERROR ${id}]`, {
        name: err instanceof Error ? err.name : undefined,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6).join('\n') : undefined,
      });
      throw err;
    }
  };
}

function truncate(value: string, limit = 1800): string {
  return value.length > limit ? `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]` : value;
}

function onStateEvent(event: ExecutionEvent): void {
  safeLog('[FLOW_EVENT]', event);
}

function onOutputEvent(event: OutputEvent): void {
  observedOutputEvents.push(event);

  if (event.type === 'node:output') {
    safeLog('[FLOW_OUTPUT]', {
      type: event.type,
      nodeId: event.nodeId,
      tool: event.tool,
      content: truncate(event.content),
    });
    return;
  }

  if (event.type === 'node:tool') {
    safeLog('[FLOW_TOOL]', {
      nodeId: event.nodeId,
      tool: event.tool,
      phase: event.phase,
      summary: truncate(event.summary ?? ''),
      args: event.args,
      toolCallId: event.toolCallId,
      parentToolCallId: event.parentToolCallId,
      toolSpecificData: event.toolSpecificData,
    });
    return;
  }

  safeLog('[FLOW_OUTPUT_EVENT]', event);
}

function makeAgentEntry(config: AgentConfig): NodeEntry {
  return {
    fn: agent(config),
    displayName: config.objective,
    nodeType: 'agent',
    output: config.output,
    reads: config.reads,
    model: config.model,
    timeout: config.timeout,
  };
}

function createRuntime(): AgentRuntime {
  const backend = new SdkBackend({ configDir: repoRoot, mcpConfigPath });
  const adapted = adaptCopilotBackend(backend);

  return {
    ...adapted,
    async createSession(config) {
      safeLog('[ADAPTER_FORWARD_CONFIG]', {
        model: config.model,
        thinkingBudget: config.thinkingBudget,
        availableTools: config.availableTools,
        excludedTools: config.excludedTools,
        systemMessagePresent: Boolean(config.systemMessage),
      });
      return (await backend.createSession({
        model: config.model,
        thinkingBudget: config.thinkingBudget,
        cwd: config.cwd,
        addDirs: config.addDirs,
        timeout: config.timeout,
        heartbeatTimeout: config.heartbeatTimeout,
        systemMessage: config.systemMessage,
        availableTools: config.availableTools,
        excludedTools: config.excludedTools,
      } as any)) as any;
    },
  };
}

function readArtifact(dir: string, name: string): string | null {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function parseJsonArrayArtifact(content: string | null): unknown[] | null {
  if (!content) return null;
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function countUrls(items: unknown[]): number {
  let count = 0;
  for (const item of items) {
    if (item && typeof item === 'object' && 'url' in item) {
      const url = String((item as { url?: unknown }).url ?? '');
      if (/^https?:\/\//.test(url)) count += 1;
    }
  }
  return count;
}

function countUrlsInText(text: string): number {
  return new Set(text.match(/https?:\/\/[^\s"'<>),]+/g) ?? []).size;
}

function verifyWebNode(executionId: string, nodeId: string, artifactContent: string | null): WebNodeVerification {
  const parsed = parseJsonArrayArtifact(artifactContent);
  const artifactUrlCount = parsed ? countUrls(parsed) : 0;
  const events = observedOutputEvents.filter((event) => event.executionId === executionId && event.nodeId === nodeId);
  const eventText = events.map((event) => safeJson(event)).join('\n');
  const toolFired = events.some(
    (event) =>
      event.type === 'node:tool' &&
      (event.tool === 'web_search' || event.tool === 'github-mcp-server-web_search') &&
      event.phase === 'start',
  );
  return {
    toolFired,
    artifactUrlCount,
    outputUrlCount: countUrlsInText(eventText),
    blockedMessageSeen: /Blocked|not available|Unknown tool|can't verify|cannot verify|can't use|cannot use/i.test(eventText),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExecution(
  bridge: ReturnType<typeof createBridge>,
  executionId: string,
  timeoutMs: number,
): Promise<ExecutionProjection> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';

  while (Date.now() < deadline) {
    const projection = bridge.getExecution(executionId);
    const status = projection?.status ?? 'pending/no-projection-yet';
    if (status !== lastStatus) {
      safeLog('[POLL_STATUS]', { executionId, status });
      lastStatus = status;
    }

    if (projection && TERMINAL_STATUSES.has(projection.status)) {
      return projection;
    }

    await sleep(2000);
  }

  const projection = bridge.getExecution(executionId);
  safeLog('[POLL_TIMEOUT_LAST_PROJECTION]', projection);
  if (bridge.isRunning(executionId)) {
    try {
      await bridge.stop(executionId);
    } catch (err) {
      safeLog('[POLL_TIMEOUT_STOP_ERROR]', err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`Timed out waiting for execution ${executionId}`);
}

function printNodeOutputs(state: InstanceType<typeof StateRuntime>, executionId: string, nodeIds: string[]): void {
  console.log('=== NODE OUTPUT LOGS ===');
  for (const nodeId of nodeIds) {
    const page = state.getNodeOutput(executionId, nodeId, 0, 1000);
    safeLog(`[NODE_OUTPUT_LOG ${nodeId}]`, page);
  }
}

function printArtifacts(dir: string, names: string[]): void {
  console.log('=== ARTIFACTS ===');
  for (const name of names) {
    const content = readArtifact(dir, name);
    safeLog(`[ARTIFACT ${name}]`, {
      exists: content !== null,
      raw: content === null ? null : content,
      trimmed: content === null ? null : content.trim(),
    });
  }
}

function printFlowFiles(dir: string): void {
  console.log('=== FLOW DATA FILES ===');
  const files: string[] = [];
  function walk(current: string): void {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(dir, full));
    }
  }
  walk(path.join(dir, '.flow-data'));
  safeLog('[FLOW_DATA_FILE_LIST]', files);
}

function mainGraph(): FlowGraph {
  return {
    nodes: {
      hello: makeAgentEntry({
        objective: 'hello node',
        tools: [],
        model: 'claude-opus-4.8',
        thinkingBudget: 'xhigh',
        output: 'hello.md',
        timeout: 420,
        heartbeatTimeout: 180,
        promptBuilder: () =>
          'Write the single word OK to hello.md in the current working directory and nothing else. The file must contain exactly OK and no Markdown fences.',
      }),
      modelEffort: makeAgentEntry({
        objective: 'model and effort node',
        tools: [],
        model: 'gpt-5.5',
        thinkingBudget: 'high',
        output: 'model.md',
        timeout: 420,
        heartbeatTimeout: 180,
        promptBuilder: () =>
          'Write the single word MODEL_OK to model.md in the current working directory and nothing else. The file must contain exactly MODEL_OK and no Markdown fences.',
      }),
      strictWebSearch: makeAgentEntry({
        objective: 'strict web_search allow-list node',
        tools: [],
        model: 'gpt-5.5',
        availableTools: ['web_search'],
        output: 'strict-search.md',
        timeout: 600,
        heartbeatTimeout: 240,
        promptBuilder: () =>
          'Call the web_search tool with query "current top story BBC News". Then write a JSON array of objects with keys title and url to strict-search.md in the current working directory. Also print the same JSON array in your final response. Do not use web_fetch. The file content must be valid JSON only, no Markdown fences. Use absolute http(s) URLs.',
      }),
      qualifiedWebSearch: makeAgentEntry({
        objective: 'qualified web_search allow-list node',
        tools: [],
        model: 'gpt-5.5',
        availableTools: [
          'web_search',
          'github-mcp-server-web_search',
          'github-mcp-server/web_search',
          'mcp:web_search',
          'mcp:github-mcp-server-web_search',
          'bash',
          'apply_patch',
          'create',
          'task_complete',
        ],
        output: 'qualified-search.md',
        timeout: 600,
        heartbeatTimeout: 240,
        promptBuilder: () =>
          'Call the web_search tool with query "current top story BBC News". Then write a JSON array of objects with keys title and url to qualified-search.md in the current working directory. Also print the same JSON array in your final response. Do not use web_fetch. The file content must be valid JSON only, no Markdown fences. Use absolute http(s) URLs.',
      }),
      openWebSearch: makeAgentEntry({
        objective: 'open web_search node',
        tools: [],
        model: 'gpt-5.5',
        output: 'open-search.md',
        timeout: 600,
        heartbeatTimeout: 240,
        promptBuilder: () =>
          'Call the web_search tool with query "current top story BBC News". Then write a JSON array of objects with keys title and url to open-search.md in the current working directory. Also print the same JSON array in your final response. Do not use web_fetch. The file content must be valid JSON only, no Markdown fences. Use absolute http(s) URLs.',
      }),
    },
    edges: {},
    start: ['hello', 'modelEffort', 'strictWebSearch', 'qualifiedWebSearch', 'openWebSearch'],
  };
}

function maxGraph(): FlowGraph {
  return {
    nodes: {
      maxEffort: makeAgentEntry({
        objective: 'max effort probe',
        tools: [],
        model: 'claude-opus-4.6',
        thinkingBudget: 'max' as any,
        output: 'max.md',
        timeout: 420,
        heartbeatTimeout: 180,
        promptBuilder: () =>
          'Write the single word MAX_OK to max.md in the current working directory and nothing else. The file must contain exactly MAX_OK and no Markdown fences.',
      }),
    },
    edges: {
      maxEffort: { default: 'end' },
    },
    start: ['maxEffort'],
  };
}

async function runMainGraph(): Promise<MainVerification> {
  const executionId = `condukt-sdk-main-${Date.now()}`;
  const dir = path.join(runRoot, 'main');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const state = new StateRuntime(new FileStorage(path.join(dir, '.flow-data')), onStateEvent, onOutputEvent);
  const bridge = createBridge(createRuntime(), state);

  console.log('=== LAUNCH MAIN GRAPH ===');
  safeLog('[GRAPH_SHAPE]', {
    nodes: Object.keys(mainGraph().nodes),
    edges: mainGraph().edges,
    start: mainGraph().start,
    dir,
  });
  await bridge.launch({ executionId, graph: mainGraph(), dir, params: { spike: 'condukt-sdk-main' } });
  const projection = await waitForExecution(bridge, executionId, 30 * 60 * 1000);

  safeLog('[FINAL_PROJECTION main]', projection);
  printNodeOutputs(state, executionId, ['hello', 'modelEffort', 'strictWebSearch', 'qualifiedWebSearch', 'openWebSearch']);
  printArtifacts(dir, ['hello.md', 'model.md', 'strict-search.md', 'qualified-search.md', 'open-search.md']);
  printFlowFiles(dir);

  const hello = readArtifact(dir, 'hello.md');
  const model = readArtifact(dir, 'model.md');
  const strictWebSearch = verifyWebNode(executionId, 'strictWebSearch', readArtifact(dir, 'strict-search.md'));
  const qualifiedWebSearch = verifyWebNode(
    executionId,
    'qualifiedWebSearch',
    readArtifact(dir, 'qualified-search.md'),
  );
  const openWebSearch = verifyWebNode(executionId, 'openWebSearch', readArtifact(dir, 'open-search.md'));
  const searchOk = [strictWebSearch, qualifiedWebSearch, openWebSearch].some(
    (node) => node.toolFired && (node.artifactUrlCount > 0 || node.outputUrlCount > 0),
  );

  const verification = {
    executionId,
    status: projection.status,
    helloOk: hello?.trim() === 'OK',
    modelOk: model?.trim() === 'MODEL_OK',
    strictWebSearch,
    qualifiedWebSearch,
    openWebSearch,
    searchOk,
  };
  safeLog('[MAIN_VERIFICATION]', verification);
  return verification;
}

async function runMaxGraph(): Promise<MaxVerification> {
  const executionId = `condukt-sdk-max-${Date.now()}`;
  const dir = path.join(runRoot, 'max');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const state = new StateRuntime(new FileStorage(path.join(dir, '.flow-data')), onStateEvent, onOutputEvent);
  const bridge = createBridge(createRuntime(), state);

  console.log('=== LAUNCH MAX EFFORT GRAPH ===');
  safeLog('[GRAPH_SHAPE max]', {
    nodes: Object.keys(maxGraph().nodes),
    edges: maxGraph().edges,
    start: maxGraph().start,
    dir,
  });
  await bridge.launch({ executionId, graph: maxGraph(), dir, params: { spike: 'condukt-sdk-max' } });
  const projection = await waitForExecution(bridge, executionId, 15 * 60 * 1000);

  safeLog('[FINAL_PROJECTION max]', projection);
  printNodeOutputs(state, executionId, ['maxEffort']);
  printArtifacts(dir, ['max.md']);
  printFlowFiles(dir);

  const artifact = readArtifact(dir, 'max.md');
  const verification = { executionId, status: projection.status, artifact };
  safeLog('[MAX_VERIFICATION]', verification);
  return verification;
}

async function directMaxCreateSessionSmoke(): Promise<void> {
  console.log('=== DIRECT SDK MAX CREATESESSION SMOKE ===');
  const token = process.env.COPILOT_GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const client = new CopilotClient({
    gitHubToken: token,
    useLoggedInUser: false,
    logLevel: 'warning',
  });
  try {
    const session = await client.createSession({
      model: 'claude-opus-4.6',
      reasoningEffort: 'max' as any,
      streaming: true,
      onPermissionRequest: approveAll,
      workingDirectory: path.join(runRoot, 'direct-max'),
    });
    safeLog('[DIRECT_MAX_SESSION_CREATED]', { sessionId: session.sessionId, capabilities: session.capabilities });
    await session.disconnect();
  } catch (err) {
    safeLog('[DIRECT_MAX_ERROR]', {
      name: err instanceof Error ? err.name : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    const errors = await client.stop().catch((err) => [err instanceof Error ? err : new Error(String(err))]);
    safeLog('[DIRECT_MAX_CLIENT_STOP]', { errors: errors.map((err) => err.message) });
  }
}

async function run(): Promise<void> {
  installSdkInstrumentation();
  logEnvironment();
  writeMcpConfig();

  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });
  fs.mkdirSync(path.join(runRoot, 'direct-max'), { recursive: true });

  const main = await runMainGraph();
  const max = await runMaxGraph();
  await directMaxCreateSessionSmoke();

  safeLog('[OVERALL_VERIFICATION]', { main, max });

  if (main.status !== 'completed' || !main.helloOk || !main.modelOk) {
    throw new Error(`Main graph core verification failed: ${safeJson(main)}`);
  }

  if (!main.searchOk) {
    safeLog('[WEB_SEARCH_DIAGNOSTIC_NOT_PASSING]', {
      note: 'Core SdkBackend agent execution passed, but no SDK web_search tool call produced URL evidence.',
      main,
    });
  }
}

run().catch((err) => {
  safeLog('[FATAL]', {
    name: err instanceof Error ? err.name : undefined,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exitCode = 1;
});
