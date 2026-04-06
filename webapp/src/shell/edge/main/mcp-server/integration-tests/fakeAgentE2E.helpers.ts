/**
 * Shared test infrastructure for fakeAgentE2E tests.
 * Helpers, activity harness, and stub MCP server for testing
 * vt-fake-agent CLI + interactive PTY orchestration.
 */

import path from 'path'
import type {Server} from 'http'
import type {WebContents} from 'electron'

import {
    getTerminalRecords,
    updateTerminalActivityState,
    updateTerminalIsDone,
    clearTerminalRecords,
    type TerminalRecord
} from '@/shell/edge/main/terminals/terminal-registry'
import {registerAgentNodes, getAgentNodes, clearAgentNodes, type AgentNodeEntry} from '@/shell/edge/main/mcp-server/agentNodeIndex'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance'
import {findAvailablePort} from '@/shell/edge/main/electron/port-utils'
import {INACTIVITY_THRESHOLD_MS} from '@vt/graph-model/pure/agentTabs'
import {registerChildIfMonitored} from '@/shell/edge/main/mcp-server/agent-completion-monitor'

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import {z} from 'zod'
import {expect} from 'vitest'

// ─── Constants ──────────────────────────────────────────────────────────────

export const FAKE_AGENT_DIR: string = path.resolve(__dirname, '../../../../../../../tools/vt-fake-agent')
export const FAKE_AGENT_ENTRYPOINT: string = path.join(FAKE_AGENT_DIR, 'dist/index.js')
export const CALLER_TERMINAL_ID: string = 'test-caller'
export const SILENCE_POLL_MS: number = 100
export const SUSTAINED_IDLE_MS: number = 7_000

export {findAvailablePort, getTerminalManager, getTerminalRecords, getAgentNodes, clearAgentNodes, clearTerminalRecords}
export type {TerminalRecord, AgentNodeEntry}

// ─── Stub server context (mutable, set per-test) ───────────────────────────

export const stubCtx: {harness: ActivityHarness | null; childCounter: number} = {
    harness: null,
    childCounter: 0,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export const wait: (ms: number) => Promise<void> = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms))

export async function waitForCondition(
    predicate: () => boolean,
    timeoutMs: number,
    failureMessage: string,
    intervalMs: number = 100,
): Promise<void> {
    const deadline: number = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) return
        await wait(intervalMs)
    }
    throw new Error(failureMessage)
}

export function getTerminalRecord(terminalId: string): TerminalRecord | undefined {
    return getTerminalRecords().find((record: TerminalRecord) => record.terminalId === terminalId)
}

export function buildAgentPrompt(script: object): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

export function makeInteractiveTerminalData(
    terminalId: string,
    parentTerminalId: string,
    script: object,
    mcpPort: number,
): TerminalData {
    return createTerminalData({
        terminalId: terminalId as TerminalId,
        attachedToNodeId: `/tmp/vt-test-vault/${terminalId}-ctx.md`,
        terminalCount: 0,
        title: terminalId,
        agentName: terminalId,
        parentTerminalId: parentTerminalId as TerminalId,
        initialCommand: `node ${JSON.stringify(FAKE_AGENT_ENTRYPOINT)}; exit`,
        executeCommand: true,
        initialSpawnDirectory: FAKE_AGENT_DIR,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_MCP_PORT: String(mcpPort),
            TASK_NODE_PATH: `/tmp/vt-test-vault/${terminalId}-task.md`,
            AGENT_PROMPT: buildAgentPrompt(script),
        }
    })
}

// ─── Activity harness (simulates renderer-side inactivity detection) ────────

export type ActivityHarness = {
    sender: WebContents
    outputs: Map<string, string>
    transitionsByTerminal: Map<string, boolean[]>
    cleanup: () => void
}

function recordTransition(transitionsByTerminal: Map<string, boolean[]>, terminalId: string, isDone: boolean): void {
    const transitions: boolean[] = transitionsByTerminal.get(terminalId) ?? []
    transitions.push(isDone)
    transitionsByTerminal.set(terminalId, transitions)
}

