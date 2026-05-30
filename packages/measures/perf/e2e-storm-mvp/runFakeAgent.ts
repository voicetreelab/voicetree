/**
 * Spawn ONE vt-fake-agent through the daemon's `spawn_agent` tool.
 *
 * Why not plain child_process: the daemon's `create_graph` tool requires a
 * caller terminal registered in the agent-runtime registry. A test-process
 * child is invisible to that registry.
 *
 * Right answer: create one real caller terminal in Electron, then ask the
 * running daemon to spawn child agents exactly as production agents do. That
 * path calls spawnTerminalWithContextNode -> launchTerminalOntoUI, so headful
 * fake agents get real floating terminal windows.
 *
 * Transport: post-MCP-cutover the daemon exposes its tools as plain JSON-RPC
 * over `/rpc` (bearer-authenticated). We drive them through `@vt/vt-rpc`'s
 * `DaemonRpcClient` — the same transport the `vt` CLI uses — rather than
 * re-hand-rolling the wire. The daemon UNWRAPS each tool's response: a success
 * arrives as `result` = the parsed payload, an `isError` tool result arrives
 * as a JSON-RPC error whose `data` carries the `{success:false, error}` payload.
 */
import type { Page } from '@playwright/test'
import type { DaemonRpcClient } from '@vt/vt-rpc'
import type { FakeAgentScript } from '../../../../tools/vt-fake-agent/src/types.ts'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

export interface FakeAgentInputs {
    readonly appWindow: Page
    readonly repoRoot: string
    readonly daemonClient: DaemonRpcClient
    readonly seedNodeAbsolutePath: string
    readonly callerTerminalId: string
    readonly promptTemplate: string
    readonly timeoutMs: number
}

export interface FakeAgentResult {
    readonly terminalId: string | null
    readonly spawnSuccess: boolean
    readonly spawnError: string | null
    readonly exitedCleanly: boolean
    readonly spawnWallMs: number
    readonly wallMs: number
    readonly timedOut: boolean
    readonly terminalOutput: string
}

interface ToolCallOutcome {
    readonly success: boolean
    readonly parsed: Record<string, unknown> | undefined
    readonly error: string | undefined
}

export function buildStormAgentPrompt(script: FakeAgentScript): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

export function promptTemplateName(agentIndex: number): string {
    return `AGENT_PROMPT_STORM_${agentIndex}`
}

export function resolveFakeAgentEntrypoint(repoRoot: string): string {
    const entry = path.join(repoRoot, 'tools', 'vt-fake-agent', 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return entry
}

export function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

export function buildFakeAgentCommand(repoRoot: string): string {
    return [
        JSON.stringify(process.execPath),
        '--import',
        JSON.stringify(resolveTsxImportPath()),
        JSON.stringify(resolveFakeAgentEntrypoint(repoRoot)),
        '"$AGENT_PROMPT"',
    ].join(' ')
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Recover the human-facing failure sentence from a tool error payload. The
// daemon's dispatcher sets `error.data` to the *parsed* tool error object —
// for the agent/graph tool family that is `{success:false, error:'<sentence>'}`.
// Mirrors the CLI daemon-client's `extractToolFailureSentence`.
function extractToolFailureSentence(data: unknown, fallback: string): string {
    if (typeof data === 'string' && data.length > 0) return data
    if (isRecord(data)) {
        const err = data.error
        if (typeof err === 'string' && err.length > 0) return err
        const msg = data.message
        if (typeof msg === 'string' && msg.length > 0) return msg
    }
    return fallback
}

/**
 * Invoke a daemon tool over `/rpc` and normalize the unwrapped envelope into a
 * uniform `{success, parsed, error}` outcome. A JSON-RPC error (the daemon's
 * representation of a tool that set `isError`) becomes `success:false` with the
 * recovered sentence; a transport failure (unreachable / auth) propagates as a
 * thrown error, exactly as the old MCP path did.
 */
async function callTool(
    client: DaemonRpcClient,
    toolName: string,
    args: Record<string, unknown>,
): Promise<ToolCallOutcome> {
    const response = await client.call(toolName, args)
    if ('error' in response) {
        return {
            success: false,
            parsed: isRecord(response.error.data) ? response.error.data : undefined,
            error: extractToolFailureSentence(response.error.data, response.error.message),
        }
    }
    const payload = isRecord(response.result) ? response.result : undefined
    return { success: payload?.success === true, parsed: payload, error: undefined }
}

export async function waitForAgentListed(
    client: DaemonRpcClient,
    terminalId: string,
    timeoutMs: number,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const result = await callTool(client, 'list_agents', {})
        const agents = result.parsed?.agents
        if (Array.isArray(agents) && agents.some(agent => (
            typeof agent === 'object'
            && agent !== null
            && 'terminalId' in agent
            && agent.terminalId === terminalId
        ))) {
            return true
        }
        await new Promise(r => setTimeout(r, 250))
    }
    return false
}

export async function waitForInteractiveTerminalMounted(
    appWindow: Page,
    terminalId: string,
    timeoutMs: number,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const mounted = await appWindow.evaluate((id) => {
            const selector = `[data-floating-window-id="${CSS.escape(id)}"].cy-floating-window-terminal`
            const windowEl = document.querySelector<HTMLElement>(selector)
            const xtermEl = windowEl?.querySelector<HTMLElement>('.xterm')
            if (!windowEl || !xtermEl) return false

            const style = window.getComputedStyle(windowEl)
            const rect = windowEl.getBoundingClientRect()
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0
        }, terminalId)
        if (mounted) return true
        await new Promise(r => setTimeout(r, 250))
    }
    return false
}

