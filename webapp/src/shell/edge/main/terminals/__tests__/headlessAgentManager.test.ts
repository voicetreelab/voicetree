/**
 * TDD unit tests for headlessAgentManager.ts
 *
 * Tests the API (spawn, kill, isHeadless, getHeadlessAgentOutput) and process lifecycle:
 * - child_process.spawn configuration (stdio, detached)
 * - Registry integration (recordTerminalSpawn, markTerminalExited)
 * - Combined stdout+stderr ring buffer capture (8KB)
 * - Process exit cleanup (output preserved after exit)
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {EventEmitter} from 'events'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// ─── Mocks (vi.hoisted ensures variables exist when vi.mock factories run) ─

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

// ─── Import module under test AFTER mocks ──────────────────────────────────

import {
    spawnHeadlessAgent,
    killHeadlessAgent,
    isHeadlessAgent,
    cleanupHeadlessAgents
} from '@/shell/edge/main/terminals/headlessAgentManager'

// ─── Test helpers ──────────────────────────────────────────────────────────

type MockChildProcess = EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
    pid: number
}

function createMockChildProcess(): MockChildProcess {
    const child: MockChildProcess = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
        pid: 12345
    })
    return child
}

/**
 * Create a minimal TerminalData object for test purposes.
 * Uses fp-ts Option.none for anchoredToNodeId since headless agents
 * don't need shadow node anchoring in these tests.
 */
function createTestTerminalData(terminalId: string): TerminalData {
    // Import dynamically to avoid circular issues, but since we mock terminal-registry
    // we can construct a minimal shape that matches the TerminalData type
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('headlessAgentManager', () => {
    let mockChild: MockChildProcess

    beforeEach(() => {
        mockChild = createMockChildProcess()
        mockSpawn.mockReturnValue(mockChild)
        vi.clearAllMocks()
    })

    afterEach(() => {
        cleanupHeadlessAgents()
    })

    describe('spawnHeadlessAgent', () => {
        it('spawns child_process with stdio [ignore, pipe, pipe] to capture stdout+stderr', () => {
            const terminalId: string = 'agent-1'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "do stuff"',
                '/tmp/work',
                {VOICETREE_TERMINAL_ID: terminalId}
            )

            expect(mockSpawn).toHaveBeenCalledOnce()
            const spawnArgs: unknown[] = mockSpawn.mock.calls[0]
            // Third argument is the options object
            const options: Record<string, unknown> = spawnArgs[2] as Record<string, unknown>
            expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
        })

        it('spawns with detached: false to ensure cleanup on Electron exit', () => {
            const terminalId: string = 'agent-detach'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "task"',
                '/tmp',
                {}
            )

            const options: Record<string, unknown> = mockSpawn.mock.calls[0][2] as Record<string, unknown>
            expect(options.detached).toBe(false)
        })

        it('merges provided env vars with process.env', () => {
            const terminalId: string = 'agent-env'
            const terminalData: TerminalData = createTestTerminalData(terminalId)
            const customEnv: Record<string, string> = {
                VOICETREE_TERMINAL_ID: 'agent-env',
                CUSTOM_VAR: 'hello'
            }

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "task"',
                '/tmp',
                customEnv
            )

            const options: Record<string, unknown> = mockSpawn.mock.calls[0][2] as Record<string, unknown>
            const env: Record<string, string> = options.env as Record<string, string>
            expect(env.VOICETREE_TERMINAL_ID).toBe('agent-env')
            expect(env.CUSTOM_VAR).toBe('hello')
        })

        it('calls recordTerminalSpawn to register in terminal-registry', () => {
            const terminalId: string = 'agent-registry'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "task"',
                '/tmp',
                {}
            )

            expect(mockRecordTerminalSpawn).toHaveBeenCalledOnce()
            expect(mockRecordTerminalSpawn).toHaveBeenCalledWith(terminalId, terminalData)
        })

        it('passes command through shell with -c flag', () => {
            const terminalId: string = 'agent-cmd'
            const terminalData: TerminalData = createTestTerminalData(terminalId)
            const command: string = 'claude -p "fix the auth bug" --mcp-config voicetree'

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                command,
                '/tmp',
                {}
            )

            const shellArgs: string[] = mockSpawn.mock.calls[0][1] as string[]
            expect(shellArgs).toEqual(['-c', command])
        })
    })

    describe('killHeadlessAgent', () => {
        it('sends SIGTERM and returns true for known terminal', () => {
            const terminalId: string = 'agent-kill'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "task"',
                '/tmp',
                {}
            )

            const result: boolean = killHeadlessAgent(terminalId as TerminalId)

            expect(result).toBe(true)
            expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM')
        })

        it('returns false for unknown terminal ID', () => {
            const result: boolean = killHeadlessAgent('nonexistent-agent' as TerminalId)
            expect(result).toBe(false)
        })

        it('calls markTerminalExited on kill', () => {
            const terminalId: string = 'agent-exit-on-kill'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "task"',
                '/tmp',
                {}
            )
            vi.clearAllMocks() // Clear spawn-time calls

            killHeadlessAgent(terminalId as TerminalId)

            expect(mockMarkTerminalExited).toHaveBeenCalledOnce()
            expect(mockMarkTerminalExited).toHaveBeenCalledWith(terminalId)
        })

        it('removes terminal from internal map after kill', () => {
            const terminalId: string = 'agent-remove'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "task"',
                '/tmp',
                {}
            )

            expect(isHeadlessAgent(terminalId as TerminalId)).toBe(true)

            killHeadlessAgent(terminalId as TerminalId)

            expect(isHeadlessAgent(terminalId as TerminalId)).toBe(false)
        })
    })

    describe('isHeadlessAgent', () => {
        it('returns true for a spawned headless agent', () => {
            const terminalId: string = 'agent-check'
            const terminalData: TerminalData = createTestTerminalData(terminalId)

            spawnHeadlessAgent(
                terminalId as TerminalId,
                terminalData,
                'claude -p "task"',
                '/tmp',
                {}
            )

            expect(isHeadlessAgent(terminalId as TerminalId)).toBe(true)
        })

        it('returns false for a non-existent terminal', () => {
            expect(isHeadlessAgent('pty-terminal-123' as TerminalId)).toBe(false)
        })

        it('accepts string type (not just branded TerminalId)', () => {
            // The function signature accepts TerminalId | string
            expect(isHeadlessAgent('some-string')).toBe(false)
        })
    })

    describe('cleanupHeadlessAgents', () => {
        it('kills all spawned headless agents', () => {
            const child1: MockChildProcess = createMockChildProcess()
            const child2: MockChildProcess = createMockChildProcess()
            mockSpawn.mockReturnValueOnce(child1).mockReturnValueOnce(child2)

            spawnHeadlessAgent('a1' as TerminalId, createTestTerminalData('a1'), 'cmd1', '/tmp', {})
            spawnHeadlessAgent('a2' as TerminalId, createTestTerminalData('a2'), 'cmd2', '/tmp', {})

            expect(isHeadlessAgent('a1' as TerminalId)).toBe(true)
            expect(isHeadlessAgent('a2' as TerminalId)).toBe(true)

            cleanupHeadlessAgents()

            expect(child1.kill).toHaveBeenCalledWith('SIGTERM')
            expect(child2.kill).toHaveBeenCalledWith('SIGTERM')
            expect(isHeadlessAgent('a1' as TerminalId)).toBe(false)
            expect(isHeadlessAgent('a2' as TerminalId)).toBe(false)
        })
    })
})
