import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import type {TerminalRecord} from '@vt/agent-runtime'

vi.mock('@vt/graph-db-server/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn(),
}))

vi.mock('@vt/agent-runtime', () => {
    const runtime = {
        closeHeadlessAgent: vi.fn(),
        enqueuePendingMessage: vi.fn(),
        getHeadlessAgentOutput: vi.fn(),
        getIdleSince: vi.fn(),
        getOutput: vi.fn(),
        getPendingTerminal: vi.fn(),
        getPendingTerminals: vi.fn(),
        getRuntimeUI: vi.fn(),
        getTerminalRecords: vi.fn(),
        registerChild: vi.fn(),
        resetAuditRetryCount: vi.fn(),
        runStopHooks: vi.fn(),
        sendTextToTerminal: vi.fn(),
        spawnTerminalWithContextNode: vi.fn(),
        tryConsumeAndSplitBudget: vi.fn(() => ({allowed: true, childBudget: undefined}))
    }
    return {
        ...runtime,
        agentRuntime: runtime,
    }
})

vi.mock('@vt/app-config/settings', () => ({
    loadSettings: vi.fn()
}))

import {configureMcpServer, listAgentsTool} from '@vt/voicetree-mcp'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {getUnseenNodesAroundContextNode} from '@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode'
import {agentRuntime, getTerminalRecords} from '@vt/agent-runtime'
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType"

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

describe('MCP list_agents tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(agentRuntime.getPendingTerminals).mockReturnValue([])
        configureMcpServer({
            graph: {
                getSnapshot: async () => ({
                    graph: getGraph(),
                    projectRoot: null,
                    vaultPaths: [],
                    writeFolder: null,
                }),
                applyGraphDelta: async () => {},
                getUnseenNodesAroundContextNode,
            }
        })
    })

    it('lists all agents with status and new nodes', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'Sam'
        })
        const terminalDataB: TerminalData = createTerminalData({
            terminalId: 'agent-b-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-b.md',
            terminalCount: 1,
            title: 'Agent B',
            executeCommand: true,
            agentName: 'Max'
        })
        const terminalDataPlain: TerminalData = createTerminalData({
            terminalId: 'plain-terminal-0' as TerminalId,
            attachedToNodeId: 'plain-node.md',
            terminalCount: 0,
            title: 'Plain Terminal',
            executeCommand: false,
            agentName: 'plain'
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0},
            {terminalId: 'agent-b-terminal-1', terminalData: {...terminalDataB, isDone: true}, status: 'exited', exitCode: null, auditRetryCount: 0, spawnedAt: 0},
            {terminalId: 'plain-terminal-0', terminalData: terminalDataPlain, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)

        vi.mocked(getGraph).mockReturnValue({
            nodes: {
                'new-node-a.md': buildGraphNode('new-node-a.md', '# Node A', 'Sam'),
                'new-node-b.md': buildGraphNode('new-node-b.md', '# Node B', 'Max')
            },
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        })

        const response: McpToolResponse = await listAgentsTool()
        const payload: {
            agents: Array<{
                terminalId: string
                title: string
                contextNodeId: string
                status: string
                newNodes: Array<{nodeId: string; title: string}>
            }>
        } = parsePayload(response) as {
            agents: Array<{
                terminalId: string
                title: string
                contextNodeId: string
                status: string
                newNodes: Array<{nodeId: string; title: string}>
            }>
        }

        expect(payload.agents).toHaveLength(2)
        expect(payload.agents[0]?.status).toBe('running')
        expect(payload.agents[0]?.newNodes[0]).toEqual({nodeId: 'new-node-a.md', title: 'Node A'})
        expect(payload.agents[1]?.status).toBe('exited')
        expect(payload.agents[1]?.newNodes[0]).toEqual({nodeId: 'new-node-b.md', title: 'Node B'})
    })

    it('returns an empty list when no agents exist', async () => {
        vi.mocked(getTerminalRecords).mockReturnValue([])

        const response: McpToolResponse = await listAgentsTool()
        const payload: {agents: unknown[]} = parsePayload(response) as {agents: unknown[]}

        expect(payload.agents).toEqual([])
    })

    it('includes pending headless terminals as running agents', async () => {
        vi.mocked(getTerminalRecords).mockReturnValue([])
        vi.mocked(agentRuntime.getPendingTerminals).mockReturnValue([
            {terminalId: 'pending-headless-1', isHeadless: true}
        ])
        vi.mocked(getGraph).mockReturnValue({nodes: {}, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map()})

        const response: McpToolResponse = await listAgentsTool()
        const payload: {agents: Array<{terminalId: string; status: string; isHeadless: boolean}>} =
            parsePayload(response) as {agents: Array<{terminalId: string; status: string; isHeadless: boolean}>}

        expect(payload.agents).toEqual([
            expect.objectContaining({
                terminalId: 'pending-headless-1',
                status: 'running',
                isHeadless: true,
            })
        ])
    })

    it('returns idle status when agent is inactive (isDone: true, PTY running)', async () => {
        const terminalData: TerminalData = createTerminalData({
            terminalId: 'idle-agent-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/idle-agent.md',
            terminalCount: 0,
            title: 'Idle Agent',
            executeCommand: true,
            agentName: 'idle-agent'
        })

        const records: TerminalRecord[] = [
            {terminalId: 'idle-agent-terminal-0', terminalData: {...terminalData, isDone: true}, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(getUnseenNodesAroundContextNode).mockResolvedValue([])
        vi.mocked(getGraph).mockReturnValue({nodes: {}, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map()})

        const response: McpToolResponse = await listAgentsTool()
        const payload: {agents: Array<{status: string}>} = parsePayload(response) as {agents: Array<{status: string}>}

        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]?.status).toBe('idle')
    })
})
