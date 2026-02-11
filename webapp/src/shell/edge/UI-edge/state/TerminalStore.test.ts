/**
 * Tests for TerminalStore - Phase 3: Display-only cache behavior
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
    syncFromMain,
    setTerminalUI,
    getTerminals,
    getTerminal,
    clearTerminals,
    subscribeToTerminalChanges,
} from './TerminalStore'
import { createTerminalData, computeTerminalId, type TerminalId, type FloatingWindowUIData } from '@/shell/edge/UI-edge/floating-windows/types'
import type { TerminalRecord } from '@/shell/edge/main/terminals/terminal-registry'
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import * as O from 'fp-ts/lib/Option.js'

function createMockTerminalData(overrides: Partial<TerminalData> = {}): TerminalData {
    return createTerminalData({
        terminalId: computeTerminalId('test-node.md', 0),
        attachedToNodeId: 'test-node.md',
        terminalCount: 0,
        title: 'Test Terminal',
        agentName: 'test-agent',
        ...overrides,
    })
}

function createMockRecord(terminalData: TerminalData): TerminalRecord {
    return {
        terminalId: terminalData.terminalId,
        terminalData,
        status: 'running',
    }
}

function createMockUI(): FloatingWindowUIData {
    return {
        windowElement: document.createElement('div'),
        contentContainer: document.createElement('div'),
    }
}

describe('TerminalStore syncFromMain', () => {
    beforeEach(() => {
        clearTerminals()
    })

    it('should add new terminals from incoming records', () => {
        const terminal: TerminalData = createMockTerminalData()
        const records: TerminalRecord[] = [createMockRecord(terminal)]

        syncFromMain(records)

        const result: import('fp-ts/lib/Option.js').Option<TerminalData & { ui?: FloatingWindowUIData }> = getTerminal(terminal.terminalId)
        expect(O.isSome(result)).toBe(true)
        if (O.isSome(result)) {
            expect(result.value.title).toBe('Test Terminal')
        }
    })

    it('should update existing terminals while preserving UI reference', () => {
        // Setup: Add terminal with UI
        const terminal: TerminalData = createMockTerminalData({ isPinned: true })
        const ui: FloatingWindowUIData = createMockUI()
        syncFromMain([createMockRecord(terminal)])
        setTerminalUI(terminal.terminalId, ui)

        // Verify UI is attached
        const beforeUpdate: import('fp-ts/lib/Option.js').Option<TerminalData & { ui?: FloatingWindowUIData }> = getTerminal(terminal.terminalId)
        expect(O.isSome(beforeUpdate) && beforeUpdate.value.ui).toBe(ui)

        // Update: Sync with changed data
        const updatedTerminal: TerminalData = createMockTerminalData({ isPinned: false })
        syncFromMain([createMockRecord(updatedTerminal)])

        // Verify: Data updated, UI preserved
        const afterUpdate: import('fp-ts/lib/Option.js').Option<TerminalData & { ui?: FloatingWindowUIData }> = getTerminal(terminal.terminalId)
        expect(O.isSome(afterUpdate)).toBe(true)
        if (O.isSome(afterUpdate)) {
            expect(afterUpdate.value.isPinned).toBe(false)
            expect(afterUpdate.value.ui).toBe(ui) // UI preserved!
        }
    })

    it('should remove terminals not in incoming records', () => {
        // Setup: Add two terminals
        const terminal1: TerminalData = createMockTerminalData({ terminalCount: 0 })
        const terminal2: TerminalData = createTerminalData({
            terminalId: computeTerminalId('other-node.md', 0),
            attachedToNodeId: 'other-node.md',
            terminalCount: 0,
            title: 'Other Terminal',
            agentName: 'other-agent',
        })
        syncFromMain([createMockRecord(terminal1), createMockRecord(terminal2)])

        expect(getTerminals().size).toBe(2)

        // Update: Sync with only one terminal
        syncFromMain([createMockRecord(terminal1)])

        // Verify: Second terminal removed
        expect(getTerminals().size).toBe(1)
        expect(O.isSome(getTerminal(terminal1.terminalId))).toBe(true)
        expect(O.isSome(getTerminal(terminal2.terminalId))).toBe(false)
    })

    it('should notify subscribers after sync', () => {
        const terminal: TerminalData = createMockTerminalData()
        let notifiedTerminals: TerminalData[] = []

        subscribeToTerminalChanges((terminals) => {
            notifiedTerminals = terminals
        })

        syncFromMain([createMockRecord(terminal)])

        expect(notifiedTerminals.length).toBe(1)
        expect(notifiedTerminals[0].terminalId).toBe(terminal.terminalId)
    })
})

describe('TerminalStore setTerminalUI', () => {
    beforeEach(() => {
        clearTerminals()
    })

    it('should attach UI to existing terminal', () => {
        const terminal: TerminalData = createMockTerminalData()
        const ui: FloatingWindowUIData = createMockUI()

        syncFromMain([createMockRecord(terminal)])
        setTerminalUI(terminal.terminalId, ui)

        const result: import('fp-ts/lib/Option.js').Option<TerminalData & { ui?: FloatingWindowUIData }> = getTerminal(terminal.terminalId)
        expect(O.isSome(result) && result.value.ui).toBe(ui)
    })

    it('should handle race condition: add terminal with UI if not in store', () => {
        // Simulate launchTerminalOntoUI arriving before syncTerminals
        const terminal: TerminalData = createMockTerminalData()
        const ui: FloatingWindowUIData = createMockUI()

        // Terminal not in store yet
        expect(getTerminals().size).toBe(0)

        // setTerminalUI with terminalData fallback
        setTerminalUI(terminal.terminalId, ui, terminal)

        // Terminal should now be in store with UI
        expect(getTerminals().size).toBe(1)
        const result: import('fp-ts/lib/Option.js').Option<TerminalData & { ui?: FloatingWindowUIData }> = getTerminal(terminal.terminalId)
        expect(O.isSome(result)).toBe(true)
        if (O.isSome(result)) {
            expect(result.value.ui).toBe(ui)
            expect(result.value.title).toBe('Test Terminal')
        }
    })

    it('should do nothing if terminal not in store and no fallback data', () => {
        const ui: FloatingWindowUIData = createMockUI()

        setTerminalUI('nonexistent-terminal' as TerminalId, ui)

        expect(getTerminals().size).toBe(0)
    })
})
