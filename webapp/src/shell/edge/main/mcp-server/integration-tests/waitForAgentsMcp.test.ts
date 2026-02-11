import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {Graph} from '@/pure/graph'

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn(),
    getIdleSince: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

import {waitForAgentsTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getTerminalRecords, getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'
import {getGraph} from '@/shell/edge/main/state/graph-store'

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
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const terminalDataB: TerminalData = createTerminalData({
            terminalId: 'agent-b-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-b.md',
            terminalCount: 1,
            title: 'Agent B',
            executeCommand: true,
            agentName: 'test-agent-b'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-2' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 2,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'exited'},
            {terminalId: 'agent-b-terminal-1', terminalData: terminalDataB, status: 'exited'},
            {terminalId: 'caller-terminal-2', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
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
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
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
        vi.mocked(getGraph).mockReturnValue({nodes: {}} as Graph)

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100
        })

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
            terminalId: 'caller-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 0,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
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
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
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

    it('returns when idle agent has nodes AND sustained idle >= 15s', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })

        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: {...terminalDataA, isDone: true}, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(getGraph).mockReturnValue(createMockGraphWithAgentNodes([
            {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
        ]))
        // Idle since 20s ago — sustained idle threshold (15s) is met
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 20000)

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

    it('continues polling when idle with nodes but sustained idle < 15s', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })

        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
        })

        const idleRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: {...terminalDataA, isDone: true}, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(idleRecords)
        vi.mocked(getGraph).mockReturnValue(createMockGraphWithAgentNodes([
            {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
        ]))

        // Idle since just now — sustained idle threshold not met
        const idleStartTime: number = Date.now()
        vi.mocked(getIdleSince).mockReturnValue(idleStartTime)

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100
        })

        // Advance 5s — still under 15s threshold, should keep polling
        await vi.advanceTimersByTimeAsync(5000)

        // Advance past 15s threshold — should now complete
        await vi.advanceTimersByTimeAsync(11000)

        const response: McpToolResponse = await responsePromise
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string; newNodes: Array<{nodeId: string; title: string}>; exitedWithoutNode: boolean}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents[0].status).toBe('idle')
        expect(payload.agents[0].newNodes).toHaveLength(1)
        // Should have polled multiple times before the 15s threshold was met
        expect(vi.mocked(getTerminalRecords).mock.calls.length).toBeGreaterThan(2)
    })

    it('polls and returns when terminals become idle with sustained idle AND have created nodes', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
        })

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
            .mockReturnValue(idleRecords)
        vi.mocked(getGraph).mockReturnValue(createMockGraphWithAgentNodes([
            {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
        ]))

        // idleSince set when agent first becomes idle (after 2 polls = 200ms)
        const idleStartTime: number = Date.now() + 200
        vi.mocked(getIdleSince).mockImplementation((terminalId: string) =>
            terminalId === 'agent-a-terminal-0' ? idleStartTime : null
        )

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100
        })

        await vi.advanceTimersByTimeAsync(100)
        await vi.advanceTimersByTimeAsync(100)
        await vi.advanceTimersByTimeAsync(15100)

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
    })

    it('continues polling when agent is idle but has not created a node yet', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
        })

        const idleNoNodeRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: {...terminalDataA, isDone: true}, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        // Idle since long ago — sustained idle is met, but no nodes
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 30000)

        vi.mocked(getTerminalRecords)
            .mockReturnValueOnce(idleNoNodeRecords)
            .mockReturnValueOnce(idleNoNodeRecords)
            .mockReturnValueOnce(idleNoNodeRecords)
            .mockReturnValueOnce(idleNoNodeRecords)

        vi.mocked(getGraph)
            .mockReturnValueOnce({nodes: {}} as Graph)
            .mockReturnValueOnce({nodes: {}} as Graph)
            .mockReturnValueOnce(createMockGraphWithAgentNodes([
                {agentName: 'test-agent-a', nodeId: 'task-node-1.md', title: 'Task Result'}
            ]))

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100
        })

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
        expect(payload.agents[0].newNodes).toHaveLength(1)
        expect(getTerminalRecords).toHaveBeenCalledTimes(4)
        expect(getGraph).toHaveBeenCalledTimes(3)
    })

    it('returns success immediately when agent exited and has created a node', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
        })

        const records: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'exited'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
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
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'test-agent-a'
        })
        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 1,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller'
        })

        const runningRecords: TerminalRecord[] = [
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(runningRecords)
        vi.mocked(getGraph).mockReturnValue({nodes: {}} as Graph)

        const responsePromise: Promise<McpToolResponse> = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 100,
        })

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
