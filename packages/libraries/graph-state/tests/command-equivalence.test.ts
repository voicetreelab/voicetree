import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta, emptyState } from '../src/applyCommand'
import { loadSequence, loadSnapshot, serializeState } from '../src/fixtures'
import type { Delta, State } from '../src/contract'

function stateWithFixtureRevision(state: State, fixtureState: State): State {
    return {
        ...state,
        meta: {
            schemaVersion: state.meta.schemaVersion,
            revision: fixtureState.meta.revision,
            ...(fixtureState.meta.mutatedAt !== undefined
                ? { mutatedAt: fixtureState.meta.mutatedAt }
                : {}),
        },
    }
}

function sortStrings(xs: readonly string[]): readonly string[] {
    return [...xs].sort((a, b) => a.localeCompare(b))
}

function serializeDelta(delta: Delta): Readonly<Record<string, unknown>> {
    return {
        revision: delta.revision,
        ...(delta.collapseAdded !== undefined ? { collapseAdded: sortStrings(delta.collapseAdded) } : {}),
        ...(delta.collapseRemoved !== undefined ? { collapseRemoved: sortStrings(delta.collapseRemoved) } : {}),
        ...(delta.selectionAdded !== undefined ? { selectionAdded: sortStrings(delta.selectionAdded) } : {}),
        ...(delta.selectionRemoved !== undefined ? { selectionRemoved: sortStrings(delta.selectionRemoved) } : {}),
        ...(delta.rootsLoaded !== undefined ? { rootsLoaded: sortStrings(delta.rootsLoaded) } : {}),
        ...(delta.rootsUnloaded !== undefined ? { rootsUnloaded: sortStrings(delta.rootsUnloaded) } : {}),
    }
}

function runSequence(fixtureName: string): void {
    const seq = loadSequence(fixtureName)
    let state = seq.initial
    const deltas: Readonly<Record<string, unknown>>[] = []

    for (const cmd of seq.commands) {
        const result = applyCommandWithDelta(state, cmd)
        state = result.state
        deltas.push(serializeDelta(result.delta))
    }

    if (seq.expected?.revisionDelta !== undefined) {
        expect(state.meta.revision).toBe(seq.initial.meta.revision + seq.expected.revisionDelta)
    }

    if (seq.expected?.finalSnapshot) {
        const expectedState = loadSnapshot(seq.expected.finalSnapshot)
        expect(
            serializeState(stateWithFixtureRevision(state, expectedState)),
        ).toEqual(serializeState(expectedState))
    }

    if (seq.expected?.deltas) {
        expect(deltas).toEqual(seq.expected.deltas)
    }
}

/**
 * Command-equivalence matrix (L1-I / V-L1-3, extended for L2-BF-167).
 * One row per Command discriminator. All 15 variants referenced below
 * (11 from L1 + SetZoom/SetPan/SetPositions/RequestFit from L2-BF-167).
 * Rows marked it.skip are pending BF-150 (AddEdge) / BF-152 (Move, LoadRoot, UnloadRoot).
 */
describe('command-equivalence matrix', () => {
    it("'Collapse': fixture 100-collapse-command", () => {
        runSequence('100-collapse-command')
    })

    it("'Expand': fixture 101-expand-command", () => {
        runSequence('101-expand-command')
    })

    it("'Select': fixture 102-select-command", () => {
        runSequence('102-select-command')
    })

    it("'Deselect': fixture 103-deselect-command", () => {
        runSequence('103-deselect-command')
    })

    it("'AddNode': fixture 104-add-node-command", () => {
        runSequence('104-add-node-command')
    })

    it("'RemoveNode': fixture 105-remove-node-command", () => {
        runSequence('105-remove-node-command')
    })

    // TODO: enable once BF-150 lands
    it.skip("'AddEdge': fixture 106-add-edge-command", () => {
        runSequence('106-add-edge-command')
    })

    it("'RemoveEdge': fixture 107-remove-edge-command", () => {
        runSequence('107-remove-edge-command')
    })

    // TODO: enable once BF-152 lands
    it.skip("'Move': fixture 108-move-command", () => {
        runSequence('108-move-command')
    })

    // TODO: enable once BF-152 lands
    it.skip("'LoadRoot': fixture 109-load-root-command", () => {
        runSequence('109-load-root-command')
    })

    // TODO: enable once BF-152 lands
    it.skip("'UnloadRoot': fixture 110-unload-root-command", () => {
        runSequence('110-unload-root-command')
    })

    it('round-trip Collapse→Expand restores initial state: 111', () => {
        runSequence('111-collapse-expand-round-trip')
    })

    it('round-trip Select→Deselect restores initial state: 112', () => {
        runSequence('112-select-deselect-round-trip')
    })

    // TODO: enable once BF-152 (LoadRoot) lands — 113 starts with LoadRoot
    it.skip('multi-command LoadRoot+AddNode+Collapse+Select: 113', () => {
        runSequence('113-multi-command-load-add-collapse-select')
    })

    // BF-167 layout commands. No fixtures yet — per-row inline assertions.
    it("'SetZoom': mutates layout.zoom and bumps revision", () => {
        const initial = emptyState()
        const { state, delta } = applyCommandWithDelta(initial, { type: 'SetZoom', zoom: 1.75 })
        expect(state.layout.zoom).toBe(1.75)
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
        expect(delta.layoutChanged?.zoom).toBe(1.75)
    })

    it("'SetPan': mutates layout.pan and bumps revision", () => {
        const initial = emptyState()
        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'SetPan',
            pan: { x: 12, y: -7 },
        })
        expect(state.layout.pan).toEqual({ x: 12, y: -7 })
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
        expect(delta.layoutChanged?.pan).toEqual({ x: 12, y: -7 })
    })

    it("'SetPositions': merges by nodeId and bumps revision", () => {
        const initial = applyCommand(emptyState(), {
            type: 'SetPositions',
            positions: new Map([['/a.md', { x: 1, y: 1 }]]),
        })
        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'SetPositions',
            positions: new Map([
                ['/a.md', { x: 10, y: 10 }],
                ['/b.md', { x: 2, y: 2 }],
            ]),
        })
        expect(state.layout.positions.get('/a.md')).toEqual({ x: 10, y: 10 })
        expect(state.layout.positions.get('/b.md')).toEqual({ x: 2, y: 2 })
        expect(delta.layoutChanged?.positions?.size).toBe(2)
    })

    it("'RequestFit': records fit and bumps revision", () => {
        const initial = emptyState()
        const { state, delta } = applyCommandWithDelta(initial, { type: 'RequestFit', paddingPx: 30 })
        expect(state.layout.fit).toEqual({ paddingPx: 30 })
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
        expect(delta.layoutChanged?.fit).toEqual({ paddingPx: 30 })
    })
})