export function createActivityHarness(): ActivityHarness {
    const outputs: Map<string, string> = new Map()
    const lastOutputAt: Map<string, number> = new Map()
    const transitionsByTerminal: Map<string, boolean[]> = new Map()
    const exitedTerminals: Set<string> = new Set()

    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
        const now: number = Date.now()
        for (const [terminalId, lastSeenAt] of lastOutputAt.entries()) {
            if (exitedTerminals.has(terminalId)) continue
            const record: TerminalRecord | undefined = getTerminalRecord(terminalId)
            if (!record || record.status === 'exited') continue
            if (!record.terminalData.isDone && now - lastSeenAt >= INACTIVITY_THRESHOLD_MS) {
                updateTerminalIsDone(terminalId, true)
                recordTransition(transitionsByTerminal, terminalId, true)
            }
        }
    }, SILENCE_POLL_MS)

    const sender: WebContents = {
        id: 1,
        isDestroyed: () => false,
        send: (channel: string, terminalId: string, payload: string | number): void => {
            if (channel === 'terminal:data') {
                const data: string = String(payload)
                const now: number = Date.now()
                outputs.set(terminalId, (outputs.get(terminalId) ?? '') + data)
                lastOutputAt.set(terminalId, now)

                const record: TerminalRecord | undefined = getTerminalRecord(terminalId)
                if (!record) return

                updateTerminalActivityState(terminalId, {
                    lastOutputTime: now,
                    activityCount: record.terminalData.activityCount + 1,
                })

                if (record.terminalData.isDone) {
                    updateTerminalIsDone(terminalId, false)
                    recordTransition(transitionsByTerminal, terminalId, false)
                }
                return
            }

            if (channel === 'terminal:exit') {
                exitedTerminals.add(terminalId)
            }
        },
    } as unknown as WebContents

    return {sender, outputs, transitionsByTerminal, cleanup: () => clearInterval(intervalId)}
}

// ─── Spawn + wait helpers ───────────────────────────────────────────────────

export async function spawnInteractiveFakeAgent(
    terminalId: string,
    parentTerminalId: string,
    script: object,
    mcpPort: number,
    harness: ActivityHarness,
): Promise<void> {
    const terminalData: TerminalData = makeInteractiveTerminalData(terminalId, parentTerminalId, script, mcpPort)
    const result: {success: boolean; terminalId: string} = await getTerminalManager().spawn(harness.sender, terminalData, () => FAKE_AGENT_DIR)
    expect(result.success).toBe(true)
    expect(result.terminalId).toBe(terminalId)
}

export async function waitForAgentOutput(
    harness: ActivityHarness,
    terminalId: string,
    needle: string,
    timeoutMs: number,
): Promise<void> {
    await waitForCondition(
        () => (harness.outputs.get(terminalId) ?? '').includes(needle),
        timeoutMs,
        `Timed out waiting for ${terminalId} output to contain "${needle}"`,
    )
}

export async function waitForIdle(terminalId: string, timeoutMs: number): Promise<void> {
    await waitForCondition(
        () => getTerminalRecord(terminalId)?.terminalData.isDone === true,
        timeoutMs,
        `${terminalId} never became idle`,
    )
}

export async function waitForResume(harness: ActivityHarness, terminalId: string, timeoutMs: number): Promise<void> {
    await waitForCondition(
        () => {
            const transitions: boolean[] = harness.transitionsByTerminal.get(terminalId) ?? []
            const idleIndex: number = transitions.indexOf(true)
            const resumeIndex: number = transitions.indexOf(false)
            return idleIndex !== -1 && resumeIndex > idleIndex
        },
        timeoutMs,
        `${terminalId} never resumed after going idle`,
    )
}

export async function waitForTerminalExit(terminalId: string, timeoutMs: number): Promise<void> {
    await waitForCondition(
        () => getTerminalRecord(terminalId)?.status === 'exited',
        timeoutMs,
        `${terminalId} never exited`,
    )
}

// ─── Stub MCP Server ────────────────────────────────────────────────────────