/**
 * Wait for the fake-agent to reach its `exit` action via the tmux-backed
 * output buffer. The executor emits `[fake-agent] Executing: <type>` for
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
                electronAPI?: { main?: { getHeadlessAgentOutput?: (request: { terminalId: string }) => Promise<string> } }
            }).electronAPI?.main
            return (await api?.getHeadlessAgentOutput?.({ terminalId: id })) ?? ''
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
    const wallStart = Date.now()
    const spawnStart = Date.now()
    const spawnResult = await callTool(inputs.daemonClient, 'spawn_agent', {
        nodeId: inputs.seedNodeAbsolutePath,
        callerTerminalId: inputs.callerTerminalId,
        agentName: 'Fake Agent',
        spawnDirectory: inputs.repoRoot,
        depthBudget: 0,
        headless: false,
        promptTemplate: inputs.promptTemplate,
    })
    const spawnWallMs = Date.now() - spawnStart

    if (!spawnResult.success) {
        return {
            terminalId: null,
            spawnSuccess: false,
            spawnError: spawnResult.error
                ?? (typeof spawnResult.parsed?.error === 'string' ? spawnResult.parsed.error : 'unknown spawn error'),
            exitedCleanly: false,
            spawnWallMs,
            wallMs: Date.now() - wallStart,
            timedOut: false,
            terminalOutput: '',
        }
    }

    const terminalId = typeof spawnResult.parsed?.terminalId === 'string' ? spawnResult.parsed.terminalId : ''
    if (!terminalId) {
        return {
            terminalId: null,
            spawnSuccess: false,
            spawnError: 'spawn_agent returned no terminalId',
            exitedCleanly: false,
            spawnWallMs,
            wallMs: Date.now() - wallStart,
            timedOut: false,
            terminalOutput: '',
        }
    }

    const terminalMounted = await waitForInteractiveTerminalMounted(inputs.appWindow, terminalId, 10_000)
    if (!terminalMounted) {
        return {
            terminalId,
            spawnSuccess: false,
            spawnError: `spawn_agent returned ${terminalId}, but no headful xterm floating window mounted`,
            exitedCleanly: false,
            spawnWallMs,
            wallMs: Date.now() - wallStart,
            timedOut: false,
            terminalOutput: '',
        }
    }

    const exit = await pollForScriptComplete(inputs.appWindow, terminalId, inputs.timeoutMs, 250)
    return {
        terminalId,
        spawnSuccess: true,
        spawnError: null,
        exitedCleanly: exit.scriptCompleted,
        spawnWallMs,
        wallMs: Date.now() - wallStart,
        timedOut: !exit.scriptCompleted,
        terminalOutput: exit.output,
    }
}
