import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {GraphNode, NodeIdAndFilePath} from '@vt/graph-model/pure/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn()
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn()
}))

import {listAgentsTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getUnseenNodesAroundContextNode} from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
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
