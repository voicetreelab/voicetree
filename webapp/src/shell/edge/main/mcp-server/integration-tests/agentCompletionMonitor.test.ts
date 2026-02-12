import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode} from '@/pure/graph'

import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// Mock leaf dependencies at the shell boundary — let pure functions run through
vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn(),
    getIdleSince: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn()
}))

import {startMonitor, cancelMonitor} from '@/shell/edge/main/mcp-server/agent-completion-monitor'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'

// --- Helpers ---

function buildGraphNode(
    nodeId: string,
    title: string,
    agentName: string,
    isContextNode: boolean = false
): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: `# ${title}\n\nContent.`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map([['agent_name', agentName]]),
            isContextNode
        }
    }
}

function buildGraph(nodes: GraphNode[]): Graph {
    const nodesRecord: Record<string, GraphNode> = {}
    for (const node of nodes) {
        nodesRecord[node.absoluteFilePathIsID] = node
    }
    return {
        nodes: nodesRecord,
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

function makeTerminalData(id: string, agentName: string): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${agentName}.md`,
        terminalCount: 0,
        title: agentName,
        agentName
    })
}

function makeIdleTerminalData(id: string, agentName: string): TerminalData {
    return {...makeTerminalData(id, agentName), isDone: true}
}

// --- Tests ---

describe('AgentCompletionMonitor integration', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.mocked(sendTextToTerminal).mockResolvedValue({success: true})
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('startMonitor returns a monitorId string', () => {
        const agentData: TerminalData = makeTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        const monitorId: string = startMonitor('caller-1', ['agent-1'], 5000)

        expect(monitorId).toMatch(/^monitor-\d+$/)
        cancelMonitor(monitorId)
    })

    it('calls sendTextToTerminal when all agents complete (exited)', () => {
        const agentData: TerminalData = makeTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        // Initially running
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-1'], 1000)

        // Poll 1: agent still running — no notification
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Agent exits
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])

        // Poll 2: agent exited — notification sent
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        expect(sendTextToTerminal).toHaveBeenCalledWith(
            'caller-1',
            expect.stringContaining('[WaitForAgents]')
        )
    })

    it('honors the polling interval (no early fire)', () => {
        const agentData: TerminalData = makeTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        // Agent already exited — will trigger on first poll
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-1'], 3000)

        // 2999ms: poll hasn't fired yet
        vi.advanceTimersByTime(2999)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // 3000ms: first poll fires
        vi.advanceTimersByTime(1)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
    })

    it('cancelMonitor prevents notification even after agents complete', () => {
        const agentData: TerminalData = makeTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        const monitorId: string = startMonitor('caller-1', ['agent-1'], 1000)

        // Cancel before any poll
        cancelMonitor(monitorId)

        // Agent exits
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])

        // Advance past many poll intervals — no notification
        vi.advanceTimersByTime(10000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()
    })

    it('sends notification only once (interval clears after completion)', () => {
        const agentData: TerminalData = makeTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        // Agent already exited
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-1'], 1000)

        // First poll: completion detected, message sent
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)

        // Many more intervals pass — no duplicate calls
        vi.advanceTimersByTime(10000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
    })

    it('waits for idle agent to have progress nodes AND sustained idle >= 30s', () => {
        const idleAgentData: TerminalData = makeIdleTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: idleAgentData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 60_000)

        startMonitor('caller-1', ['agent-1'], 1000)

        // Poll 1: idle but no progress nodes → not complete
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Add a progress node, but set idle to only 10s
        const progressNode: GraphNode = buildGraphNode('node-1.md', 'Design doc', 'alpha')
        vi.mocked(getGraph).mockReturnValue(buildGraph([progressNode]))
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 10_000)

        // Poll 2: has nodes but idle < 30s → not complete
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Set idle to 31s+
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 31_000)

        // Poll 3: idle + progress nodes + sustained 31s → complete
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        expect(sendTextToTerminal).toHaveBeenCalledWith(
            'caller-1',
            expect.stringContaining('alpha')
        )

        // Monitor should have self-cleaned (no cancel needed)
    })

    it('does not complete when idle agent has only context nodes', () => {
        const idleAgentData: TerminalData = makeIdleTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: idleAgentData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])

        // Only context nodes (isContextNode: true) — filtered out by isAgentComplete
        const contextNode: GraphNode = buildGraphNode('ctx-1.md', 'Context Node', 'alpha', true)
        vi.mocked(getGraph).mockReturnValue(buildGraph([contextNode]))
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 60_000)

        const monitorId: string = startMonitor('caller-1', ['agent-1'], 1000)

        // Advance several polls — never completes
        vi.advanceTimersByTime(5000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        cancelMonitor(monitorId)
    })

    it('keeps polling until ALL agents complete (not just the first)', () => {
        const agentAData: TerminalData = makeTerminalData('agent-a', 'alpha')
        const agentBData: TerminalData = makeTerminalData('agent-b', 'beta')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        // Both running initially
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'running'},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-a', 'agent-b'], 1000)

        // Poll 1: both running
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Agent A exits, B still running
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited'},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])

        // Poll 2: A done, B still running → no notification
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Agent B exits too
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited'},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'exited'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])

        // Poll 3: both done → notification
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
    })

    it('includes agent names and node titles in the completion message', () => {
        const agentAData: TerminalData = makeTerminalData('agent-a', 'alpha')
        const agentBData: TerminalData = makeTerminalData('agent-b', 'beta')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited'},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'exited'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])

        const nodeA: GraphNode = buildGraphNode('design.md', 'Design doc', 'alpha')
        const nodeB: GraphNode = buildGraphNode('impl.md', 'Implementation', 'beta')
        vi.mocked(getGraph).mockReturnValue(buildGraph([nodeA, nodeB]))

        startMonitor('caller-1', ['agent-a', 'agent-b'], 1000)

        vi.advanceTimersByTime(1000)

        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        expect(message).toContain('[WaitForAgents] All agents completed.')
        expect(message).toContain('alpha')
        expect(message).toContain('Design doc')
        expect(message).toContain('beta')
        expect(message).toContain('Implementation')
    })

    it('shows "(no nodes created)" for exited agent without progress nodes', () => {
        const agentData: TerminalData = makeTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-1'], 1000)
        vi.advanceTimersByTime(1000)

        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        expect(message).toContain('(no nodes created)')
    })

    it('does not complete idle agent when idleSince is null', () => {
        const idleAgentData: TerminalData = makeIdleTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: idleAgentData, status: 'running'},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running'}
        ])

        const progressNode: GraphNode = buildGraphNode('node-1.md', 'Progress', 'alpha')
        vi.mocked(getGraph).mockReturnValue(buildGraph([progressNode]))
        vi.mocked(getIdleSince).mockReturnValue(null)

        const _monitorId: string = startMonitor('caller-1', ['agent-1'], 1000)

        // Advance several polls — idleSince is null so never completes
        vi.advanceTimersByTime(5000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        cancelMonitor(_monitorId)
    })
})
