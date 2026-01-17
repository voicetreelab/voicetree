import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph'
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'

vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', () => ({
    getWritePath: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/spawnTerminalWithContextNode', () => ({
    spawnTerminalWithContextNode: vi.fn()
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn()
}))

import {spawnAgentTool, listAgentsTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {getUnseenNodesAroundContextNode} from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

function buildGraphNode(nodeId: NodeIdAndFilePath, content: string): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

describe('MCP spawn_agent tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('spawns an agent on an existing node', async () => {
        vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
        vi.mocked(getGraph).mockReturnValue({
            nodes: {
                'node-1.md': buildGraphNode('node-1.md', '# Node One')
            },
            incomingEdgesIndex: new Map()
        } as Graph)

        vi.mocked(spawnTerminalWithContextNode).mockResolvedValue({
            terminalId: 'node-1-terminal-0',
            contextNodeId: 'ctx-nodes/node-1_context.md'
        })

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md'})
        const payload: {
            success: boolean
            terminalId: string
            nodeId: string
            contextNodeId: string
            message: string
        } = parsePayload(response) as {
            success: boolean
            terminalId: string
            nodeId: string
            contextNodeId: string
            message: string
        }

        expect(payload.success).toBe(true)
        expect(payload.nodeId).toBe('node-1.md')
        expect(payload.terminalId).toBe('node-1-terminal-0')
        expect(payload.contextNodeId).toBe('ctx-nodes/node-1_context.md')
        expect(payload.message).toContain('Spawned agent')
    })

    it('returns an error when node is not found', async () => {
        vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
        vi.mocked(getGraph).mockReturnValue({
            nodes: {},
            incomingEdgesIndex: new Map()
        } as Graph)

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'missing-node.md'})
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('not found')
    })

    it('returns an error when vault path is not set', async () => {
        vi.mocked(getWritePath).mockResolvedValue(O.none)

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md'})
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('No vault loaded')
        expect(spawnTerminalWithContextNode).not.toHaveBeenCalled()
    })

    it('returns after spawn is initiated', async () => {
        vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
        vi.mocked(getGraph).mockReturnValue({
            nodes: {
                'node-1.md': buildGraphNode('node-1.md', '# Node One')
            },
            incomingEdgesIndex: new Map()
        } as Graph)

        vi.mocked(spawnTerminalWithContextNode).mockResolvedValue({
            terminalId: 'node-1-terminal-0',
            contextNodeId: 'ctx-nodes/node-1_context.md'
        })

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md'})
        const payload: {success: boolean; terminalId: string} = parsePayload(response) as {success: boolean; terminalId: string}

        expect(payload.success).toBe(true)
        expect(payload.terminalId).toBe('node-1-terminal-0')
        expect(spawnTerminalWithContextNode).toHaveBeenCalledTimes(1)
    })
})

describe('MCP list_agents tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('lists all agents with status and new nodes', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true
        })
        const terminalDataB: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-b.md',
            terminalCount: 1,
            title: 'Agent B',
            executeCommand: true
        })
        const terminalDataPlain: TerminalData = createTerminalData({
            attachedToNodeId: 'plain-node.md',
            terminalCount: 0,
            title: 'Plain Terminal',
            executeCommand: false
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'agent-b-terminal-1', terminalData: {...terminalDataB, isDone: true}, status: 'exited'},
            {terminalId: 'plain-terminal-0', terminalData: terminalDataPlain, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(getUnseenNodesAroundContextNode).mockImplementation(async (contextNodeId: string) => {
            if (contextNodeId === 'ctx-nodes/agent-a.md') {
                return [{nodeId: 'new-node-a.md', content: 'A'}]
            }
            if (contextNodeId === 'ctx-nodes/agent-b.md') {
                return [{nodeId: 'new-node-b.md', content: 'B'}]
            }
            return []
        })

        vi.mocked(getGraph).mockReturnValue({
            nodes: {
                'new-node-a.md': buildGraphNode('new-node-a.md', '# Node A'),
                'new-node-b.md': buildGraphNode('new-node-b.md', '# Node B')
            },
            incomingEdgesIndex: new Map()
        } as Graph)

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
            attachedToNodeId: 'ctx-nodes/idle-agent.md',
            terminalCount: 0,
            title: 'Idle Agent',
            executeCommand: true
        })

        const records: TerminalRecord[] = [
            {terminalId: 'idle-agent-terminal-0', terminalData: {...terminalData, isDone: true}, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(getUnseenNodesAroundContextNode).mockResolvedValue([])
        vi.mocked(getGraph).mockReturnValue({nodes: {}, incomingEdgesIndex: new Map()} as Graph)

        const response: McpToolResponse = await listAgentsTool()
        const payload: {agents: Array<{status: string}>} = parsePayload(response) as {agents: Array<{status: string}>}

        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]?.status).toBe('idle')
    })
})
