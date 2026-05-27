import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import type {TerminalRecord} from '@vt/agent-runtime'
import {clearAllBudgets, setTerminalBudget, getTerminalBudget} from '@vt/agent-runtime'

vi.mock('@vt/graph-db-server/watch-folder/vault-allowlist', () => ({
    getWriteFolder: vi.fn()
}))

vi.mock('@vt/graph-db-server/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@vt/agent-runtime', async (importOriginal) => {
    const actual: typeof import('@vt/agent-runtime') = await importOriginal()
    const spawnTerminalWithContextNode = vi.fn()
    const getTerminalRecords = vi.fn()
    const recordTerminalSpawn = vi.fn()
    return {
        ...actual,
        spawnTerminalWithContextNode,
        getTerminalRecords,
        recordTerminalSpawn,
        agentRuntime: {
            ...actual.agentRuntime,
            spawnTerminalWithContextNode,
            getTerminalRecords,
        },
    }
})

vi.mock('@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn(),
}))

vi.mock('@vt/graph-db-server/graph/applyGraphDelta', () => ({
    applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@vt/app-config/settings', () => ({
    loadSettings: vi.fn().mockResolvedValue({agents: []})
}))

vi.mock('@vt/voicetree-mcp', async (importOriginal) => {
    const actual: typeof import('@vt/voicetree-mcp') = await importOriginal()
    return {
        ...actual,
        startMonitor: vi.fn().mockReturnValue('monitor-1')
    }
})

import {spawnAgentTool} from '@vt/voicetree-mcp'
import {configureMcpServer} from '@vt/voicetree-mcp'
import {getWriteFolder} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@vt/graph-db-server/graph/applyGraphDelta'
import {spawnTerminalWithContextNode} from '@vt/agent-runtime'
import {getTerminalRecords} from '@vt/agent-runtime'
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

function buildGraphNode(nodeId: NodeIdAndFilePath, content: string, agentName?: string): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: agentName ? new Map([['agent_name', agentName]]) : new Map(),
            isContextNode: false
        }
    }
}

