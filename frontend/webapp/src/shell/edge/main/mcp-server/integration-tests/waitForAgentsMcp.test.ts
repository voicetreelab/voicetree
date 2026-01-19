import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn()
}))

import {waitForAgentsTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'

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
            executeCommand: true
        })
        const terminalDataB: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-b.md',
            terminalCount: 1,
            title: 'Agent B',
            executeCommand: true
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

        const response: McpToolResponse = await waitForAgentsTool({
            terminalIds: ['agent-a-terminal-0', 'agent-b-terminal-1'],
            callerTerminalId: 'caller-terminal-2'
        })
        const payload: {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents).toHaveLength(2)
        expect(payload.agents[0]).toEqual({
            terminalId: 'agent-a-terminal-0',
            title: 'Agent A',
            status: 'exited'
        })
        expect(payload.agents[1]).toEqual({
            terminalId: 'agent-b-terminal-1',
            title: 'Agent B',
            status: 'exited'
        })
    })

    it('polls and returns when terminals exit', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true
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
            agents: Array<{terminalId: string; title: string; status: string}>
        } = parsePayload(response) as {
            success: boolean
            agents: Array<{terminalId: string; title: string; status: string}>
        }

        expect(payload.success).toBe(true)
        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]).toEqual({
            terminalId: 'agent-a-terminal-0',
            title: 'Agent A',
            status: 'exited'
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
})
