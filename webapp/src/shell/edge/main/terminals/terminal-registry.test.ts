/**
 * Tests for terminal-registry.ts - Phase 1: Expand Registry
 *
 * BEHAVIOR TESTED:
 * - recordTerminalSpawn stores full TerminalData including isPinned, lastOutputTime, activityCount
 * - getTerminalRecords returns complete TerminalRecord with all fields
 * - updateTerminalIsDone correctly updates the record
 * - updateTerminalPinned correctly updates isPinned
 * - updateTerminalActivityState correctly updates activity fields
 *
 * Spec Reference: consolidate-terminal-registry phase 1
 */

import {describe, it, expect, beforeEach, vi, type Mock} from 'vitest'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
    updateTerminalPinned,
    updateTerminalActivityState,
    markTerminalExited
} from '@/shell/edge/main/terminals/terminal-registry'

// Mock uiAPI for Phase 2A tests
vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {
        syncTerminals: vi.fn()
    }
}))

describe('Terminal Registry - Phase 1: Expand Registry', () => {
    beforeEach(() => {
        clearTerminalRecords()
    })

    describe('recordTerminalSpawn stores full TerminalData', () => {
        it('stores isPinned, lastOutputTime, and activityCount from TerminalData', () => {
            // GIVEN: A terminal data with specific tab UI state
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'test-node.md',
                terminalCount: 0,
                title: 'Test Terminal',
                isPinned: false  // Explicitly set to non-default
            })

            // WHEN: Recording the spawn
            recordTerminalSpawn('test-node.md-terminal-0', terminalData)

            // THEN: All fields should be stored
            const records: TerminalRecord[] = getTerminalRecords()
            expect(records).toHaveLength(1)

            const record: TerminalRecord = records[0]
            expect(record.terminalData.isPinned).toBe(false)
            expect(record.terminalData.lastOutputTime).toBeTypeOf('number')
            expect(record.terminalData.activityCount).toBe(0)
            expect(record.terminalData.isDone).toBe(false)
        })

        it('stores agentName when provided', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'agent-node.md',
                terminalCount: 0,
                title: 'Agent Terminal',
                agentName: 'test-agent-123'
            })

            recordTerminalSpawn('agent-node.md-terminal-0', terminalData)

            const records: TerminalRecord[] = getTerminalRecords()
            expect(records[0].terminalData.agentName).toBe('test-agent-123')
        })
    })

    describe('getTerminalRecords returns complete TerminalRecord', () => {
        it('returns all fields from TerminalData in TerminalRecord', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'complete-node.md',
                terminalCount: 1,
                title: 'Complete Terminal',
                isPinned: true,
                initialEnvVars: {TEST_VAR: 'value'},
                initialSpawnDirectory: '/test/dir',
                initialCommand: 'echo hello',
                executeCommand: true,
                parentTerminalId: 'parent-terminal' as TerminalId,
                agentName: 'test-agent'
            })

            recordTerminalSpawn('complete-node.md-terminal-1', terminalData)

            const records: TerminalRecord[] = getTerminalRecords()
            const record: TerminalRecord = records[0]

            // Verify all TerminalData fields are accessible
            expect(record.terminalId).toBe('complete-node.md-terminal-1')
            expect(record.status).toBe('running')
            expect(record.terminalData.type).toBe('Terminal')
            expect(record.terminalData.attachedToContextNodeId).toBe('complete-node.md')
            expect(record.terminalData.terminalCount).toBe(1)
            expect(record.terminalData.title).toBe('Complete Terminal')
            expect(record.terminalData.isPinned).toBe(true)
            expect(record.terminalData.isDone).toBe(false)
            expect(record.terminalData.lastOutputTime).toBeTypeOf('number')
            expect(record.terminalData.activityCount).toBe(0)
            expect(record.terminalData.initialEnvVars).toEqual({TEST_VAR: 'value'})
            expect(record.terminalData.initialSpawnDirectory).toBe('/test/dir')
            expect(record.terminalData.initialCommand).toBe('echo hello')
            expect(record.terminalData.executeCommand).toBe(true)
            expect(record.terminalData.parentTerminalId).toBe('parent-terminal')
            expect(record.terminalData.agentName).toBe('test-agent')
        })
    })

    describe('updateTerminalIsDone correctly updates the record', () => {
        it('sets isDone to true for existing terminal', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'done-test-node.md',
                terminalCount: 0,
                title: 'Done Test Terminal'
            })
            recordTerminalSpawn('done-test-node.md-terminal-0', terminalData)

            // Initially isDone should be false
            expect(getTerminalRecords()[0].terminalData.isDone).toBe(false)

            // WHEN: Updating isDone
            updateTerminalIsDone('done-test-node.md-terminal-0', true)

            // THEN: isDone should be updated
            expect(getTerminalRecords()[0].terminalData.isDone).toBe(true)
        })

        it('sets isDone to false for existing terminal', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'undone-test-node.md',
                terminalCount: 0,
                title: 'Undone Test Terminal'
            })
            recordTerminalSpawn('undone-test-node.md-terminal-0', terminalData)
            updateTerminalIsDone('undone-test-node.md-terminal-0', true)

            // WHEN: Setting isDone back to false
            updateTerminalIsDone('undone-test-node.md-terminal-0', false)

            // THEN: isDone should be false
            expect(getTerminalRecords()[0].terminalData.isDone).toBe(false)
        })

        it('does nothing for non-existent terminal', () => {
            // WHEN: Updating a non-existent terminal
            updateTerminalIsDone('non-existent-terminal', true)

            // THEN: No error, records remain empty
            expect(getTerminalRecords()).toHaveLength(0)
        })
    })

    describe('updateTerminalPinned correctly updates isPinned', () => {
        it('sets isPinned to false for existing terminal', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'pin-test-node.md',
                terminalCount: 0,
                title: 'Pin Test Terminal',
                isPinned: true
            })
            recordTerminalSpawn('pin-test-node.md-terminal-0', terminalData)

            // Initially isPinned should be true
            expect(getTerminalRecords()[0].terminalData.isPinned).toBe(true)

            // WHEN: Updating isPinned
            updateTerminalPinned('pin-test-node.md-terminal-0', false)

            // THEN: isPinned should be updated
            expect(getTerminalRecords()[0].terminalData.isPinned).toBe(false)
        })

        it('sets isPinned to true for existing terminal', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'unpin-test-node.md',
                terminalCount: 0,
                title: 'Unpin Test Terminal',
                isPinned: false
            })
            recordTerminalSpawn('unpin-test-node.md-terminal-0', terminalData)

            // WHEN: Setting isPinned to true
            updateTerminalPinned('unpin-test-node.md-terminal-0', true)

            // THEN: isPinned should be true
            expect(getTerminalRecords()[0].terminalData.isPinned).toBe(true)
        })

        it('does nothing for non-existent terminal', () => {
            // WHEN: Updating a non-existent terminal
            updateTerminalPinned('non-existent-terminal', true)

            // THEN: No error, records remain empty
            expect(getTerminalRecords()).toHaveLength(0)
        })
    })

    describe('updateTerminalActivityState correctly updates activity fields', () => {
        it('updates lastOutputTime', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'activity-test-node.md',
                terminalCount: 0,
                title: 'Activity Test Terminal'
            })
            recordTerminalSpawn('activity-test-node.md-terminal-0', terminalData)
            const initialTime: number = getTerminalRecords()[0].terminalData.lastOutputTime

            // WHEN: Updating lastOutputTime
            const newTime: number = Date.now() + 1000
            updateTerminalActivityState('activity-test-node.md-terminal-0', {lastOutputTime: newTime})

            // THEN: lastOutputTime should be updated
            expect(getTerminalRecords()[0].terminalData.lastOutputTime).toBe(newTime)
            expect(getTerminalRecords()[0].terminalData.lastOutputTime).not.toBe(initialTime)
        })

        it('updates activityCount', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'count-test-node.md',
                terminalCount: 0,
                title: 'Count Test Terminal'
            })
            recordTerminalSpawn('count-test-node.md-terminal-0', terminalData)

            // Initially activityCount should be 0
            expect(getTerminalRecords()[0].terminalData.activityCount).toBe(0)

            // WHEN: Updating activityCount
            updateTerminalActivityState('count-test-node.md-terminal-0', {activityCount: 5})

            // THEN: activityCount should be updated
            expect(getTerminalRecords()[0].terminalData.activityCount).toBe(5)
        })

        it('updates multiple fields at once', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'multi-update-node.md',
                terminalCount: 0,
                title: 'Multi Update Terminal'
            })
            recordTerminalSpawn('multi-update-node.md-terminal-0', terminalData)

            const newTime: number = Date.now() + 5000

            // WHEN: Updating multiple fields
            updateTerminalActivityState('multi-update-node.md-terminal-0', {
                lastOutputTime: newTime,
                activityCount: 10
            })

            // THEN: Both fields should be updated
            const record: TerminalRecord = getTerminalRecords()[0]
            expect(record.terminalData.lastOutputTime).toBe(newTime)
            expect(record.terminalData.activityCount).toBe(10)
        })

        it('does nothing for non-existent terminal', () => {
            // WHEN: Updating a non-existent terminal
            updateTerminalActivityState('non-existent-terminal', {activityCount: 100})

            // THEN: No error, records remain empty
            expect(getTerminalRecords()).toHaveLength(0)
        })

        it('preserves other fields when updating activity state', () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'preserve-test-node.md',
                terminalCount: 0,
                title: 'Preserve Test Terminal',
                isPinned: false,
                agentName: 'preserve-agent'
            })
            recordTerminalSpawn('preserve-test-node.md-terminal-0', terminalData)

            // WHEN: Updating activity state
            updateTerminalActivityState('preserve-test-node.md-terminal-0', {activityCount: 3})

            // THEN: Other fields should be preserved
            const record: TerminalRecord = getTerminalRecords()[0]
            expect(record.terminalData.isPinned).toBe(false)
            expect(record.terminalData.isDone).toBe(false)
            expect(record.terminalData.agentName).toBe('preserve-agent')
            expect(record.terminalData.title).toBe('Preserve Test Terminal')
        })
    })
})

