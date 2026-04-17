import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta } from '../src/applyCommand'
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

function serializeDeltaForFixture(delta: Delta): Readonly<Record<string, unknown>> {
    return {
        revision: delta.revision,
        ...(delta.collapseAdded !== undefined ? { collapseAdded: [...delta.collapseAdded] } : {}),
        ...(delta.collapseRemoved !== undefined ? { collapseRemoved: [...delta.collapseRemoved] } : {}),
        ...(delta.selectionAdded !== undefined ? { selectionAdded: [...delta.selectionAdded] } : {}),
        ...(delta.selectionRemoved !== undefined ? { selectionRemoved: [...delta.selectionRemoved] } : {}),
        ...(delta.rootsLoaded !== undefined ? { rootsLoaded: [...delta.rootsLoaded] } : {}),
        ...(delta.rootsUnloaded !== undefined ? { rootsUnloaded: [...delta.rootsUnloaded] } : {}),
        ...(delta.positionsMoved !== undefined ? { positionsMoved: [...delta.positionsMoved.entries()] } : {}),
    }
}

describe('applyCommand Collapse', () => {
    it('matches the 100-collapse-command fixture sequence', () => {
        const sequence = loadSequence('100-collapse-command')
        let state = sequence.initial
        const deltas: Readonly<Record<string, unknown>>[] = []

        for (const command of sequence.commands) {
            const result = applyCommandWithDelta(state, command)
            state = result.state
            deltas.push(serializeDeltaForFixture(result.delta))
        }

        if (sequence.expected?.finalSnapshot) {
            const expectedState = loadSnapshot(sequence.expected.finalSnapshot)
            expect(
                serializeState(stateWithFixtureRevision(state, expectedState)),
            ).toEqual(serializeState(expectedState))
        }

        if (sequence.expected?.revisionDelta !== undefined) {
            expect(state.meta.revision).toBe(sequence.initial.meta.revision + sequence.expected.revisionDelta)
        }

        if (sequence.expected?.deltas) {
            expect(deltas).toEqual(sequence.expected.deltas)
        }
    })

    it('is idempotent for an already-collapsed folder while preserving other references', () => {
        const initial = applyCommand(loadSnapshot('010-flat-folder'), {
            type: 'Collapse',
            folder: '/tmp/graph-state-fixtures/root-a/tasks/',
        })

        const result = applyCommandWithDelta(initial, {
            type: 'Collapse',
            folder: '/tmp/graph-state-fixtures/root-a/tasks/',
        })

        expect(result.state.collapseSet).toBe(initial.collapseSet)
        expect(result.state.graph).toBe(initial.graph)
        expect(result.state.roots).toBe(initial.roots)
        expect(result.state.selection).toBe(initial.selection)
        expect(result.state.layout).toBe(initial.layout)
        expect(result.state.meta.revision).toBe(initial.meta.revision + 1)
        expect(result.delta.collapseAdded).toEqual([])
    })
})
