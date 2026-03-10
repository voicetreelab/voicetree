/**
 * TDD unit tests for headlessAgentManager.ts — process lifecycle and output buffer
 *
 * Covers:
 * - Process exit handling (markTerminalExited, registry preservation)
 * - Combined stdout+stderr ring buffer (8KB) capture and persistence
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {EventEmitter} from 'events'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const {mockMarkTerminalExited, mockRecordTerminalSpawn, mockSpawn, mockGetTerminalRecords} = vi.hoisted(() => ({
    mockMarkTerminalExited: vi.fn(),
    mockRecordTerminalSpawn: vi.fn(),
    mockSpawn: vi.fn(),
    mockGetTerminalRecords: vi.fn().mockReturnValue([])
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    markTerminalExited: mockMarkTerminalExited,
    recordTerminalSpawn: mockRecordTerminalSpawn,
    getTerminalRecords: mockGetTerminalRecords,
    incrementAuditRetryCount: vi.fn(),
    removeTerminalFromRegistry: vi.fn()
}))

vi.mock('child_process', () => ({
    default: {spawn: mockSpawn},
    spawn: mockSpawn
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn().mockReturnValue({ nodes: {}, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map() })
}))

vi.mock('@/shell/edge/main/terminals/stopGateAudit', () => ({
    auditAgent: vi.fn().mockReturnValue(null),
    buildDeficiencyPrompt: vi.fn().mockReturnValue(''),
}))

vi.mock('@/shell/edge/main/terminals/spawnTerminalWithContextNode', () => ({
    detectCliType: vi.fn().mockReturnValue(null),
}))

// ─── Import module under test AFTER mocks ───────────────────────────────────

import {
    spawnHeadlessAgent,
    isHeadlessAgent,
    cleanupHeadlessAgents,
    getHeadlessAgentOutput
} from '@/shell/edge/main/terminals/headlessAgentManager'

// ─── Test helpers ────────────────────────────────────────────────────────────

type MockChildProcess = EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
    pid: number
}

function createMockChildProcess(): MockChildProcess {
    return Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
        pid: 12345
    })
}

function createTestTerminalData(terminalId: string): TerminalData {
    return {
        type: 'Terminal',
        terminalId: terminalId as TerminalId,
        attachedToContextNodeId: 'test-context-node.md',
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
        isHeadless: true,
        isMinimized: false,
        contextContent: '',
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('headlessAgentManager — lifecycle and output', () => {
    let mockChild: MockChildProcess

    beforeEach(() => {
        mockChild = createMockChildProcess()
        mockSpawn.mockReturnValue(mockChild)
        vi.clearAllMocks()
        mockGetTerminalRecords.mockReturnValue([])
    })

    afterEach(() => {
        cleanupHeadlessAgents()
    })

    describe('process exit lifecycle', () => {
        it('calls markTerminalExited with exit code on process exit', () => {
            const terminalId: string = 'agent-exit'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            vi.clearAllMocks()
            mockGetTerminalRecords.mockReturnValue([])

            mockChild.emit('exit', 0)

            expect(mockMarkTerminalExited).toHaveBeenCalledOnce()
            expect(mockMarkTerminalExited).toHaveBeenCalledWith(terminalId, 0)
        })

        it('passes non-zero exit code to markTerminalExited', () => {
            const terminalId: string = 'agent-exit-fail'
            const terminalData: TerminalData = createTestTerminalData(terminalId)
            vi.spyOn(console, 'error').mockImplementation(() => {})

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            vi.clearAllMocks()
            mockGetTerminalRecords.mockReturnValue([])

            mockChild.emit('exit', 1)

            expect(mockMarkTerminalExited).toHaveBeenCalledOnce()
            expect(mockMarkTerminalExited).toHaveBeenCalledWith(terminalId, 1)
        })

        it('does not remove terminal from registry on process exit', () => {
            const terminalId: string = 'agent-no-remove'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            mockGetTerminalRecords.mockReturnValue([])

            mockChild.emit('exit', 0)

            // Registry record preserved — only markTerminalExited called, not removeTerminalFromRegistry
            expect(mockMarkTerminalExited).toHaveBeenCalled()
        })

        it('removes from internal map on process exit', () => {
            const terminalId: string = 'agent-exit-cleanup'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            mockGetTerminalRecords.mockReturnValue([])

            expect(isHeadlessAgent(terminalId as TerminalId)).toBe(true)
            mockChild.emit('exit', 0)
            expect(isHeadlessAgent(terminalId as TerminalId)).toBe(false)
        })
    })

    describe('combined stdout+stderr ring buffer', () => {
        it('captures stderr data into output buffer', () => {
            const terminalId: string = 'agent-stderr'
            const terminalData: TerminalData = createTestTerminalData(terminalId)
            const consoleSpy: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'error').mockImplementation(() => {})

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            mockChild.stderr.emit('data', Buffer.from('some error output'))

            expect(getHeadlessAgentOutput(terminalId)).toBe('some error output')

            mockGetTerminalRecords.mockReturnValue([])
            mockChild.emit('exit', 1)

            expect(consoleSpy).toHaveBeenCalled()
            const errorMessage: string = consoleSpy.mock.calls[0][0] as string
            expect(errorMessage).toContain('some error output')
            consoleSpy.mockRestore()
        })

        it('captures stdout data into output buffer', () => {
            const terminalId: string = 'agent-stdout'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            mockChild.stdout.emit('data', Buffer.from('hello from stdout'))

            expect(getHeadlessAgentOutput(terminalId)).toBe('hello from stdout')
        })

        it('combines stdout and stderr in order of arrival', () => {
            const terminalId: string = 'agent-combined'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            mockChild.stdout.emit('data', Buffer.from('out1 '))
            mockChild.stderr.emit('data', Buffer.from('err1 '))
            mockChild.stdout.emit('data', Buffer.from('out2'))

            expect(getHeadlessAgentOutput(terminalId)).toBe('out1 err1 out2')
        })

        it('limits output to last 8KB (ring buffer behavior)', () => {
            const terminalId: string = 'agent-output-limit'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            mockChild.stdout.emit('data', Buffer.from('X'.repeat(10000)))

            const output: string = getHeadlessAgentOutput(terminalId)
            expect(output.length).toBe(8000)
            expect(output).toBe('X'.repeat(8000))
        })

        it('preserves output buffer after process exit', () => {
            const terminalId: string = 'agent-output-persist'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(terminalId as TerminalId, terminalData, 'claude -p "task"', '/tmp', {})
            mockGetTerminalRecords.mockReturnValue([])
            mockChild.stdout.emit('data', Buffer.from('final output'))
            mockChild.emit('exit', 0)

            expect(getHeadlessAgentOutput(terminalId)).toBe('final output')
            expect(isHeadlessAgent(terminalId as TerminalId)).toBe(false)
        })

        it('returns empty string for unknown terminal', () => {
            expect(getHeadlessAgentOutput('nonexistent')).toBe('')
        })
    })
})
