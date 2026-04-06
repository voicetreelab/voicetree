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
 * - closeAgentTool: delegates to closeHeadlessAgent for headless agents
 */

import {describe, it, expect, vi, beforeEach} from 'vitest'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {McpToolResponse} from '@/shell/edge/main/mcp-server/types'

// ─── Mocks (vi.hoisted ensures variables exist when vi.mock factories run) ─

const {mockGetTerminalRecords, mockRemoveTerminalFromRegistry, mockIsHeadlessAgent, mockKillHeadlessAgent, mockCloseHeadlessAgent, mockGetHeadlessAgentOutput, mockAuditAgent, mockBuildDeficiencyPrompt, mockRunStopHooks} = vi.hoisted(() => ({
    mockGetTerminalRecords: vi.fn(),
    mockRemoveTerminalFromRegistry: vi.fn(),
    mockIsHeadlessAgent: vi.fn(),
    mockKillHeadlessAgent: vi.fn(),
    mockCloseHeadlessAgent: vi.fn(),
    mockGetHeadlessAgentOutput: vi.fn(),
    mockAuditAgent: vi.fn(),
    mockBuildDeficiencyPrompt: vi.fn(),
    mockRunStopHooks: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: mockGetTerminalRecords,
    removeTerminalFromRegistry: mockRemoveTerminalFromRegistry,
    getIdleSince: vi.fn(() => null)
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
    closeHeadlessAgent: mockCloseHeadlessAgent,
    getHeadlessAgentOutput: mockGetHeadlessAgentOutput
}))

vi.mock('@/shell/edge/main/terminals/stopGateAudit', () => ({
    auditAgent: mockAuditAgent,
    buildDeficiencyPrompt: mockBuildDeficiencyPrompt
}))

vi.mock('@/shell/edge/main/terminals/stopGateHookRunner', () => ({
    runStopHooks: mockRunStopHooks
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
import {initGraphModel} from '@vt/graph-model'

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
        contextContent: '',
        ...overrides
    }

    return {
        terminalId,
        terminalData,
        status: 'running',
        exitCode: null,
        auditRetryCount: 0
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('MCP tool guards for headless agents', () => {
    const callerRecord: TerminalRecord = createTerminalRecord('caller-terminal', false)
    const headlessRecord: TerminalRecord = createTerminalRecord('headless-agent', true)
    const interactiveRecord: TerminalRecord = createTerminalRecord('interactive-agent', false)

    beforeEach(() => {
        initGraphModel({ appSupportPath: '/tmp/test-userdata-headless-guards' })
        vi.clearAllMocks()
        mockGetTerminalRecords.mockReturnValue([callerRecord, headlessRecord, interactiveRecord])
        mockIsHeadlessAgent.mockImplementation((id: string) => id === 'headless-agent')
        mockKillHeadlessAgent.mockReturnValue(true)
        mockCloseHeadlessAgent.mockImplementation((id: string) =>
            id === 'headless-agent' ? {closed: true, wasRunning: true} : {closed: false}
        )
        mockGetHeadlessAgentOutput.mockReturnValue('sample headless output from ring buffer')
        mockAuditAgent.mockReturnValue(null) // no SKILL.md → audit skipped
        mockBuildDeficiencyPrompt.mockReturnValue('STOP GATE AUDIT FAILED.')
        mockRunStopHooks.mockResolvedValue({passed: true, message: null})
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
        it('errors when closing a running (non-idle) agent without forceWithReason', async () => {
            const response: McpToolResponse = await closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('still running')
        })

        it('delegates to closeHeadlessAgent for headless terminals when forced', async () => {
            const response: McpToolResponse = await closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal',
                forceWithReason: 'test: verifying close delegation'
            })

            expect(mockCloseHeadlessAgent).toHaveBeenCalledWith('headless-agent')
            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(true)
        })

        it('returns success: false when agent is still running without forceWithReason', async () => {
            const response: McpToolResponse = await closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(false)
        })

        it('does not use uiAPI.closeTerminalById for headless agents', async () => {
            await closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal'
            })

            const {uiAPI} = await import('@/shell/edge/main/ui-api-proxy')
            expect(uiAPI.closeTerminalById).not.toHaveBeenCalled()
        })

        it('calls closeHeadlessAgent which handles registry cleanup', async () => {
            await closeAgentTool({
                terminalId: 'headless-agent',
                callerTerminalId: 'caller-terminal',
                forceWithReason: 'test: verifying registry cleanup'
            })

            expect(mockCloseHeadlessAgent).toHaveBeenCalledWith('headless-agent')
        })

        it('cleans up exited headless agent via closeHeadlessAgent', async () => {
            const exitedHeadlessRecord: TerminalRecord = {
                ...createTerminalRecord('exited-headless', true),
                status: 'exited',
                exitCode: 0
            }
            mockGetTerminalRecords.mockReturnValue([callerRecord, exitedHeadlessRecord])
            mockCloseHeadlessAgent.mockReturnValue({closed: true, wasRunning: false})

            const response: McpToolResponse = await closeAgentTool({
                terminalId: 'exited-headless',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(true)
            expect(mockCloseHeadlessAgent).toHaveBeenCalledWith('exited-headless')
            const {uiAPI} = await import('@/shell/edge/main/ui-api-proxy')
            expect(uiAPI.closeTerminalById).not.toHaveBeenCalled()
        })
    })

    describe('closeAgentTool — stop gate (self-close)', () => {
        it('calls runStopHooks on self-close', async () => {
            mockGetTerminalRecords.mockReturnValue([callerRecord])
            mockRunStopHooks.mockResolvedValue({passed: true, message: null})

            await closeAgentTool({terminalId: 'caller-terminal', callerTerminalId: 'caller-terminal'})

            expect(mockRunStopHooks).toHaveBeenCalled()
        })

        it('blocks self-close when stop hooks fail', async () => {
            mockGetTerminalRecords.mockReturnValue([callerRecord])
            mockRunStopHooks.mockResolvedValue({
                passed: false,
                message: 'Stop gate hooks failed'
            })

            const response: McpToolResponse = await closeAgentTool({
                terminalId: 'caller-terminal',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(false)
            expect(payload.error as string).toContain('Stop gate hooks failed')
        })

        it('allows self-close when stop hooks pass', async () => {
            mockGetTerminalRecords.mockReturnValue([callerRecord])
            mockRunStopHooks.mockResolvedValue({passed: true, message: null})

            const response: McpToolResponse = await closeAgentTool({
                terminalId: 'caller-terminal',
                callerTerminalId: 'caller-terminal'
            })

            const payload: Record<string, unknown> = parseResponsePayload(response)
            expect(payload.success).toBe(true)
        })

        it('calls runStopHooks with terminalId, graph, and records', async () => {
            mockGetTerminalRecords.mockReturnValue([callerRecord])
            mockRunStopHooks.mockResolvedValue({passed: true, message: null})

            await closeAgentTool({terminalId: 'caller-terminal', callerTerminalId: 'caller-terminal'})

            expect(mockRunStopHooks).toHaveBeenCalledWith(
                'caller-terminal',
                expect.objectContaining({nodes: {}}),
                [callerRecord]
            )
        })
    })
})
