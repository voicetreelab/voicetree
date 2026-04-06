/**
 * E2E integration test: vt-fake-agent CLI + real orchestration layer.
 *
 * Architecture:
 * - Starts a STUB MCP HTTP server using @modelcontextprotocol/sdk (not the full app server)
 * - Spawns real vt-fake-agent processes via headlessAgentManager
 * - Uses REAL terminal-registry, agent-completion-monitor, isAgentComplete, agentNodeIndex
 * - Only mocks leaf UI/Electron dependencies (same set as headlessAgentE2E.test.ts)
 *
 * What this tests that headlessAgentE2E.test.ts doesn't:
 * - Fake-agent CLI successfully parses scripts from AGENT_PROMPT
 * - MCP SDK client↔server communication works end-to-end
 * - create_graph calls register progress nodes in agentNodeIndex (progress-node gate)
 * - Full script execution: delay → create_node → exit lifecycle
 */

import {describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll} from 'vitest'
import path from 'path'
import {execSync} from 'child_process'
import type {Server} from 'http'

// ─── Mock leaf UI/Electron dependencies (hoisted before real imports) ────────

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn(() => ({
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    })),
    setGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn().mockResolvedValue({success: true})
}))

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {syncTerminals: vi.fn()}
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({autoNotifyUnseenNodes: false})
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn().mockResolvedValue([])
}))

vi.mock('@/shell/edge/main/terminals/stopGateHookRunner', () => ({
    runStopHooks: vi.fn().mockResolvedValue({passed: true})
}))

// ─── Import real modules ────────────────────────────────────────────────────

import {spawnHeadlessAgent, cleanupHeadlessAgents} from '@/shell/edge/main/terminals/headlessAgentManager'
import {startMonitor, cancelMonitor} from '@/shell/edge/main/mcp-server/agent-completion-monitor'
import {getTerminalRecords, clearTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'
import {registerAgentNodes, getAgentNodes, clearAgentNodes, type AgentNodeEntry} from '@/shell/edge/main/mcp-server/agentNodeIndex'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import {findAvailablePort} from '@/shell/edge/main/electron/port-utils'

// MCP SDK + express for stub server
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import {z} from 'zod'

// ─── Constants ──────────────────────────────────────────────────────────────

const FAKE_AGENT_DIR: string = path.resolve(__dirname, '../../../../../../../tools/vt-fake-agent')

// ─── Helpers ────────────────────────────────────────────────────────────────

const wait: (ms: number) => Promise<void> = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms))

