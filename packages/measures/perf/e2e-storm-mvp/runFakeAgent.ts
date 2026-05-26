/**
 * Spawn ONE vt-fake-agent through electron's `terminal:spawn` IPC.
 *
 * Why not plain child_process: vt-mcpd's `create_graph` tool requires the
 * caller's terminal to be registered in electron's `agent-runtime`
 * `TerminalRecord` registry. A test-process child_process call is invisible
 * to electron's runtime singleton; the agent will get
 * `Unknown caller terminal: <id>` and exit non-zero.
 *
 * Why not the existing agent-storm-perf-spec pattern (call
 * `agentRuntime.getTerminalManager().spawnTmuxBacked` from the test
 * process): same problem — the test-process agent-runtime is a separate
 * module instance from electron's. The parent agent observed this as the
 * "GraphModel not initialized" failure.
 *
 * Right answer: route the spawn through electron via Playwright's
 * `appWindow.evaluate(...)` → `window.electronAPI.terminal.spawn(td)`. That
 * triggers `ipcMain.handle('terminal:spawn')` in main, which calls
 * `terminalManager.spawnTmuxBacked()` on electron's runtime, registering
 * the TerminalRecord MCP needs.
 *
 * We then poll the agent registry for the terminal becoming `exited`. The
 * fake-agent's `exit` action calls process.exit, but the tmux session lives
 * on; lifecycle tracking is the canonical "is it done" signal.
 */
import type { Page } from '@playwright/test'
import type { FakeAgentScript } from '../../../../tools/vt-fake-agent/src/types.ts'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createTerminalData, type TerminalData, type TerminalId } from '@vt/agent-runtime/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

export interface FakeAgentInputs {
    readonly appWindow: Page
    readonly repoRoot: string
    readonly vaultDir: string
    readonly mcpPort: number
    readonly seedNodeAbsolutePath: string
    readonly terminalId: string
    readonly script: FakeAgentScript
    readonly timeoutMs: number
}

export interface FakeAgentResult {
    readonly spawnSuccess: boolean
    readonly spawnError: string | null
    readonly exitedCleanly: boolean
    readonly spawnWallMs: number
    readonly wallMs: number
    readonly timedOut: boolean
    readonly headlessOutput: string
}

function buildAgentPrompt(script: FakeAgentScript): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

function resolveFakeAgentEntrypoint(repoRoot: string): string {
    const entry = path.join(repoRoot, 'tools', 'vt-fake-agent', 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return entry
}

function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

export function buildMultiCreateNodeScript(agentIndex: number, nodeCount: number): FakeAgentScript {
    const nodes = Array.from({ length: nodeCount }, (_, nodeIndex) => {
        const title = `mvp-agent-${agentIndex}-node-${nodeIndex}`
        return {
            title,
            summary: `MVP storm node ${title}`,
            content: `Body of ${title} written by the e2e-storm-mvp harness.`,
        }
    })

    return {
        actions: [
            { type: 'create_nodes', nodes },
            { type: 'exit', code: 0 },
        ],
    }
}

/** Mark `__dirname` as referenced so noUnusedLocals stays happy under tsx. */
export const __sourceDir = __dirname

function buildTerminalData(inputs: FakeAgentInputs): TerminalData {
    const fakeAgentEntry = resolveFakeAgentEntrypoint(inputs.repoRoot)
    const fakeAgentDir = path.dirname(fakeAgentEntry)
    const tsxImportPath = resolveTsxImportPath()

    return createTerminalData({
        terminalId: inputs.terminalId as TerminalId,
        attachedToNodeId: inputs.seedNodeAbsolutePath,
        terminalCount: 0,
        title: inputs.terminalId,
        agentName: inputs.terminalId,
        isHeadless: true,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: inputs.terminalId,
            VOICETREE_MCP_PORT: String(inputs.mcpPort),
            VOICETREE_VAULT_PATH: inputs.vaultDir,
            TASK_NODE_PATH: path.join(inputs.vaultDir, `${inputs.terminalId}-task.md`),
            AGENT_PROMPT: buildAgentPrompt(inputs.script),
        },
        initialCommand: `${JSON.stringify(process.execPath)} --import ${JSON.stringify(tsxImportPath)} ${JSON.stringify(fakeAgentEntry)}; exit`,
        executeCommand: true,
        initialSpawnDirectory: fakeAgentDir,
    })
}

/**
 * Wait for the fake-agent to reach its `exit` action via the ring-buffered
 * headless output. The executor emits `[fake-agent] Executing: <type>` for
 * every action BEFORE running it (vt-fake-agent/src/executor.ts:39); the
 * `exit` action then calls `process.exit(0)` so no further line is ever
 * printed. So `Executing: exit` is the last-line-emitted completion marker
 * for our create-node script.
 *
 * Using `Script complete.` would never match — the agent exits before that
 * log line is reached.
 */
async function pollForScriptComplete(
    appWindow: Page,
    terminalId: string,
    timeoutMs: number,
    intervalMs: number,
): Promise<{ scriptCompleted: boolean; output: string }> {
    const deadline = Date.now() + timeoutMs
    let lastOutput = ''
    while (Date.now() < deadline) {
        lastOutput = await appWindow.evaluate(async (id) => {
            const api = (window as unknown as {
                electronAPI?: { main?: { getHeadlessAgentOutput?: (id: string) => Promise<string> } }
            }).electronAPI?.main
            return (await api?.getHeadlessAgentOutput?.(id)) ?? ''
        }, terminalId)

        if (lastOutput.includes('[fake-agent] Executing: exit')) {
            return { scriptCompleted: true, output: lastOutput }
        }
        if (lastOutput.includes('[fake-agent] Fatal')) {
            return { scriptCompleted: false, output: lastOutput }
        }
        await new Promise(r => setTimeout(r, intervalMs))
    }
    return { scriptCompleted: false, output: lastOutput }
}

export async function runFakeAgent(inputs: FakeAgentInputs): Promise<FakeAgentResult> {
    const td = buildTerminalData(inputs)

    const wallStart = Date.now()
    const spawnStart = Date.now()
    const spawnResult = await inputs.appWindow.evaluate(async (terminalData) => {
        const api = (window as unknown as {
            electronAPI?: {
                terminal?: {
                    spawn?: (td: unknown) => Promise<{ success: boolean; terminalId?: string; error?: string }>
                }
            }
        }).electronAPI?.terminal
        if (!api?.spawn) return { success: false, error: 'window.electronAPI.terminal.spawn unavailable' }
        return api.spawn(terminalData)
    }, td as unknown as Parameters<Page['evaluate']>[1])
    const spawnWallMs = Date.now() - spawnStart

    if (!spawnResult.success) {
        return {
            spawnSuccess: false,
            spawnError: spawnResult.error ?? 'unknown spawn error',
            exitedCleanly: false,
            spawnWallMs,
            wallMs: Date.now() - wallStart,
            timedOut: false,
            headlessOutput: '',
        }
    }

    const exit = await pollForScriptComplete(inputs.appWindow, inputs.terminalId, inputs.timeoutMs, 250)
    return {
        spawnSuccess: true,
        spawnError: null,
        exitedCleanly: exit.scriptCompleted,
        spawnWallMs,
        wallMs: Date.now() - wallStart,
        timedOut: !exit.scriptCompleted,
        headlessOutput: exit.output,
    }
}
