import { describe, expect, it } from 'vitest'

import { applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, loadSnapshot, serializeState } from '../src/fixtures'

function stripCause<T extends { readonly cause: unknown }>(delta: T): Omit<T, 'cause'> {
    const { cause: _cause, ...rest } = delta
    return rest
}

function withRevision<T extends { readonly meta: { readonly revision: number } }>(
    state: T,
    revision: number,
): T {
    return {
        ...state,
        meta: {
            ...state.meta,
            revision,
        },
    }
}

describe('applyCommand Select', () => {
    it('matches fixture 102-select-command', () => {
        const sequence = loadSequence('102-select-command')
        const deltas = []
        let state = sequence.initial

        for (const command of sequence.commands) {
            const result = applyCommandWithDelta(state, command)
            state = result.state
            deltas.push(stripCause(result.delta))
        }

        const expectedFinal = loadSnapshot(sequence.expected!.finalSnapshot!)

        expect(
            serializeState(withRevision(state, expectedFinal.meta.revision)),
        ).toEqual(serializeState(expectedFinal))
        expect(state.meta.revision - sequence.initial.meta.revision).toBe(sequence.expected!.revisionDelta)
        expect(deltas).toEqual(sequence.expected!.deltas)
    })

    it('replaces the selection when additive is omitted', () => {
        const initial = loadSnapshot('005-with-selection')
        const gamma = '/tmp/graph-state-fixtures/root-a/gamma.md'
        const beta = '/tmp/graph-state-fixtures/root-a/beta.md'

        const result = applyCommandWithDelta(initial, {
            type: 'Select',
            ids: [gamma],
        })

        expect([...result.state.selection]).toEqual([gamma])
        expect(result.delta.selectionAdded).toEqual([gamma])
        expect(result.delta.selectionRemoved).toEqual([beta])
        expect(result.state.meta.revision).toBe(initial.meta.revision + 1)
    })

    it('adds to the existing selection when additive is true', () => {
        const initial = loadSnapshot('005-with-selection')
        const beta = '/tmp/graph-state-fixtures/root-a/beta.md'
        const gamma = '/tmp/graph-state-fixtures/root-a/gamma.md'

        const result = applyCommandWithDelta(initial, {
            type: 'Select',
            ids: [gamma, beta, gamma],
            additive: true,
        })

        expect([...result.state.selection]).toEqual([beta, gamma])
        expect(result.delta.selectionAdded).toEqual([gamma])
        expect(result.delta.selectionRemoved).toBeUndefined()
        expect(result.state.meta.revision).toBe(initial.meta.revision + 1)
    })
})
