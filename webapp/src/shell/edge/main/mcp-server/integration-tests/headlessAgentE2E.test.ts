/**
 * E2E integration test: headless agent spawn + completion monitor + nested spawn.
 *
 * Uses REAL modules for child_process, terminal-registry, headlessAgentManager,
 * and agent-completion-monitor. Only mocks external/UI leaf dependencies.
 * Spawns real processes (echo commands) and verifies the completion monitor
 * detects when all agents have exited.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// ─── Mock external/UI leaf dependencies (must be before real imports) ────────

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn(() => ({
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }))
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn().mockResolvedValue({success: true})
}))

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {syncTerminals: vi.fn()}
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({autoNotifyUnseenNodes: false})
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn().mockResolvedValue([])
}))

// ─── Import real modules (after mocks) ──────────────────────────────────────

import {spawnHeadlessAgent, cleanupHeadlessAgents} from '@/shell/edge/main/terminals/headlessAgentManager'
import {startMonitor, cancelMonitor} from '@/shell/edge/main/mcp-server/agent-completion-monitor'
import {getTerminalRecords, clearTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// ─── Helpers ────────────────────────────────────────────────────────────────

const wait: (ms: number) => Promise<void> = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function makeHeadlessTerminalData(id: string, parentId: string): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${id}.md`,
        terminalCount: 0,
        title: id,
        agentName: id,
        isHeadless: true,
        parentTerminalId: parentId as TerminalId,
    })
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Headless agent e2e: spawn + monitor + nested spawn', () => {
    beforeEach(() => {
        clearTerminalRecords()
        vi.clearAllMocks()
    })

    afterEach(() => {
        cleanupHeadlessAgents()
        clearTerminalRecords()
    })

    it('spawns 3 headless agents with echo commands, one spawns a nested agent, monitor detects completion', async () => {
        // 1. Spawn 3 top-level headless agents with echo commands
        spawnHeadlessAgent('agent-1' as TerminalId, makeHeadlessTerminalData('agent-1', 'caller'), 'echo "agent-1 done"', '/tmp', {})
        spawnHeadlessAgent('agent-2' as TerminalId, makeHeadlessTerminalData('agent-2', 'caller'), 'echo "agent-2 done"', '/tmp', {})
        spawnHeadlessAgent('agent-3' as TerminalId, makeHeadlessTerminalData('agent-3', 'caller'), 'sleep 0.1 && echo "agent-3 done"', '/tmp', {})

        // 2. Simulate nested spawn: agent-2 spawns a 4th agent
        spawnHeadlessAgent(
            'agent-4-nested' as TerminalId,
            makeHeadlessTerminalData('agent-4-nested', 'agent-2'),
            'echo "agent-4 nested done"',
            '/tmp',
            {}
        )

        // 3. Start monitor for the 3 top-level agents only (100ms poll interval)
        const monitorId: string = startMonitor('caller', ['agent-1', 'agent-2', 'agent-3'], 100)

        // 4. Wait for echo processes to exit and monitor to poll
        await wait(1000)

        // 5. Observe registry state
        const records: TerminalRecord[] = getTerminalRecords()
        console.log('[e2e] Registry records:', records.map((r: TerminalRecord) => ({
            id: r.terminalId,
            status: r.status,
            exitCode: r.exitCode,
        })))

        // 6. Verify monitor fired completion message to caller
        expect(sendTextToTerminal).toHaveBeenCalledTimes(1)
        expect(sendTextToTerminal).toHaveBeenCalledWith(
            'caller',
            expect.stringContaining('[WaitForAgents] All agents completed.')
        )

        // 7. Inspect the completion message
        const message: string = vi.mocked(sendTextToTerminal).mock.calls[0][1]
        console.log('[e2e] Completion message:\n', message)

        expect(message).toContain('agent-1')
        expect(message).toContain('agent-2')
        expect(message).toContain('agent-3')
        // Nested agent SHOULD appear in completion (recursive wait discovers descendants)
        expect(message).toContain('agent-4-nested')
        // All agents exited with code 0
        expect(message).toContain('exited:0')

        cancelMonitor(monitorId)
    }, 5000)
})
