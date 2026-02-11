import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {Graph} from '@/pure/graph'

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

import {waitForAgentsTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
import {getGraph} from '@/shell/edge/main/state/graph-store'

/**
 * Creates a mock graph with nodes tagged with the given agent names.
 * The title is passed as a markdown heading to getNodeTitle.
 */
function createMockGraphWithAgentNodes(
    agentNodePairs: Array<{agentName: string; nodeId: string; title: string}>
): Graph {
    const nodes: Record<string, {
        absoluteFilePathIsID: string
        nodeUIMetadata: {additionalYAMLProps: Map<string, string>}
        contentWithoutYamlOrLinks: string
    }> = {}
    for (const {agentName, nodeId, title} of agentNodePairs) {
        nodes[nodeId] = {
            absoluteFilePathIsID: nodeId,
            nodeUIMetadata: {
                additionalYAMLProps: new Map([['agent_name', agentName]])
            },
            // Title is extracted from first heading or first line
            contentWithoutYamlOrLinks: `# ${title}\n\nContent here.`
        }
    }
    return {nodes} as unknown as Graph
}

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

describe('MCP wait_for_agents tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns immediately when all terminals are already exited', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const terminalDataB: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-b.md',
            terminalCount: 1,
            title: 'Agent B',
            executeCommand: true,
            agentName: 'test-agent-b'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 2,
            title: 'Caller',
            executeCommand: true
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'exited'},
            {terminalId: 'agent-b-terminal-1', terminalData: terminalDataB, status: 'exited'},
            {terminalId: 'caller-terminal-2', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        // Empty graph - agents exited without creating nodes
        vi.mocked(getGraph).mockReturnValue({nodes: {}} as Graph)

        const response: McpToolResponse = await waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0', 'agent-b-terminal-1'],
            callerTerminalId: 'caller-terminal-2'
        })
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: unknown[]; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: unknown[]; exitedWithoutNode: boolean}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents).toHaveLength(2)
        expect(payload.agents[0]).toEqual({
            terminalId: 'agent-a-terminal-0',
            title: 'Agent A',
            status: 'exited',
            newNodes: [],
            exitedWithoutNode: true
        })
        expect(payload.agents[1]).toEqual({
            terminalId: 'agent-b-terminal-1',
            title: 'Agent B',
            status: 'exited',
            newNodes: [],
            exitedWithoutNode: true
        })
    })

    it('polls and returns when terminals exit', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true
        })

        const runningRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]
        const exitedRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'exited'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords)
            .mockReturnValueOnce(runningRecords)
            .mockReturnValueOnce(runningRecords)
            .mockReturnValueOnce(exitedRecords)
        // Empty graph - agent exited without creating nodes
        vi.mocked(getGraph).mockReturnValue({nodes: {}} as Graph)

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100
        })

        // Advance timers to trigger polling
        await vi.advanceTimersByTimeAsync(100)
        await vi.advanceTimersByTimeAsync(100)

        const response: McpToolResponse = await responsePromise
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: unknown[]; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: unknown[]; exitedWithoutNode: boolean}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]).toEqual({
            terminalId: 'agent-a-terminal-0',
            title: 'Agent A',
            status: 'exited',
            newNodes: [],
            exitedWithoutNode: true
        })
        expect(getTerminalRecords).toHaveBeenCalledTimes(3)
    })

    it('returns error when target terminal ID is unknown', async () => {
        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 0,
            title: 'Caller',
            executeCommand: true
        })

        const records: TerminalRecord[] = [
            {terminalId: 'caller-terminal-0', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)

        const response: McpToolResponse = await waitForAgentsTool({
            terminalIds: ['unknown-terminal'],
            callerTerminalId: 'caller-terminal-0'
        })
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Unknown terminal: unknown-terminal')
    })

    it('returns error when caller terminal ID is unknown', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)

        const response: McpToolResponse = await waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'unknown-caller'
        })
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Unknown caller: unknown-caller')
    })

    it('returns immediately when all terminals are idle (isDone = true) AND have created nodes', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        terminalDataA.isDone = true // Agent is idle (finished work but not exited)

        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        // Graph with node created by agent-a
        vi.mocked(getGraph).mockReturnValue(createMockGraphWithAgentNodes([
            {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
        ]))

        const response: McpToolResponse = await waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1'
        })
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]).toEqual({
            terminalId: 'agent-a-terminal-0',
            title: 'Agent A',
            status: 'idle',
            newNodes: [{nodeId: 'task-node-1.md', title: 'Task Result'}],
            exitedWithoutNode: false
        })
    })

    it('polls and returns when terminals become idle AND have created nodes', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true
        })

        // First: running, then: idle (isDone = true)
        const runningRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: {...terminalDataA, isDone: false}, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]
        const idleRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: {...terminalDataA, isDone: true}, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords)
            .mockReturnValueOnce(runningRecords)
            .mockReturnValueOnce(runningRecords)
            .mockReturnValueOnce(idleRecords)
        // Graph with node created by agent-a
        vi.mocked(getGraph).mockReturnValue(createMockGraphWithAgentNodes([
            {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
        ]))

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100
        })

        // Advance timers to trigger polling
        await vi.advanceTimersByTimeAsync(100)
        await vi.advanceTimersByTimeAsync(100)

        const response: McpToolResponse = await responsePromise
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]).toEqual({
            terminalId: 'agent-a-terminal-0',
            title: 'Agent A',
            status: 'idle',
            newNodes: [{nodeId: 'task-node-1.md', title: 'Task Result'}],
            exitedWithoutNode: false
        })
        expect(getTerminalRecords).toHaveBeenCalledTimes(3)
    })

    it('continues polling when agent is idle but has not created a node yet', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true
        })

        // Agent becomes idle (isDone = true) but hasn't created a node yet
        const idleNoNodeRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: {...terminalDataA, isDone: true}, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        // Call pattern: validation(1) + poll1(2) + poll2(3) + poll3(4)
        vi.mocked(getTerminalRecords)
            .mockReturnValueOnce(idleNoNodeRecords) // Initial validation
            .mockReturnValueOnce(idleNoNodeRecords) // First poll: idle, no node -> continue
            .mockReturnValueOnce(idleNoNodeRecords) // Second poll: idle, no node -> continue
            .mockReturnValueOnce(idleNoNodeRecords) // Third poll: idle, now has node -> done

        // Graph: first empty, then with node on third poll
        vi.mocked(getGraph)
            .mockReturnValueOnce({nodes: {}} as Graph) // First poll: no nodes
            .mockReturnValueOnce({nodes: {}} as Graph) // Second poll: still no nodes
            .mockReturnValueOnce(createMockGraphWithAgentNodes([
                {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
            ])) // Third poll: node created

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100
        })

        // First poll - idle but no node, should continue
        await vi.advanceTimersByTimeAsync(100)
        // Second poll - idle with node, should complete
        await vi.advanceTimersByTimeAsync(100)

        const response: McpToolResponse = await responsePromise
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents[0].newNodes).toHaveLength(1)
        // Verify polling continued past the first idle state (without node)
        expect(getTerminalRecords).toHaveBeenCalledTimes(4)
        expect(getGraph).toHaveBeenCalledTimes(3)
    })

    it('returns success immediately when agent exited and has created a node', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'exited'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        // Graph with node created by agent
        vi.mocked(getGraph).mockReturnValue(createMockGraphWithAgentNodes([
            {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
        ]))

        const response: McpToolResponse = await waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1'
        })
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]).toEqual({
            terminalId: 'agent-a-terminal-0',
            title: 'Agent A',
            status: 'exited',
            newNodes: [{nodeId: 'task-node-1.md', title: 'Task Result'}],
            exitedWithoutNode: false
        })
    })

    it('returns timeout error with partial results when timeout exceeded', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true
        })

        const runningRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        // Always return running records to force timeout
        vi.mocked(getTerminalRecords).mockReturnValue(runningRecords)
        vi.mocked(getGraph).mockReturnValue({nodes: {}} as Graph)

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100,
        })

        // Advance timers past the 30 minute timeout
        await vi.advanceTimersByTimeAsync(1800001)

        const response: McpToolResponse = await responsePromise
        const payload: {
            success: boolean
            error: string
            stillRunning: string[]
            waitingForNodes: string[]
            agents: Array<{terminalId: string; title: string; status: string; newNodes: unknown[]; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            error: string
            stillRunning: string[]
            waitingForNodes: string[]
            agents: Array<{terminalId: string; title: string; status: string; newNodes: unknown[]; exitedWithoutNode: boolean}>
        }

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Timeout waiting for agents')
        expect(payload.stillRunning).toContain('agent-a-terminal-0')
        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0].status).toBe('running')
        expect(payload.agents[0].newNodes).toEqual([])
    })
})