/**
 * Phase 2A: syncTerminals is called after mutations (except activity updates)
 *
 * BEHAVIOR TESTED:
 * - syncTerminals is called after recordTerminalSpawn
 * - syncTerminals is called after markTerminalExited
 * - syncTerminals is called after structural state updates (isDone, isPinned)
 * - syncTerminals is NOT called after activity updates (performance: avoids re-renders)
 *
 * Spec Reference: consolidate-terminal-registry phase 2A
 */
describe('Terminal Registry - Phase 2A: syncTerminals', () => {
    let mockSyncTerminals: Mock

    beforeEach(async () => {
        clearTerminalRecords()
        // Get the mocked uiAPI
        const {uiAPI} = await import('@/shell/edge/main/ui-api-proxy')
        mockSyncTerminals = uiAPI.syncTerminals as Mock
        mockSyncTerminals.mockClear()
    })

    describe('syncTerminals is called after recordTerminalSpawn', () => {
        it('calls syncTerminals with current records after spawn', async () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-spawn-node.md',
                terminalCount: 0,
                title: 'Sync Spawn Test'
            })

            // WHEN: Recording a terminal spawn
            recordTerminalSpawn('sync-spawn-node.md-terminal-0', terminalData)

            // THEN: syncTerminals should be called with the current records
            expect(mockSyncTerminals).toHaveBeenCalledTimes(1)
            const records: TerminalRecord[] = mockSyncTerminals.mock.calls[0][0]
            expect(records).toHaveLength(1)
            expect(records[0].terminalId).toBe('sync-spawn-node.md-terminal-0')
        })
    })

    describe('syncTerminals is called after markTerminalExited', () => {
        it('calls syncTerminals with updated status after exit', async () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-exit-node.md',
                terminalCount: 0,
                title: 'Sync Exit Test'
            })
            recordTerminalSpawn('sync-exit-node.md-terminal-0', terminalData)
            mockSyncTerminals.mockClear()

            // WHEN: Marking terminal as exited
            markTerminalExited('sync-exit-node.md-terminal-0')

            // THEN: syncTerminals should be called with updated status
            expect(mockSyncTerminals).toHaveBeenCalledTimes(1)
            const records: TerminalRecord[] = mockSyncTerminals.mock.calls[0][0]
            expect(records[0].status).toBe('exited')
        })

        it('does not call syncTerminals for non-existent terminal', async () => {
            // WHEN: Marking a non-existent terminal as exited
            markTerminalExited('non-existent-terminal')

            // THEN: syncTerminals should not be called
            expect(mockSyncTerminals).not.toHaveBeenCalled()
        })
    })

    describe('syncTerminals is called after state updates', () => {
        it('calls syncTerminals after updateTerminalIsDone', async () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-done-node.md',
                terminalCount: 0,
                title: 'Sync Done Test'
            })
            recordTerminalSpawn('sync-done-node.md-terminal-0', terminalData)
            mockSyncTerminals.mockClear()

            // WHEN: Updating isDone
            updateTerminalIsDone('sync-done-node.md-terminal-0', true)

            // THEN: syncTerminals should be called
            expect(mockSyncTerminals).toHaveBeenCalledTimes(1)
            const records: TerminalRecord[] = mockSyncTerminals.mock.calls[0][0]
            expect(records[0].terminalData.isDone).toBe(true)
        })

        it('calls syncTerminals after updateTerminalPinned', async () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-pin-node.md',
                terminalCount: 0,
                title: 'Sync Pin Test',
                isPinned: false
            })
            recordTerminalSpawn('sync-pin-node.md-terminal-0', terminalData)
            mockSyncTerminals.mockClear()

            // WHEN: Updating isPinned
            updateTerminalPinned('sync-pin-node.md-terminal-0', true)

            // THEN: syncTerminals should be called
            expect(mockSyncTerminals).toHaveBeenCalledTimes(1)
            const records: TerminalRecord[] = mockSyncTerminals.mock.calls[0][0]
            expect(records[0].terminalData.isPinned).toBe(true)
        })

        it('does NOT call syncTerminals after updateTerminalActivityState (performance: avoids re-renders)', async () => {
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'sync-activity-node.md',
                terminalCount: 0,
                title: 'Sync Activity Test'
            })
            recordTerminalSpawn('sync-activity-node.md-terminal-0', terminalData)
            mockSyncTerminals.mockClear()

            // WHEN: Updating activity state
            updateTerminalActivityState('sync-activity-node.md-terminal-0', {activityCount: 5})

            // THEN: syncTerminals should NOT be called (activity updates are high frequency)
            expect(mockSyncTerminals).not.toHaveBeenCalled()
            // But state should still be updated locally
            const records: TerminalRecord[] = getTerminalRecords()
            expect(records[0].terminalData.activityCount).toBe(5)
        })

        it('does not call syncTerminals for non-existent terminal updates', async () => {
            // WHEN: Updating a non-existent terminal
            updateTerminalIsDone('non-existent-terminal', true)

            // THEN: syncTerminals should not be called
            expect(mockSyncTerminals).not.toHaveBeenCalled()
        })
    })
})
