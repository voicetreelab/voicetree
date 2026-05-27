/**
 * Phase 2A: registry subscribers fire after mutations (except activity updates)
 *
 * BEHAVIOR TESTED:
 * - subscribers fire after recordTerminalSpawn
 * - subscribers fire after markTerminalExited
 * - subscribers fire after structural state updates (isDone, isPinned)
 * - subscribers do NOT fire after activity updates (performance: avoids re-renders)
 *
 * Spec Reference: consolidate-terminal-registry phase 2A
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {createTerminalData} from '../terminal-registry/types'
import type {TerminalData} from '../terminal-registry/types'
import type {TerminalRecord} from '../terminal-registry'
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
    updateTerminalPinned,
    updateTerminalActivityState,
    markTerminalExited,
    subscribeToRegistry
} from '../terminal-registry'

vi.mock('@vt/vt-daemon/agents/inject/send-text-to-terminal.ts', () => ({
    sendTextToTerminal: vi.fn().mockResolvedValue({ success: true })
}))

describe('Terminal Registry - Phase 2A: registry subscribers', () => {
    let receivedSnapshots: TerminalRecord[][]
    let unsubscribe: () => void

    beforeEach(() => {
        clearTerminalRecords()
        receivedSnapshots = []
        unsubscribe = subscribeToRegistry((records: TerminalRecord[]): void => {
            receivedSnapshots.push(records)
        })
    })

    afterEach(() => {
        unsubscribe()
    })

    describe('subscribers fire after recordTerminalSpawn', () => {
        it('passes the current records snapshot after spawn', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-spawn-node.md',
                terminalCount: 0,
                title: 'Sync Spawn Test'
            })

            recordTerminalSpawn('sync-spawn-node.md-terminal-0', terminalData)

            expect(receivedSnapshots).toHaveLength(1)
            const records: TerminalRecord[] = receivedSnapshots[0]
            expect(records).toHaveLength(1)
            expect(records[0].terminalId).toBe('sync-spawn-node.md-terminal-0')
        })
    })

    describe('subscribers fire after markTerminalExited', () => {
        it('passes the updated-status snapshot after exit', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-exit-node.md',
                terminalCount: 0,
                title: 'Sync Exit Test'
            })
            recordTerminalSpawn('sync-exit-node.md-terminal-0', terminalData)
            receivedSnapshots.length = 0

            markTerminalExited('sync-exit-node.md-terminal-0')

            expect(receivedSnapshots).toHaveLength(1)
            expect(receivedSnapshots[0][0].status).toBe('exited')
        })

        it('does not fire subscribers for non-existent terminal', () => {
            markTerminalExited('non-existent-terminal')

            expect(receivedSnapshots).toHaveLength(0)
        })
    })

    describe('subscribers fire after state updates', () => {
        it('fires after updateTerminalIsDone', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-done-node.md',
                terminalCount: 0,
                title: 'Sync Done Test'
            })
            recordTerminalSpawn('sync-done-node.md-terminal-0', terminalData)
            receivedSnapshots.length = 0

            updateTerminalIsDone('sync-done-node.md-terminal-0', true)

            expect(receivedSnapshots).toHaveLength(1)
            expect(receivedSnapshots[0][0].terminalData.isDone).toBe(true)
        })

        it('fires after updateTerminalPinned', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-pin-node.md',
                terminalCount: 0,
                title: 'Sync Pin Test',
                isPinned: false
            })
            recordTerminalSpawn('sync-pin-node.md-terminal-0', terminalData)
            receivedSnapshots.length = 0

            updateTerminalPinned('sync-pin-node.md-terminal-0', true)

            expect(receivedSnapshots).toHaveLength(1)
            expect(receivedSnapshots[0][0].terminalData.isPinned).toBe(true)
        })

        it('does NOT fire after updateTerminalActivityState (performance: avoids re-renders)', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-activity-node.md',
                terminalCount: 0,
                title: 'Sync Activity Test'
            })
            recordTerminalSpawn('sync-activity-node.md-terminal-0', terminalData)
            receivedSnapshots.length = 0

            updateTerminalActivityState('sync-activity-node.md-terminal-0', {activityCount: 5})

            expect(receivedSnapshots).toHaveLength(0)
            const records: TerminalRecord[] = getTerminalRecords()
            expect(records[0].terminalData.activityCount).toBe(5)
        })

        it('does not fire for non-existent terminal updates', () => {
            updateTerminalIsDone('non-existent-terminal', true)

            expect(receivedSnapshots).toHaveLength(0)
        })
    })
})
