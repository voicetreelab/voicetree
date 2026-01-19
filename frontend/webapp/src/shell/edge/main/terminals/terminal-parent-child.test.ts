/**
 * Tests for terminal parent-child relationship tracking
 *
 * BEHAVIOR TESTED:
 * - MCP spawn records parent relationship (parentTerminalId set to caller's terminal ID)
 * - Manual spawn has no parent (parentTerminalId is null/undefined)
 * - Parent lookup returns correct value
 *
 * Spec Reference: openspec/changes/add-tree-style-agent-tabs/specs/agent-tabs/spec.md
 * - "Terminal Parent-Child Relationship Tracking"
 */

import {describe, it, expect, beforeEach} from 'vitest'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords
} from '@/shell/edge/main/terminals/terminal-registry'

describe('Terminal Parent-Child Relationship Tracking', () => {
    beforeEach(() => {
        clearTerminalRecords()
    })

    describe('Scenario: MCP spawn records parent relationship', () => {
        it('WHEN spawn_agent is called via MCP with a valid callerTerminalId THEN the spawned terminal parentTerminalId is set to the caller terminal ID', () => {
            // GIVEN: A parent terminal exists
            const parentTerminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'parent-node.md',
                terminalCount: 0,
                title: 'Parent Terminal'
            })
            recordTerminalSpawn('parent-node.md-terminal-0', parentTerminalData)

            // WHEN: A child terminal is spawned with parentTerminalId set
            const childTerminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'child-node.md',
                terminalCount: 0,
                title: 'Child Terminal',
                parentTerminalId: 'parent-node.md-terminal-0' as TerminalId
            })
            recordTerminalSpawn('child-node.md-terminal-0', childTerminalData)

            // THEN: The child terminal's parentTerminalId should be set correctly
            const records: TerminalRecord[] = getTerminalRecords()
            const childRecord: TerminalRecord | undefined = records.find(r => r.terminalId === 'child-node.md-terminal-0')

            expect(childRecord).toBeDefined()
            expect(childRecord?.terminalData.parentTerminalId).toBe('parent-node.md-terminal-0')
        })

        it('AND this relationship persists in the terminal registry', () => {
            // GIVEN: Parent and child terminals exist
            const parentTerminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'parent-node.md',
                terminalCount: 0,
                title: 'Parent Terminal'
            })
            recordTerminalSpawn('parent-node.md-terminal-0', parentTerminalData)

            const childTerminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'child-node.md',
                terminalCount: 0,
                title: 'Child Terminal',
                parentTerminalId: 'parent-node.md-terminal-0' as TerminalId
            })
            recordTerminalSpawn('child-node.md-terminal-0', childTerminalData)

            // WHEN: We query the terminal registry later
            const records: TerminalRecord[] = getTerminalRecords()

            // THEN: The relationship should still be present
            const childRecord: TerminalRecord | undefined = records.find(r => r.terminalId === 'child-node.md-terminal-0')
            expect(childRecord?.terminalData.parentTerminalId).toBe('parent-node.md-terminal-0')
        })
    })

    describe('Scenario: Manual spawn has no parent', () => {
        it('WHEN a terminal is spawned via UI action (not via MCP) THEN the terminal parentTerminalId is null (root terminal)', () => {
            // WHEN: A terminal is spawned without specifying parentTerminalId
            const terminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'manual-spawn-node.md',
                terminalCount: 0,
                title: 'Manual Terminal'
            })
            recordTerminalSpawn('manual-spawn-node.md-terminal-0', terminalData)

            // THEN: The parentTerminalId should be null/undefined
            const records: TerminalRecord[] = getTerminalRecords()
            const record: TerminalRecord | undefined = records.find(r => r.terminalId === 'manual-spawn-node.md-terminal-0')

            expect(record).toBeDefined()
            expect(record?.terminalData.parentTerminalId).toBeNull()
        })
    })

    describe('Scenario: Parent lookup returns correct relationship', () => {
        it('WHEN a terminal has been spawned by another terminal THEN querying the terminal parent returns the correct parent terminal ID', () => {
            // GIVEN: A chain of terminals: grandparent -> parent -> child
            const grandparentTerminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'grandparent.md',
                terminalCount: 0,
                title: 'Grandparent'
            })
            recordTerminalSpawn('grandparent.md-terminal-0', grandparentTerminalData)

            const parentTerminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'parent.md',
                terminalCount: 0,
                title: 'Parent',
                parentTerminalId: 'grandparent.md-terminal-0' as TerminalId
            })
            recordTerminalSpawn('parent.md-terminal-0', parentTerminalData)

            const childTerminalData: TerminalData = createTerminalData({
                attachedToNodeId: 'child.md',
                terminalCount: 0,
                title: 'Child',
                parentTerminalId: 'parent.md-terminal-0' as TerminalId
            })
            recordTerminalSpawn('child.md-terminal-0', childTerminalData)

            // THEN: Each terminal should report the correct parent
            const records: TerminalRecord[] = getTerminalRecords()

            const grandparentRecord: TerminalRecord | undefined = records.find(r => r.terminalId === 'grandparent.md-terminal-0')
            const parentRecord: TerminalRecord | undefined = records.find(r => r.terminalId === 'parent.md-terminal-0')
            const childRecord: TerminalRecord | undefined = records.find(r => r.terminalId === 'child.md-terminal-0')

            expect(grandparentRecord?.terminalData.parentTerminalId).toBeNull()
            expect(parentRecord?.terminalData.parentTerminalId).toBe('grandparent.md-terminal-0')
            expect(childRecord?.terminalData.parentTerminalId).toBe('parent.md-terminal-0')
        })
    })
})
