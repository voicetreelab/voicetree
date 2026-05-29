import {mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {configureMcpServer} from '../packages/systems/voicetree-mcp/src/config/mcp-config'
import {spawnAgentTool} from '../packages/systems/voicetree-mcp/src/tools/agent-control/spawnAgentTool'
import {closeAgentTool} from '../packages/systems/voicetree-mcp/src/tools/agent-control/closeAgentTool'
import {
  spawnTmuxBackedTerminal,
  reconcileTmuxHeadlessAgents,
  removeTmuxHeadlessAgentState,
} from '../packages/systems/agent-runtime/src/application/headless/tmuxHeadlessRuntime'
import {applyPromptFileToHeadlessSpawn} from '../packages/systems/agent-runtime/src/application/headless/tmuxPromptFile'
import {createTerminalData} from '../packages/systems/agent-runtime/src/application/terminals/terminal-registry/types'
import type {TerminalRecord} from '../packages/systems/agent-runtime/src/application/terminals/terminal-registry-state'

const root = mkdtempSync(join(tmpdir(), 'phase6-debug-'))
const vaultPath = join(root, 'vault')
mkdirSync(vaultPath, {recursive: true})

const nodeId = join(vaultPath, 'task.md')
const callerId = 'phase6-debug-caller'
const terminalId = 'phase6-debug-agent'
const agentPrompt = '### FAKE_AGENT_SCRIPT ### {"actions":[{"type":"delay","ms":60000}]} ### END_FAKE_AGENT_SCRIPT ###'
const graph: any = {
  nodes: {
    [nodeId]: {
      absoluteFilePathIsID: nodeId,
      content: '# Phase 6 debug node\n',
      nodeUIMetadata: {
        additionalYAMLProps: new Map(),
        containedNodeIds: [],
        position: {x: 0, y: 0},
      },
      outgoingEdges: [],
      incomingEdges: [],
    },
  },
  nodeByBaseName: new Map(),
  edges: {},
}

function terminalRecord(id: string, isHeadless: boolean): TerminalRecord {
  return {
    terminalId: id,
    terminalData: createTerminalData({
      terminalId: id as any,
      attachedToNodeId: nodeId as any,
      terminalCount: 0,
      title: id,
      agentName: 'Fake Agent',
      agentTypeName: 'Fake Agent',
      isHeadless,
      parentTerminalId: null,
      initialEnvVars: {DEPTH_BUDGET: '1'},
    }),
    status: 'running',
    exitCode: null,
    exitSignal: null,
    killReason: null,
    auditRetryCount: 0,
    spawnedAt: Date.now(),
  }
}

function waitFor(label: string, predicate: () => boolean, timeoutMs = 10_000): void {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function tmuxHasSession(name: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', name], {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

configureMcpServer({
  graph: {
    getSnapshot: async () => ({
      graph,
      projectRoot: vaultPath,
      vaultPaths: [vaultPath],
      writeFolder: vaultPath,
    }),
    applyGraphDelta: async () => undefined,
  },
})

const callerRecord = terminalRecord(callerId, false)
const deps: any = {
  listTerminalRecords: () => [callerRecord],
  consumeBudget: () => ({allowed: true, childBudget: 0}),
  loadAgentSettings: async () => ({
    agents: [{name: 'Fake Agent', command: 'node -e "setInterval(()=>{},1000)"'}],
  }),
  loadSnapshot: async () => ({
    graph,
    projectRoot: vaultPath,
    vaultPaths: [vaultPath],
    writeFolder: vaultPath,
  }),
  applyDelta: async () => undefined,
  spawnTerminal: async (
    contextNodeId: string,
    command: string | undefined,
    _contextContent: string | undefined,
    _executeCommand: boolean,
    _pinned: boolean,
    _agentNameOverride: string | undefined,
    spawnDirectory: string | undefined,
    parentTerminalId: string | undefined,
    _promptTemplate: string | undefined,
    headless: boolean | undefined,
    _replaceTerminalId: string | undefined,
    envOverrides: Record<string, string>,
  ) => {
    const terminalData = createTerminalData({
      terminalId: terminalId as any,
      attachedToNodeId: contextNodeId as any,
      terminalCount: 1,
      title: terminalId,
      agentName: 'Fake Agent',
      agentTypeName: 'Fake Agent',
      isHeadless: headless ?? true,
      parentTerminalId: (parentTerminalId ?? callerId) as any,
      initialEnvVars: envOverrides,
      initialSpawnDirectory: spawnDirectory,
      initialCommand: command,
    })
    const env = {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        SHELL: process.env.SHELL ?? '/bin/bash',
        ...envOverrides,
        AGENT_PROMPT: agentPrompt,
        TASK_NODE_PATH: nodeId,
        VOICETREE_MCP_PORT: '1',
        VOICETREE_TERMINAL_ID: terminalId,
        VOICETREE_TMUX_NAMESPACE: vaultPath,
        VOICETREE_VAULT_PATH: vaultPath,
      }
    const plan = applyPromptFileToHeadlessSpawn({
      vaultPath,
      terminalId: terminalId as any,
      command: command ?? 'node -e "setInterval(()=>{},1000)"',
      env,
    })
    await spawnTmuxBackedTerminal(
      terminalId as any,
      terminalData,
      plan.command,
      spawnDirectory,
      plan.env,
      undefined as any,
      plan.promptFilePath,
    )
    return {terminalId, contextNodeId}
  },
  rememberChild: () => undefined,
  monitorChildren: () => undefined,
}

async function main(): Promise<void> {
  debugger
  const spawnResult = await spawnAgentTool({
    nodeId,
    callerTerminalId: callerId,
    agentName: 'Fake Agent',
    headless: true,
  }, deps)
  console.log(JSON.stringify({event: 'spawnResult', spawnResult}))

  const promptFile = join(vaultPath, '.voicetree', 'terminals', `${terminalId}-prompt.txt`)
  const metadataFile = join(vaultPath, '.voicetree', 'terminals', `${terminalId}.json`)
  waitFor('prompt file', () => existsSync(promptFile))
  waitFor('metadata file', () => existsSync(metadataFile))
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as {session: string}
  waitFor('tmux session', () => tmuxHasSession(metadata.session))

  const promptMode = statSync(promptFile).mode & 0o777
  console.log(JSON.stringify({
    event: 'spawned',
    spawnResult,
    promptFile,
    promptMode,
    promptMatches: readFileSync(promptFile, 'utf8') === agentPrompt,
    tmuxSession: metadata.session,
  }))

  removeTmuxHeadlessAgentState(terminalId as any)
  const reconcileResult = await reconcileTmuxHeadlessAgents(vaultPath)
  console.log(JSON.stringify({event: 'reconciled', reconcileResult}))

  const closeResult = await closeAgentTool({terminalId, callerTerminalId: terminalId})
  waitFor('tmux cleanup', () => !tmuxHasSession(metadata.session))
  waitFor('prompt cleanup', () => !existsSync(promptFile))
  console.log(JSON.stringify({
    event: 'closed',
    closeResult,
    promptExistsAfterClose: existsSync(promptFile),
    tmuxExistsAfterClose: tmuxHasSession(metadata.session),
  }))

  rmSync(root, {recursive: true, force: true})
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
