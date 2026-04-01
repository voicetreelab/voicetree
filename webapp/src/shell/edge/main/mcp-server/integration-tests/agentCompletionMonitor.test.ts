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

import {startMonitor, cancelMonitor, getPendingAgentNamesForCaller} from '@/shell/edge/main/mcp-server/agent-completion-monitor'
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
            {terminalId: 'agent-1', terminalData: agentData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
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
            {terminalId: 'agent-1', terminalData: agentData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-1'], 1000)

        // Poll 1: agent still running — no notification
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Agent exits
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
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
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
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
            {terminalId: 'agent-1', terminalData: agentData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        const monitorId: string = startMonitor('caller-1', ['agent-1'], 1000)

        // Cancel before any poll
        cancelMonitor(monitorId)

        // Agent exits
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
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
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
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

    it('completes idle agent after sustained idle >= 7s (no progress nodes required)', () => {
        const idleAgentData: TerminalData = makeIdleTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: idleAgentData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        // Idle only 5s (below SUSTAINED_IDLE_MS of 7s)
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 5_000)

        startMonitor('caller-1', ['agent-1'], 1000)

        // Poll 1: idle < 7s → not complete
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Set idle to 8s+ (above SUSTAINED_IDLE_MS of 7s)
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 8_000)

        // Poll 2: idle + sustained 8s → complete (even without progress nodes)
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        expect(sendTextToTerminal).toHaveBeenCalledWith(
            'caller-1',
            expect.stringContaining('alpha')
        )

        // Monitor should have self-cleaned (no cancel needed)
    })

    it('completes idle agent with only context nodes after sustained idle', () => {
        const idleAgentData: TerminalData = makeIdleTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: idleAgentData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        // Only context nodes (isContextNode: true) — previously blocked completion, now allowed
        const contextNode: GraphNode = buildGraphNode('ctx-1.md', 'Context Node', 'alpha', true)
        vi.mocked(getGraph).mockReturnValue(buildGraph([contextNode]))
        vi.mocked(getIdleSince).mockReturnValue(Date.now() - 60_000)

        startMonitor('caller-1', ['agent-1'], 1000)

        // Poll 1: idle + sustained 60s → complete (progress nodes no longer required)
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
    })

    it('keeps polling until ALL agents complete (not just the first)', () => {
        const agentAData: TerminalData = makeTerminalData('agent-a', 'alpha')
        const agentBData: TerminalData = makeTerminalData('agent-b', 'beta')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        // Both running initially
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'running', exitCode: null},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-a', 'agent-b'], 1000)

        // Poll 1: both running
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Agent A exits, B still running
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited', exitCode: null},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        // Poll 2: A done, B still running → no notification
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Agent B exits too
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited', exitCode: null},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'exited', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
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
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited', exitCode: null},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'exited', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        const nodeA: GraphNode = buildGraphNode('design.md', 'Design doc', 'alpha')
        const nodeB: GraphNode = buildGraphNode('impl.md', 'Implementation', 'beta')
        vi.mocked(getGraph).mockReturnValue(buildGraph([nodeA, nodeB]))

        startMonitor('caller-1', ['agent-a', 'agent-b'], 1000)

        vi.advanceTimersByTime(1000)

        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        expect(message).toContain('[WaitForAgents] Agent(s) completed.')
        expect(message).toContain('alpha')
        expect(message).toContain('Design doc')
        expect(message).toContain('beta')
        expect(message).toContain('Implementation')
    })

    it('shows "(no nodes created)" for exited agent without progress nodes', () => {
        const agentData: TerminalData = makeTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: agentData, status: 'exited', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))

        startMonitor('caller-1', ['agent-1'], 1000)
        vi.advanceTimersByTime(1000)

        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        expect(message).toContain('(no nodes created)')
    })

    it('BF-049 regression: idle agent with no progress nodes does not appear in "Still waiting on"', () => {
        const idleAgentAData: TerminalData = makeIdleTerminalData('agent-a', 'Ari')
        const agentBData: TerminalData = makeTerminalData('agent-b', 'Beth')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        // Ari is idle with sustained idle, Beth is still running
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: idleAgentAData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: Date.now() - 120_000},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: Date.now() - 120_000},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: Date.now() - 120_000}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph([]))
        // Ari has been idle for 60s — well above threshold
        vi.mocked(getIdleSince).mockImplementation((tid: string) =>
            tid === 'agent-a' ? Date.now() - 60_000 : null
        )

        // Start separate monitors for each agent (simulating separate wait_for_agents calls)
        const monitorA: string = startMonitor('caller-1', ['agent-a'], 1000)
        const monitorB: string = startMonitor('caller-1', ['agent-b'], 1000)

        // Before any poll, check pending names for caller excluding monitorA
        // Ari should NOT appear as pending because she is idle + sustained
        const pendingExcludingA: string[] = getPendingAgentNamesForCaller('caller-1', monitorA)
        // Beth should appear as pending (she's running)
        expect(pendingExcludingA).toContain('Beth')
        // Ari should NOT appear — she's idle and sustained (BF-049 fix)
        expect(pendingExcludingA).not.toContain('Ari')

        cancelMonitor(monitorA)
        cancelMonitor(monitorB)
    })

    it('does not complete idle agent when idleSince is null', () => {
        const idleAgentData: TerminalData = makeIdleTerminalData('agent-1', 'alpha')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-1', terminalData: idleAgentData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
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
