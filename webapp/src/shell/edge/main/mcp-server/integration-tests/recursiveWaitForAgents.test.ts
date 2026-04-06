import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// Mock leaf dependencies
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

vi.mock('@/shell/edge/main/mcp-server/agentNodeIndex', () => ({
    getAgentNodes: vi.fn().mockReturnValue([{nodeId: 'progress.md', title: 'Progress'}]),
    registerAgentNodes: vi.fn()
}))

import {startMonitor, registerChildIfMonitored} from '@/shell/edge/main/mcp-server/agent-completion-monitor'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'
import type {Graph} from '@vt/graph-model/pure/graph'

// --- Helpers ---

function buildGraph(): Graph {
    return {
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

function makeTerminalData(id: string, agentName: string, parentTerminalId?: string): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${agentName}.md`,
        terminalCount: 0,
        title: agentName,
        agentName,
        parentTerminalId: parentTerminalId as TerminalId | undefined
    })
}

// --- Tests ---

describe('Recursive wait_for_agents', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.mocked(sendTextToTerminal).mockResolvedValue({success: true})
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('picks up child spawned before wait_for_agents via initial BFS scan', () => {
        const parentData: TerminalData = makeTerminalData('agent-a', 'alpha', 'caller-1')
        const childData: TerminalData = makeTerminalData('agent-b', 'beta', 'agent-a')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        // Both parent and child exist before monitor starts — child still running
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: parentData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-b', terminalData: childData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph())

        // Monitor only watches agent-a, but findExistingDescendants should discover agent-b
        startMonitor('caller-1', ['agent-a'], 1000)

        // Poll 1: agent-a exited but agent-b still running — no notification
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // agent-b exits
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: parentData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-b', terminalData: childData, status: 'exited', exitCode: 0},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        // Poll 2: both done — notification includes both agents
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        expect(message).toContain('alpha')
        expect(message).toContain('beta')
    })

    it('picks up child spawned after monitor starts via registerChildIfMonitored', () => {
        const parentData: TerminalData = makeTerminalData('agent-a', 'alpha', 'caller-1')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: parentData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph())

        startMonitor('caller-1', ['agent-a'], 1000)

        // Child spawns after monitor starts
        const childData: TerminalData = makeTerminalData('agent-b', 'beta', 'agent-a')
        registerChildIfMonitored('agent-a', 'agent-b')

        // Parent exits but child still running
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: parentData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-b', terminalData: childData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Child exits
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: parentData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-b', terminalData: childData, status: 'exited', exitCode: 0},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        expect(message).toContain('alpha')
        expect(message).toContain('beta')
    })

    it('waits on transitive chain A→B→C via registerChildIfMonitored', () => {
        const agentAData: TerminalData = makeTerminalData('agent-a', 'alpha', 'caller-1')
        const callerData: TerminalData = makeTerminalData('caller-1', 'caller')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])
        vi.mocked(getGraph).mockReturnValue(buildGraph())

        startMonitor('caller-1', ['agent-a'], 1000)

        // A spawns B
        const agentBData: TerminalData = makeTerminalData('agent-b', 'beta', 'agent-a')
        registerChildIfMonitored('agent-a', 'agent-b')

        // B spawns C — transitive: B is now in the list, so C gets added too
        const agentCData: TerminalData = makeTerminalData('agent-c', 'gamma', 'agent-b')
        registerChildIfMonitored('agent-b', 'agent-c')

        // A and B exit, C still running
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-c', terminalData: agentCData, status: 'running', exitCode: null},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // C exits
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'agent-a', terminalData: agentAData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-b', terminalData: agentBData, status: 'exited', exitCode: 0},
            {terminalId: 'agent-c', terminalData: agentCData, status: 'exited', exitCode: 0},
            {terminalId: 'caller-1', terminalData: callerData, status: 'running', exitCode: null}
        ])

        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        expect(message).toContain('alpha')
        expect(message).toContain('beta')
        expect(message).toContain('gamma')
    })
})
