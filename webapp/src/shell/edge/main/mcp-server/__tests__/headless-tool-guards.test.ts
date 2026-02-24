/**
 * TDD unit tests for MCP tool behavior with headless agents.
 *
 * Headless agents have no PTY/stdin — sendMessage rejects.
 * readTerminalOutput now returns captured stdout+stderr ring buffer instead of error.
 *
 * Tests cover:
 * - sendMessageTool: rejects messages to headless agents
 * - readTerminalOutputTool: returns ring buffer output for headless agents
 * - listAgentsTool: includes isHeadless flag per agent
 * - closeAgentTool: delegates to killHeadlessAgent for headless agents
 */

import {describe, it, expect, vi, beforeEach} from 'vitest'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {McpToolResponse} from '@/shell/edge/main/mcp-server/types'

// ─── Mocks (vi.hoisted ensures variables exist when vi.mock factories run) ─

const {mockGetTerminalRecords, mockIsHeadlessAgent, mockKillHeadlessAgent, mockGetHeadlessAgentOutput} = vi.hoisted(() => ({
    mockGetTerminalRecords: vi.fn(),
    mockIsHeadlessAgent: vi.fn(),
    mockKillHeadlessAgent: vi.fn(),
    mockGetHeadlessAgentOutput: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: mockGetTerminalRecords
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-output-buffer', () => ({
    getOutput: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn(() => ({nodes: {}, edges: {}, nodeByBaseName: {}}))
}))

vi.mock('@/shell/edge/main/terminals/headlessAgentManager', () => ({
    isHeadlessAgent: mockIsHeadlessAgent,
    killHeadlessAgent: mockKillHeadlessAgent,
    getHeadlessAgentOutput: mockGetHeadlessAgentOutput
}))

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {
        closeTerminalById: vi.fn(),
        onSettingsChanged: vi.fn()
    }
}))

vi.mock('@/shell/edge/main/mcp-server/getNewNodesForAgent', () => ({
    getNewNodesForAgent: vi.fn(() => [{nodeId: 'some-node.md', title: 'Some Node'}])
}))

// ─── Import tools under test AFTER mocks ───────────────────────────────────

import {sendMessageTool} from '@/shell/edge/main/mcp-server/sendMessageTool'
import {readTerminalOutputTool} from '@/shell/edge/main/mcp-server/readTerminalOutputTool'
import {listAgentsTool} from '@/shell/edge/main/mcp-server/listAgentsTool'
import {closeAgentTool} from '@/shell/edge/main/mcp-server/closeAgentTool'

// ─── Test helpers ──────────────────────────────────────────────────────────

function parseResponsePayload(response: McpToolResponse): Record<string, unknown> {
    return JSON.parse(response.content[0].text) as Record<string, unknown>
}