function makeHeadlessTerminalData(id: string, parentId: string): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${id}.md`,
        terminalCount: 0,
        title: id,
        agentName: id,
        isHeadless: true,
        parentTerminalId: parentId as TerminalId,
    })
}

/**
 * Build the AGENT_PROMPT env var with a fake-agent script embedded.
 */
function buildAgentPrompt(script: object): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

/**
 * Spawn a fake agent as a headless process.
 * The agent connects to the stub MCP server, parses the script from AGENT_PROMPT,
 * executes it, and exits.
 */
function spawnFakeAgent(
    terminalId: string,
    parentTerminalId: string,
    script: object,
    mcpPort: number,
): void {
    const terminalData: TerminalData = makeHeadlessTerminalData(terminalId, parentTerminalId)
    spawnHeadlessAgent(
        terminalId as TerminalId,
        terminalData,
        `node ${FAKE_AGENT_DIR}/dist/index.js`,
        FAKE_AGENT_DIR,
        {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_MCP_PORT: String(mcpPort),
            TASK_NODE_PATH: `/tmp/vt-test-vault/${terminalId}-task.md`,
            AGENT_PROMPT: buildAgentPrompt(script),
        }
    )
}

// ─── Stub MCP Server ────────────────────────────────────────────────────────

/**
 * Start a minimal MCP HTTP server that handles the tools the fake agent calls.
 * Stubs create_graph (with real agentNodeIndex registration) and list_agents.
 * Returns the HTTP server instance for cleanup.
 */
async function startStubMcpServer(port: number): Promise<Server> {
    const app: express.Express = express()
    app.use(express.json())

    app.post('/mcp', async (req: express.Request, res: express.Response) => {
        const mcpServer: McpServer = new McpServer({name: 'vt-fake-agent-test-stub', version: '1.0.0'})

        // Stub: create_graph — registers nodes in the REAL agentNodeIndex
        mcpServer.registerTool(
            'create_graph',
            {
                inputSchema: {
                    callerTerminalId: z.string(),
                    nodes: z.array(z.object({
                        filename: z.string(),
                        title: z.string(),
                        summary: z.string(),
                        content: z.string().optional(),
                        color: z.string().optional(),
                    })),
                    parentNodeId: z.string().optional(),
                }
            },
            async ({callerTerminalId, nodes}) => {
                // Register in real agentNodeIndex — this is what the progress-node gate checks
                const records: TerminalRecord[] = getTerminalRecords()
                const caller: TerminalRecord | undefined = records.find(
                    (r: TerminalRecord) => r.terminalId === callerTerminalId
                )
                const agentName: string = caller?.terminalData.agentName ?? callerTerminalId
                registerAgentNodes(
                    agentName,
                    nodes.map((n: {filename: string; title: string}) => ({
                        nodeId: `/tmp/vt-test-vault/${n.filename}.md`,
                        title: n.title,
                    }))
                )
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: true,
                            nodes: nodes.map((n: {filename: string}) => ({
                                id: n.filename,
                                path: `/tmp/vt-test-vault/${n.filename}.md`,
                                status: 'ok',
                            })),
                        }),
                    }]
                }
            }
        )

        // Stub: list_agents — returns terminal records
        mcpServer.registerTool(
            'list_agents',
            {inputSchema: {}},
            async () => {
                const records: TerminalRecord[] = getTerminalRecords()
                const agents: Array<{terminalId: string; agentName: string; status: string}> = records.map((r: TerminalRecord) => ({
                    terminalId: r.terminalId,
                    agentName: r.terminalData.agentName,
                    status: r.status === 'exited' ? 'exited' : (r.terminalData.isDone ? 'idle' : 'running'),
                }))
                return {content: [{type: 'text' as const, text: JSON.stringify(agents)}]}
            }
        )

        // Stub: send_message — no-op
        mcpServer.registerTool(
            'send_message',
            {
                inputSchema: {
                    terminalId: z.string(),
                    message: z.string(),
                    callerTerminalId: z.string(),
                }
            },
            async () => ({content: [{type: 'text' as const, text: JSON.stringify({success: true})}]})
        )

        // Stub: close_agent — no-op
        mcpServer.registerTool(
            'close_agent',
            {
                inputSchema: {
                    terminalId: z.string(),
                    callerTerminalId: z.string(),
                    forceWithReason: z.string().optional(),
                }
            },
            async () => ({content: [{type: 'text' as const, text: JSON.stringify({success: true})}]})
        )

        // Stub: wait_for_agents — no-op (fake agent uses polling via list_agents instead)
        mcpServer.registerTool(
            'wait_for_agents',
            {
                inputSchema: {
                    terminalIds: z.array(z.string()),
                    callerTerminalId: z.string(),
                    pollIntervalMs: z.number().optional(),
                }
            },
            async () => ({content: [{type: 'text' as const, text: JSON.stringify({monitorId: 'stub-monitor'})}]})
        )

        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        })

        res.on('close', () => {
            void transport.close()
            void mcpServer.close()
        })

        try {
            await mcpServer.connect(transport)
            await transport.handleRequest(req, res, req.body)
        } catch (error) {
            if (!res.headersSent) {
                res.status(500).json({error: String(error)})
            }
        }
    })

    return new Promise<Server>((resolve) => {
        const instance: Server = app.listen(port, '127.0.0.1', () => {
            console.log(`[fakeAgentE2E] Stub MCP server listening on port ${port}`)
            resolve(instance)
        })
    })
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Fake agent E2E: script execution + completion detection', () => {
    let stubServer: Server
    let testPort: number

    beforeAll(async () => {
        // 1. Build fake-agent from TypeScript source
        console.log('[fakeAgentE2E] Building vt-fake-agent...')
        execSync('npm run build', {cwd: FAKE_AGENT_DIR, stdio: 'pipe'})
        console.log('[fakeAgentE2E] Build complete')

        // 2. Start stub MCP server on an available port
        testPort = await findAvailablePort(14567)
        stubServer = await startStubMcpServer(testPort)
    }, 30_000)

    afterAll(() => {
        stubServer?.close()
        cleanupHeadlessAgents()
        clearTerminalRecords()
        clearAgentNodes()
    })

    beforeEach(() => {
        clearTerminalRecords()
        clearAgentNodes()
        vi.clearAllMocks()
    })

    afterEach(() => {
        cleanupHeadlessAgents()
    })

    it('single fake agent: delay + create_node + exit → completion detected', async () => {
        const script: {actions: Array<{type: string; ms?: number; title?: string; summary?: string; code?: number}>} = {
            actions: [
                {type: 'delay', ms: 500},
                {type: 'create_node', title: 'Test Progress', summary: 'Created by fake agent test'},
                {type: 'exit', code: 0},
            ]
        }

        spawnFakeAgent('fake-e2e-1', 'test-caller', script, testPort)

        const monitorId: string = startMonitor('test-caller', ['fake-e2e-1'], 200)

        // Wait for: process start + delay + MCP call + exit + monitor poll
        await wait(5000)

        // Verify completion message sent to caller
        expect(sendTextToTerminal).toHaveBeenCalledWith(
            'test-caller',
            expect.stringContaining('[WaitForAgents] Agent(s) completed.')
        )

        // Verify the completion message mentions the agent
        const calls: [string, string][] = vi.mocked(sendTextToTerminal).mock.calls as [string, string][]
        const completionCall: [string, string] | undefined = calls.find((c: [string, string]) => c[1].includes('[WaitForAgents]'))
        expect(completionCall).toBeDefined()
        expect(completionCall![1]).toContain('fake-e2e-1')

        // Verify progress node was registered in agentNodeIndex
        const nodes: readonly AgentNodeEntry[] = getAgentNodes('fake-e2e-1')
        expect(nodes.length).toBeGreaterThan(0)
        expect(nodes[0].title).toBe('Test Progress')

        // Verify agent exited cleanly
        const records: TerminalRecord[] = getTerminalRecords()
        const agentRecord: TerminalRecord | undefined = records.find((r: TerminalRecord) => r.terminalId === 'fake-e2e-1')
        expect(agentRecord?.status).toBe('exited')

        cancelMonitor(monitorId)
    }, 15_000)

    it('fake agent with exit code 1 → completion detected with exit code', async () => {
        const script: {actions: Array<{type: string; ms?: number; code?: number}>} = {
            actions: [
                {type: 'delay', ms: 200},
                {type: 'exit', code: 1},
            ]
        }

        spawnFakeAgent('fake-e2e-err', 'test-caller', script, testPort)

        const monitorId: string = startMonitor('test-caller', ['fake-e2e-err'], 200)

        await wait(3000)

        // Agent exited (non-zero) → still detected as complete
        expect(sendTextToTerminal).toHaveBeenCalledWith(
            'test-caller',
            expect.stringContaining('[WaitForAgents]')
        )

        const records: TerminalRecord[] = getTerminalRecords()
        const agentRecord: TerminalRecord | undefined = records.find((r: TerminalRecord) => r.terminalId === 'fake-e2e-err')
        expect(agentRecord?.status).toBe('exited')

        cancelMonitor(monitorId)
    }, 10_000)

    it('parallel fake agents: 3 agents complete → single notification', async () => {
        const makeScript: (delayMs: number, title: string) => {actions: Array<{type: string; ms?: number; title?: string; summary?: string; code?: number}>} = (delayMs: number, title: string) => ({
            actions: [
                {type: 'delay', ms: delayMs},
                {type: 'create_node', title, summary: `Progress from ${title}`},
                {type: 'exit', code: 0},
            ]
        })

        spawnFakeAgent('fake-e2e-a', 'test-caller', makeScript(300, 'Agent A Done'), testPort)
        spawnFakeAgent('fake-e2e-b', 'test-caller', makeScript(600, 'Agent B Done'), testPort)
        spawnFakeAgent('fake-e2e-c', 'test-caller', makeScript(900, 'Agent C Done'), testPort)

        const monitorId: string = startMonitor(
            'test-caller',
            ['fake-e2e-a', 'fake-e2e-b', 'fake-e2e-c'],
            200
        )

        // Wait for slowest agent + monitor
        await wait(6000)

        // Exactly 1 completion notification (all agents in one batch)
        const completionCalls: [string, string][] = (vi.mocked(sendTextToTerminal).mock.calls as [string, string][]).filter(
            (c: [string, string]) => c[1].includes('[WaitForAgents]')
        )
        expect(completionCalls.length).toBe(1)

        // All three agents mentioned in the message
        const message: string = completionCalls[0][1]
        expect(message).toContain('fake-e2e-a')
        expect(message).toContain('fake-e2e-b')
        expect(message).toContain('fake-e2e-c')

        // All three registered progress nodes
        expect(getAgentNodes('fake-e2e-a').length).toBeGreaterThan(0)
        expect(getAgentNodes('fake-e2e-b').length).toBeGreaterThan(0)
        expect(getAgentNodes('fake-e2e-c').length).toBeGreaterThan(0)

        cancelMonitor(monitorId)
    }, 15_000)

    it('create_node registers in agentNodeIndex (progress-node gate integration)', async () => {
        const script: {actions: Array<{type: string; title?: string; summary?: string; ms?: number; code?: number}>} = {
            actions: [
                {type: 'create_node', title: 'Progress Gate Test', summary: 'Testing progress-node gate'},
                {type: 'delay', ms: 200},
                {type: 'exit', code: 0},
            ]
        }

        spawnFakeAgent('fake-e2e-gate', 'test-caller', script, testPort)

        // Wait for script to execute (before exit)
        await wait(2000)

        // Verify the agentNodeIndex has the node registered
        const nodes: readonly AgentNodeEntry[] = getAgentNodes('fake-e2e-gate')
        expect(nodes.length).toBe(1)
        expect(nodes[0].title).toBe('Progress Gate Test')
    }, 10_000)
})