export async function startStubMcpServer(port: number): Promise<Server> {
    const app: express.Express = express()
    app.use(express.json())

    app.post('/mcp', async (req: express.Request, res: express.Response) => {
        const mcpServer: McpServer = new McpServer({name: 'vt-fake-agent-test-stub', version: '1.0.0'})

        mcpServer.registerTool(
            'create_graph',
            {
                inputSchema: {
                    callerTerminalId: z.string(),
                    nodes: z.array(z.object({
                        filename: z.string(), title: z.string(), summary: z.string(),
                        content: z.string().optional(), color: z.string().optional(),
                    })),
                    parentNodeId: z.string().optional(),
                }
            },
            async ({callerTerminalId, nodes}) => {
                const records: TerminalRecord[] = getTerminalRecords()
                const caller: TerminalRecord | undefined = records.find(
                    (r: TerminalRecord) => r.terminalId === callerTerminalId
                )
                registerAgentNodes(
                    callerTerminalId,
                    nodes.map((n: {filename: string; title: string}) => ({
                        nodeId: `/tmp/vt-test-vault/${n.filename}.md`, title: n.title,
                    }))
                )
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            nodes: nodes.map((n: {filename: string}) => ({
                                id: n.filename, path: `/tmp/vt-test-vault/${n.filename}.md`, status: 'ok',
                            })),
                        }),
                    }]
                }
            }
        )

        mcpServer.registerTool('list_agents', {inputSchema: {}}, async () => {
            const records: TerminalRecord[] = getTerminalRecords()
            const agents: Array<{terminalId: string; agentName: string; status: string}> = records.map((r: TerminalRecord) => ({
                terminalId: r.terminalId,
                agentName: r.terminalData.agentName,
                status: r.status === 'exited' ? 'exited' : (r.terminalData.isDone ? 'idle' : 'running'),
            }))
            return {content: [{type: 'text' as const, text: JSON.stringify(agents)}]}
        })

        mcpServer.registerTool('send_message', {
            inputSchema: {terminalId: z.string(), message: z.string(), callerTerminalId: z.string()}
        }, async () => ({content: [{type: 'text' as const, text: JSON.stringify({success: true})}]}))

        mcpServer.registerTool('close_agent', {
            inputSchema: {terminalId: z.string(), callerTerminalId: z.string(), forceWithReason: z.string().optional()}
        }, async () => ({content: [{type: 'text' as const, text: JSON.stringify({success: true})}]}))

        mcpServer.registerTool('wait_for_agents', {
            inputSchema: {terminalIds: z.array(z.string()), callerTerminalId: z.string(), pollIntervalMs: z.number().optional()}
        }, async () => ({content: [{type: 'text' as const, text: JSON.stringify({monitorId: 'stub-monitor'})}]}))

        mcpServer.registerTool(
            'spawn_agent',
            {
                inputSchema: {
                    callerTerminalId: z.string(), task: z.string(), parentNodeId: z.string(),
                    depthBudget: z.number().optional(), headless: z.boolean().optional(),
                }
            },
            async ({callerTerminalId, task}) => {
                const childId: string = `child-${++stubCtx.childCounter}`
                if (!stubCtx.harness) throw new Error('stubCtx.harness not set — set it in your test before spawning')

                const childData: TerminalData = createTerminalData({
                    terminalId: childId as TerminalId,
                    attachedToNodeId: `/tmp/vt-test-vault/${childId}-ctx.md`,
                    terminalCount: 0,
                    title: childId,
                    agentName: childId,
                    parentTerminalId: callerTerminalId as TerminalId,
                    initialCommand: `node ${JSON.stringify(FAKE_AGENT_ENTRYPOINT)}; exit`,
                    executeCommand: true,
                    initialSpawnDirectory: FAKE_AGENT_DIR,
                    initialEnvVars: {
                        VOICETREE_TERMINAL_ID: childId,
                        VOICETREE_MCP_PORT: String(port),
                        TASK_NODE_PATH: `/tmp/vt-test-vault/${childId}-task.md`,
                        AGENT_PROMPT: task,
                    }
                })

                await getTerminalManager().spawn(stubCtx.harness.sender, childData, () => FAKE_AGENT_DIR)
                registerChildIfMonitored(callerTerminalId, childId)

                return {content: [{type: 'text' as const, text: JSON.stringify({terminalId: childId})}]}
            }
        )

        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, enableJsonResponse: true,
        })
        res.on('close', () => { void transport.close(); void mcpServer.close() })

        try {
            await mcpServer.connect(transport)
            await transport.handleRequest(req, res, req.body)
        } catch (error) {
            if (!res.headersSent) res.status(500).json({error: String(error)})
        }
    })

    return new Promise<Server>((resolve) => {
        const instance: Server = app.listen(port, '127.0.0.1', () => {
            console.log(`[fakeAgentE2E] Stub MCP server listening on port ${port}`)
            resolve(instance)
        })
    })
}