function createTerminalRecord(
    terminalId: string,
    isHeadless: boolean,
    overrides: Partial<TerminalData> = {}
): TerminalRecord {
    const terminalData: TerminalData = {
        type: 'Terminal',
        terminalId: terminalId as TerminalId,
        attachedToContextNodeId: 'ctx-node.md',
        terminalCount: 0,
        title: `Agent ${terminalId}`,
        anchoredToNodeId: {_tag: 'None'} as TerminalData['anchoredToNodeId'],
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lastOutputTime: Date.now(),
        activityCount: 0,
        parentTerminalId: null,
        agentName: terminalId,
        worktreeName: undefined,
        isHeadless,
        executeCommand: true,
        isMinimized: false,
        ...overrides
    }

    return {
        terminalId,
        terminalData,
        status: 'running'
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('MCP tool guards for headless agents', () => {
    const callerRecord: TerminalRecord = createTerminalRecord('caller-terminal', false)
    const headlessRecord: TerminalRecord = createTerminalRecord('headless-agent', true)
    const interactiveRecord: TerminalRecord = createTerminalRecord('interactive-agent', false)

    beforeEach(() => {
        vi.clearAllMocks()
        mockGetTerminalRecords.mockReturnValue([callerRecord, headlessRecord, interactiveRecord])
        mockIsHeadlessAgent.mockImplementation((id: string) => id === 'headless-agent')
        mockKillHeadlessAgent.mockReturnValue(true)
        mockGetHeadlessAgentOutput.mockReturnValue('sample headless output from ring buffer')
    })

    describe('sendMessageTool', () => {
        it('returns error when target is a headless agent', async () => {
            const response: McpToolResponse = await sendMessageTool({
                terminalId: 'headless-agent',
                message: 'Hello!',
                callerTerminalId: 'caller-terminal'
            })

            expect(response.isError).toBe(true)
            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('headless')
        })

        it('error message guides caller to use task node for work assignment', async () => {
            const response: McpToolResponse = await sendMessageTool({
                terminalId: 'headless-agent',
                message: 'Hello!',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            const error: string = payload.error as string
            // Error should mention that headless agents receive work via task node
            expect(error.toLowerCase()).toContain('task node')
        })

        it('allows messages to interactive (non-headless) agents', async () => {
            // This test verifies that the guard only blocks headless targets
            // The actual sendTextToTerminal is mocked so the call won't fail
            const {sendTextToTerminal} = await import('@/shell/edge/main/terminals/send-text-to-terminal')
            vi.mocked(sendTextToTerminal).mockResolvedValue({success: true})

            const response: McpToolResponse = await sendMessageTool({
                terminalId: 'interactive-agent',
                message: 'Hello!',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(true)
        })
    })

    describe('readTerminalOutputTool', () => {
        it('returns captured ring buffer output for headless agents', async () => {
            const response: McpToolResponse = await readTerminalOutputTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            expect(response.isError).toBeUndefined()
            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(true)
            expect(payload.output).toBe('sample headless output from ring buffer')
            expect(payload.isHeadless).toBe(true)
        })

        it('calls getHeadlessAgentOutput with the correct terminalId', async () => {
            await readTerminalOutputTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            expect(mockGetHeadlessAgentOutput).toHaveBeenCalledWith('headless-agent')
        })

        it('returns empty output when headless agent has no output yet', async () => {
            mockGetHeadlessAgentOutput.mockReturnValue('')

            const response: McpToolResponse = await readTerminalOutputTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(true)
            expect(payload.output).toBe('')
        })
    })

    describe('listAgentsTool', () => {
        it('includes isHeadless field in response for each agent', async () => {
            const response: McpToolResponse = await listAgentsTool()

            const payload: Record<string, unknown> = parseResponsePayload(response)
            const agents: Array<Record<string, unknown>> = payload.agents as Array<Record<string, unknown>>

            // Should have both executeCommand: true agents (headless + interactive)
            // The caller-terminal also has executeCommand: true by our setup
            expect(agents.length).toBeGreaterThanOrEqual(2)

            // Find the headless agent in the response
            const headlessAgent: Record<string, unknown> | undefined = agents.find(
                (a: Record<string, unknown>) => a.terminalId === 'headless-agent'
            )
            expect(headlessAgent).toBeDefined()
            expect(headlessAgent?.isHeadless).toBe(true)

            // Find the interactive agent in the response
            const interactiveAgent: Record<string, unknown> | undefined = agents.find(
                (a: Record<string, unknown>) => a.terminalId === 'interactive-agent'
            )
            expect(interactiveAgent).toBeDefined()
            expect(interactiveAgent?.isHeadless).toBe(false)
        })
    })

    describe('closeAgentTool', () => {
        it('delegates to killHeadlessAgent for headless terminals', () => {
            const response: McpToolResponse = closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            expect(mockKillHeadlessAgent).toHaveBeenCalledOnce()
            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(true)
        })

        it('returns success: false when headless agent is not found', () => {
            mockKillHeadlessAgent.mockReturnValue(false)

            const response: McpToolResponse = closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(false)
        })

        it('does not use uiAPI.closeTerminalById for headless agents', async () => {
            closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            const {uiAPI} = await import('@/shell/edge/main/ui-api-proxy')
            expect(uiAPI.closeTerminalById).not.toHaveBeenCalled()
        })
    })
})