describe('MCP spawn_agent fair rebalancing budget enforcement', () => {
    let spawnCallCount: number = 0

    beforeEach(() => {
        vi.clearAllMocks()
        clearAllBudgets()
        spawnCallCount = 0
        configureMcpServer({
            graph: {
                getSnapshot: async () => ({
                    graph: getGraph(),
                    projectRoot: null,
                    vaultPaths: [],
                    writeFolder: O.toNullable(await getWriteFolder()),
                }),
                applyGraphDelta: async (delta: GraphDelta, recordForUndo?: boolean) => {
                    await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta, recordForUndo)
                },
            }
        })
    })

    function mockTerminalWithBudget(terminalId: string, budget: string, parentTerminalId: string | null = null): TerminalData {
        const terminalData: TerminalData = createTerminalData({
            terminalId: terminalId as TerminalId,
            attachedToNodeId: `ctx-nodes/${terminalId}.md`,
            terminalCount: 0,
            title: `Agent ${terminalId}`,
            executeCommand: true,
            agentName: terminalId,
            parentTerminalId: parentTerminalId as TerminalId | null,
            initialEnvVars: {GLOBAL_SPAWN_BUDGET: budget}
        })

        const existingRecords: TerminalRecord[] = (vi.mocked(getTerminalRecords).mock.results[0]?.value as TerminalRecord[] || [])
        vi.mocked(getTerminalRecords).mockReturnValue([
            ...existingRecords,
            {terminalId, terminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ])

        // Set the budget in the registry
        setTerminalBudget(terminalId, parseInt(budget, 10))

        return terminalData
    }

    function setupGraphAndSpawn(): void {
        vi.mocked(getWriteFolder).mockResolvedValue(O.some('/vault'))
        vi.mocked(getGraph).mockReturnValue({
            nodes: {'node-1.md': buildGraphNode('node-1.md', '# Node One')},
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        })
        vi.mocked(spawnTerminalWithContextNode).mockImplementation(async () => {
            const id: string = `child-terminal-${spawnCallCount++}`
            return {
                terminalId: id,
                contextNodeId: `ctx-nodes/${id}_context.md`
            }
        })
    }

    it('allows spawning when budget is sufficient', async () => {
        mockTerminalWithBudget('root-terminal', '5')
        setupGraphAndSpawn()

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload: {success: boolean; error?: string} = parsePayload(response) as {success: boolean; error?: string}

        expect(payload.success).toBe(true)
        expect(payload.error).toBeUndefined()
    })

    it('passes fair share child budget via GLOBAL_SPAWN_BUDGET env override', async () => {
        mockTerminalWithBudget('root-terminal', '10')
        setupGraphAndSpawn()

        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})

        const callArgs: unknown[] = vi.mocked(spawnTerminalWithContextNode).mock.calls[0]
        const envOverrides: Record<string, string> = callArgs[11] as Record<string, string>
        // child_budget = floor((10-1)/1) = 9
        expect(envOverrides.GLOBAL_SPAWN_BUDGET).toBe('9')
    })

    it('blocks spawning when budget is 0', async () => {
        mockTerminalWithBudget('root-terminal', '0')
        setupGraphAndSpawn()

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload: {success: boolean; error?: string} = parsePayload(response) as {success: boolean; error?: string}

        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Global spawn budget exhausted')
    })

    it('allows unlimited spawning when no budget set', async () => {
        const rootTerminalData: TerminalData = createTerminalData({
            terminalId: 'root-terminal' as TerminalId,
            attachedToNodeId: 'ctx-nodes/root.md',
            terminalCount: 0,
            title: 'Root Agent',
            executeCommand: true,
            agentName: 'root',
            parentTerminalId: null
        })

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'root-terminal', terminalData: rootTerminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ])

        setupGraphAndSpawn()

        for (let i: number = 0; i < 5; i++) {
            const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
            const payload: {success: boolean} = parsePayload(response) as {success: boolean}
            expect(payload.success).toBe(true)
        }

        // No GLOBAL_SPAWN_BUDGET in envOverrides (unlimited)
        const callArgs: unknown[] = vi.mocked(spawnTerminalWithContextNode).mock.calls[0]
        const envOverrides: Record<string, string> = callArgs[11] as Record<string, string>
        expect(envOverrides.GLOBAL_SPAWN_BUDGET).toBeUndefined()
    })

    it('budget=1 allows one spawn with child budget 0', async () => {
        mockTerminalWithBudget('root-terminal', '1')
        setupGraphAndSpawn()

        const response1: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response1)).toHaveProperty('success', true)

        // Child gets budget=0
        const callArgs: unknown[] = vi.mocked(spawnTerminalWithContextNode).mock.calls[0]
        const envOverrides: Record<string, string> = callArgs[11] as Record<string, string>
        expect(envOverrides.GLOBAL_SPAWN_BUDGET).toBe('0')

        // Next spawn denied
        const response2: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload2: {success: boolean; error?: string} = parsePayload(response2) as {success: boolean; error?: string}
        expect(payload2.success).toBe(false)
        expect(payload2.error).toContain('Global spawn budget exhausted')
    })

    it('registers child for rebalancing via registerChild after spawn', async () => {
        mockTerminalWithBudget('root-terminal', '10')
        setupGraphAndSpawn()

        // First spawn: child gets 9
        const response1: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload1: {success: boolean; terminalId: string} = parsePayload(response1) as {success: boolean; terminalId: string}
        expect(payload1.success).toBe(true)

        // Simulate child having initialized its budget (done by spawnTerminalWithContextNode in production)
        const childId1: string = payload1.terminalId
        setTerminalBudget(childId1, 9)

        // Second spawn: child gets 4, existing child rebalanced
        const response2: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response2)).toHaveProperty('success', true)

        // Verify second child gets fairShare=4
        const call2Args: unknown[] = vi.mocked(spawnTerminalWithContextNode).mock.calls[1]
        const env2: Record<string, string> = call2Args[11] as Record<string, string>
        expect(env2.GLOBAL_SPAWN_BUDGET).toBe('4')

        // Verify first child was rebalanced from 9 to 4
        expect(getTerminalBudget(childId1)).toBe(4)
    })
})
