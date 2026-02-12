import {describe, it, expect, vi, beforeEach} from 'vitest'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn(),
}))

vi.mock('@/shell/edge/main/mcp-server/agent-completion-monitor', () => ({
    startMonitor: vi.fn(),
}))

import {waitForAgentsTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
import {startMonitor} from '@/shell/edge/main/mcp-server/agent-completion-monitor'

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

describe('MCP wait_for_agents tool (async)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns immediately with monitorId and status "monitoring"', () => {
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
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(startMonitor).mockReturnValue('monitor-1')

        const response: McpToolResponse = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1'
        })
        const payload: {
            monitorId: string
            status: string
            terminalIds: string[]
        } = parsePayload(response) as {
            monitorId: string
            status: string
            terminalIds: string[]
        }

        expect(response.isError).toBeUndefined()
        expect(payload.monitorId).toBe('monitor-1')
        expect(payload.status).toBe('monitoring')
        expect(payload.terminalIds).toEqual(['agent-a-terminal-0'])
    })

    it('calls startMonitor with correct arguments', () => {
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
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(startMonitor).mockReturnValue('monitor-1')

        waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1',
            pollIntervalMs: 3000
        })

        expect(startMonitor).toHaveBeenCalledWith('caller-terminal-1', ['agent-a-terminal-0'], 3000)
    })

    it('uses default pollIntervalMs when not provided', () => {
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
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'caller-terminal-1', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(startMonitor).mockReturnValue('monitor-1')

        waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'caller-terminal-1'
        })

        expect(startMonitor).toHaveBeenCalledWith('caller-terminal-1', ['agent-a-terminal-0'], 5000)
    })

    it('returns error when caller terminal ID is unknown', () => {
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

        const response: McpToolResponse = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0'],
            callerTerminalId: 'unknown-caller'
        })
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Unknown caller: unknown-caller')
        expect(startMonitor).not.toHaveBeenCalled()
    })

    it('returns error when target terminal ID is unknown', () => {
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

        const response: McpToolResponse = waitForAgentsTool({
            terminalIds: ['unknown-terminal'],
            callerTerminalId: 'caller-terminal-0'
        })
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Unknown terminal: unknown-terminal')
        expect(startMonitor).not.toHaveBeenCalled()
    })

    it('handles multiple target terminals', () => {
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
            {terminalId: 'agent-a-terminal-0', terminalData: terminalDataA, status: 'running'},
            {terminalId: 'agent-b-terminal-1', terminalData: terminalDataB, status: 'running'},
            {terminalId: 'caller-terminal-2', terminalData: callerTerminalData, status: 'running'}
        ]

        vi.mocked(getTerminalRecords).mockReturnValue(records)
        vi.mocked(startMonitor).mockReturnValue('monitor-1')

        const response: McpToolResponse = waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0', 'agent-b-terminal-1'],
            callerTerminalId: 'caller-terminal-2'
        })
        const payload: {
            monitorId: string
            status: string
            terminalIds: string[]
        } = parsePayload(response) as {
            monitorId: string
            status: string
            terminalIds: string[]
        }

        expect(payload.monitorId).toBe('monitor-1')
        expect(payload.status).toBe('monitoring')
        expect(payload.terminalIds).toEqual(['agent-a-terminal-0', 'agent-b-terminal-1'])
        expect(startMonitor).toHaveBeenCalledWith(
            'caller-terminal-2',
            ['agent-a-terminal-0', 'agent-b-terminal-1'],
            5000
        )
    })
})
