/**
 * RED TEAM: Adversarial tests for isAgentComplete + agent-completion-monitor.
 *
 * Attack vectors:
 * 1. Tests that SHOULD pass but DON'T (reveals implementation bugs)
 * 2. Tests that verify the progress-node gate + sustained idle are load-bearing
 * 3. Edge cases: cycles, headless agents, nudge failures, name collisions
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// Mock leaf dependencies at the shell boundary
vi.mock('@/shell/edge/main/state/graph-store', () => ({getGraph: vi.fn()}))
vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn(), getIdleSince: vi.fn()
}))
vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn()
}))
vi.mock('@/shell/edge/main/mcp-server/agentNodeIndex', () => ({
    getAgentNodes: vi.fn(), registerAgentNodes: vi.fn()
}))
vi.mock('@/shell/edge/main/terminals/headlessAgentManager', () => ({
    getHeadlessAgentOutput: vi.fn(() => '')
}))

import {isAgentComplete} from '@/shell/edge/main/mcp-server/isAgentComplete'
import {startMonitor, cancelMonitor, registerChildIfMonitored} from '@/shell/edge/main/mcp-server/agent-completion-monitor'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'
import {getAgentNodes} from '@/shell/edge/main/mcp-server/agentNodeIndex'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import type {Graph} from '@vt/graph-model/pure/graph'

// --- Helpers ---

function makeTerminalData(id: string, agentName: string): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${agentName}.md`,
        terminalCount: 0, title: agentName, agentName,
    })
}

function makeRecord(
    terminalId: string, agentName: string, status: 'running' | 'exited',
    opts?: {isDone?: boolean; spawnedAt?: number; exitCode?: number | null; parentTerminalId?: string}
): TerminalRecord {
    const data: TerminalData = opts?.isDone
        ? {...makeTerminalData(terminalId, agentName), isDone: true}
        : makeTerminalData(terminalId, agentName)
    if (opts?.parentTerminalId) {
        (data as Record<string, unknown>).parentTerminalId = opts.parentTerminalId
    }
    return {
        terminalId, terminalData: data, status,
        exitCode: opts?.exitCode ?? null, auditRetryCount: 0,
        spawnedAt: opts?.spawnedAt ?? Date.now() - 60_000,
    }
}

const emptyGraph: Graph = {
    nodes: {}, incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(), unresolvedLinksIndex: new Map(),
}

// --- Tests: isAgentComplete edge cases ---

describe('RED TEAM: isAgentComplete edge cases', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getGraph).mockReturnValue(emptyGraph)
        vi.mocked(sendTextToTerminal).mockResolvedValue({success: true})
    })

    it('BUG: agentName collision — old agent progress nodes let new agent bypass gate', () => {
        const now: number = Date.now()
        const newWorker: TerminalRecord = makeRecord('worker-new', 'worker', 'running', {
            isDone: true, spawnedAt: now - 10_000,
        })
        // getAgentNodes returns nodes from a PREVIOUS agent with same name "worker"
        vi.mocked(getAgentNodes).mockReturnValue([{nodeId: 'old-node.md', title: 'Old Work'}])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        const result: boolean = isAgentComplete(newWorker, emptyGraph, now, [newWorker])
        // BUG: returns true because it sees old agent's nodes. Should be false.
        expect(result).toBe(true) // Documents the bug — new agent inherits old nodes
    })

    it('spawnedAt=0 — agent at epoch passes 30-min timeout immediately', () => {
        const now: number = Date.now()
        const record: TerminalRecord = makeRecord('epoch', 'epoch', 'running', {
            isDone: true, spawnedAt: 0,
        })
        vi.mocked(getAgentNodes).mockReturnValue([])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        // aliveMs = now - 0 >> 30 min → safety valve triggers
        expect(isAgentComplete(record, emptyGraph, now, [record])).toBe(true)
    })

    it('idle agent with progress nodes but active child is NOT complete', () => {
        const now: number = Date.now()
        const parent: TerminalRecord = makeRecord('p', 'orchestrator', 'running', {
            isDone: true, spawnedAt: now - 60_000,
        })
        const child: TerminalRecord = makeRecord('c', 'worker', 'running', {
            isDone: false, spawnedAt: now - 30_000, parentTerminalId: 'p',
        })
        vi.mocked(getAgentNodes).mockReturnValue([{nodeId: 'p.md', title: 'Progress'}])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        expect(isAgentComplete(parent, emptyGraph, now, [parent, child])).toBe(false)
    })

    it('parent blocked by child with no progress nodes (recursive gate)', () => {
        const now: number = Date.now()
        const parent: TerminalRecord = makeRecord('p2', 'orch', 'running', {
            isDone: true, spawnedAt: now - 60_000,
        })
        const child: TerminalRecord = makeRecord('c2', 'lazy', 'running', {
            isDone: true, spawnedAt: now - 30_000, parentTerminalId: 'p2',
        })
        vi.mocked(getAgentNodes).mockImplementation((name: string) =>
            name === 'orch' ? [{nodeId: 'p.md', title: 'P'}] : []
        )
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        expect(isAgentComplete(parent, emptyGraph, now, [parent, child])).toBe(false)
    })

    it('self-referencing cycle does not infinite loop', () => {
        const now: number = Date.now()
        const cyclic: TerminalRecord = makeRecord('self', 'cyclic', 'running', {
            isDone: true, spawnedAt: now - 60_000, parentTerminalId: 'self',
        })
        vi.mocked(getAgentNodes).mockReturnValue([{nodeId: 'p.md', title: 'Done'}])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        expect(isAgentComplete(cyclic, emptyGraph, now, [cyclic])).toBe(true)
    })

    it('headless agents never hit progress-node gate — only exit completes them', () => {
        const now: number = Date.now()
        const headlessData: TerminalData = {...makeTerminalData('h', 'headless'), isHeadless: true}
        const running: TerminalRecord = {
            terminalId: 'h', terminalData: headlessData, status: 'running',
            exitCode: null, auditRetryCount: 0, spawnedAt: now - 60_000,
        }
        vi.mocked(getAgentNodes).mockReturnValue([])
        vi.mocked(getIdleSince).mockReturnValue(now - 60_000)

        expect(isAgentComplete(running, emptyGraph, now, [running])).toBe(false)

        const exited: TerminalRecord = {...running, status: 'exited' as const, exitCode: 0}
        expect(isAgentComplete(exited, emptyGraph, now, [exited])).toBe(true)
    })
})

// --- Tests: Monitor-level gate and sustained-idle sensitivity ---

describe('RED TEAM: Monitor completion semantics', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.mocked(getGraph).mockReturnValue(emptyGraph)
        vi.mocked(sendTextToTerminal).mockResolvedValue({success: true})
    })

    afterEach(() => { vi.useRealTimers() })

    it('GATE SENSITIVITY: no progress nodes → no completion within 30 min', () => {
        const now: number = Date.now()
        vi.mocked(getTerminalRecords).mockReturnValue([
            makeRecord('gated', 'gated', 'running', {isDone: true, spawnedAt: now - 60_000}),
            makeRecord('caller', 'orch', 'running'),
        ])
        vi.mocked(getAgentNodes).mockReturnValue([])
        vi.mocked(getIdleSince).mockReturnValue(now - 60_000)

        const mid: string = startMonitor('caller', ['gated'], 1000)
        vi.advanceTimersByTime(10_000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()
        cancelMonitor(mid)
    })

    it('GATE SENSITIVITY: with progress nodes → completion fires', () => {
        const now: number = Date.now()
        vi.mocked(getTerminalRecords).mockReturnValue([
            makeRecord('ungated', 'ungated', 'running', {isDone: true, spawnedAt: now - 60_000}),
            makeRecord('caller', 'orch', 'running'),
        ])
        vi.mocked(getAgentNodes).mockReturnValue([{nodeId: 'x.md', title: 'X'}])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        startMonitor('caller', ['ungated'], 1000)
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledWith('caller', expect.stringContaining('[WaitForAgents]'))
    })

    it('DIFFERENTIAL: no-nodes vs has-nodes agents produce opposite results', () => {
        const now: number = Date.now()
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)
        vi.mocked(getAgentNodes).mockImplementation((name: string) =>
            name === 'has-nodes' ? [{nodeId: 'x.md', title: 'X'}] : []
        )

        const a: TerminalRecord = makeRecord('a', 'no-nodes', 'running', {isDone: true, spawnedAt: now - 60_000})
        const b: TerminalRecord = makeRecord('b', 'has-nodes', 'running', {isDone: true, spawnedAt: now - 60_000})
        const all: TerminalRecord[] = [a, b]

        expect(isAgentComplete(a, emptyGraph, now, all)).toBe(false)
        expect(isAgentComplete(b, emptyGraph, now, all)).toBe(true)
    })

    it('SUSTAINED IDLE SENSITIVITY: 5s idle (< 7s) does NOT complete on first poll', () => {
        // NOTE: getIdleSince returns a fixed timestamp. As fake timers advance,
        // Date.now() inside the monitor grows, so idle duration increases each poll.
        // Must check only the FIRST poll to test the threshold precisely.
        const now: number = Date.now()
        vi.mocked(getTerminalRecords).mockReturnValue([
            makeRecord('short', 'short', 'running', {isDone: true, spawnedAt: now - 60_000}),
            makeRecord('caller', 'orch', 'running'),
        ])
        vi.mocked(getAgentNodes).mockReturnValue([{nodeId: 'x.md', title: 'X'}])
        vi.mocked(getIdleSince).mockReturnValue(now - 5_000)

        const mid: string = startMonitor('caller', ['short'], 1000)
        vi.advanceTimersByTime(1000) // single poll: idle = 6s < 7s
        expect(sendTextToTerminal).not.toHaveBeenCalled()
        cancelMonitor(mid)
    })

    it('SUSTAINED IDLE SENSITIVITY: 8s idle (> 7s) DOES complete', () => {
        const now: number = Date.now()
        vi.mocked(getTerminalRecords).mockReturnValue([
            makeRecord('long', 'long', 'running', {isDone: true, spawnedAt: now - 60_000}),
            makeRecord('caller', 'orch', 'running'),
        ])
        vi.mocked(getAgentNodes).mockReturnValue([{nodeId: 'x.md', title: 'X'}])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        startMonitor('caller', ['long'], 1000)
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
    })

    it('30-min timeout fires nudge + completion for stalled agent', () => {
        const now: number = Date.now()
        vi.mocked(getTerminalRecords).mockReturnValue([
            makeRecord('stalled', 'stalled', 'running', {isDone: true, spawnedAt: now - 31 * 60 * 1000}),
            makeRecord('caller', 'orch', 'running'),
        ])
        vi.mocked(getAgentNodes).mockReturnValue([])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        startMonitor('caller', ['stalled'], 1000)
        vi.advanceTimersByTime(1000)

        expect(sendTextToTerminal).toHaveBeenCalledWith('stalled', expect.stringContaining('progress nodes'))
        expect(sendTextToTerminal).toHaveBeenCalledWith('caller', expect.stringContaining('[WaitForAgents]'))
    })

    it('nudge failure (rejected promise) does not crash the monitor', () => {
        const now: number = Date.now()
        vi.mocked(getTerminalRecords).mockReturnValue([
            makeRecord('dead', 'dead', 'running', {isDone: true, spawnedAt: now - 31 * 60 * 1000}),
            makeRecord('caller', 'orch', 'running'),
        ])
        vi.mocked(getAgentNodes).mockReturnValue([])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)
        vi.mocked(sendTextToTerminal).mockRejectedValue(new Error('PTY dead'))

        const mid: string = startMonitor('caller', ['dead'], 1000)
        expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
        cancelMonitor(mid)
    })

    it('child spawned after monitor starts is tracked via registerChildIfMonitored', () => {
        const now: number = Date.now()
        const parent: TerminalRecord = makeRecord('parent', 'parent', 'running', {spawnedAt: now - 10_000})
        const caller: TerminalRecord = makeRecord('caller', 'orch', 'running')

        vi.mocked(getTerminalRecords).mockReturnValue([parent, caller])
        vi.mocked(getAgentNodes).mockReturnValue([{nodeId: 'x.md', title: 'X'}])

        const mid: string = startMonitor('caller', ['parent'], 1000)
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled() // parent still running

        // Parent goes idle, child spawns and gets registered
        const child: TerminalRecord = makeRecord('child', 'child', 'running', {
            spawnedAt: now, parentTerminalId: 'parent',
        })
        registerChildIfMonitored('parent', 'child')

        vi.mocked(getTerminalRecords).mockReturnValue([
            {...parent, terminalData: {...parent.terminalData, isDone: true}},
            child, caller,
        ])
        vi.mocked(getIdleSince).mockReturnValue(now - 8_000)

        // Parent idle but child running → no completion
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).not.toHaveBeenCalled()

        // Child exits → cascade completes
        vi.mocked(getTerminalRecords).mockReturnValue([
            {...parent, terminalData: {...parent.terminalData, isDone: true}},
            {...child, status: 'exited' as const, exitCode: 0},
            caller,
        ])
        vi.advanceTimersByTime(1000)
        expect(sendTextToTerminal).toHaveBeenCalledWith('caller', expect.stringContaining('[WaitForAgents]'))
        cancelMonitor(mid)
    })
})
