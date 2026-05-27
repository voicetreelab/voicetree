/**
 * Spawn ONE vt-fake-agent through the normal MCP `spawn_agent` flow.
 *
 * Why not plain child_process: vt-mcpd's `create_graph` tool requires a
 * caller terminal registered in Electron's `agent-runtime` singleton. A
 * test-process child is invisible to that registry.
 *
 * Right answer: create one real caller terminal in Electron, then ask the
 * running MCP server to spawn child agents exactly as production agents do.
 * That path calls spawnTerminalWithContextNode -> launchTerminalOntoUI, so
 * headful fake agents get real floating terminal windows.
 */
import type { Page } from '@playwright/test'
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
    readonly mcpPort: number
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

type McpJsonResponse = {
    readonly result?: {
        readonly content?: readonly { readonly type: string; readonly text: string }[]
        readonly isError?: boolean
    }
    readonly error?: { readonly message: string }
}

type McpToolResult = {
    readonly success: boolean
    readonly parsed?: Record<string, unknown>
    readonly isError?: boolean
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

async function mcpRequest(mcpPort: number, method: string, params: Record<string, unknown> = {}, id = 1): Promise<McpJsonResponse> {
    const response = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    return JSON.parse(await response.text()) as McpJsonResponse
}

async function mcpCallTool(mcpPort: number, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const response = await mcpRequest(mcpPort, 'tools/call', {
        name: toolName,
        arguments: args,
    })
    if (response.error) throw new Error(`MCP error: ${response.error.message}`)

    const text = response.result?.content?.[0]?.text
    const parsed = text ? JSON.parse(text) as Record<string, unknown> : undefined
    return {
        success: parsed?.success === true,
        parsed,
        isError: response.result?.isError,
    }
}

export async function initializeMcpClient(mcpPort: number): Promise<void> {
    const response = await mcpRequest(mcpPort, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-storm-mvp', version: '1.0.0' },
    }, 0)
    if (response.error) throw new Error(`MCP initialize failed: ${response.error.message}`)
}

export async function waitForAgentListed(
    mcpPort: number,
    terminalId: string,
    timeoutMs: number,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const result = await mcpCallTool(mcpPort, 'list_agents', {})
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
    const wallStart = Date.now()
    const spawnStart = Date.now()
    const spawnResult = await mcpCallTool(inputs.mcpPort, 'spawn_agent', {
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
            spawnError: typeof spawnResult.parsed?.error === 'string' ? spawnResult.parsed.error : 'unknown spawn error',
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
