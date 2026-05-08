import { describe, expect, it } from 'vitest'

import { applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, loadSnapshot, serializeState } from '../src/fixtures'

function comparableState(name: string) {
    const serialized = serializeState(loadSnapshot(name))
    return {
        ...serialized,
        meta: {
            ...serialized.meta,
            revision: 0,
        },
    }
}

function comparableRuntimeState(name: string) {
    const sequence = loadSequence(name)
    const deltas = []
    let state = sequence.initial

    for (const command of sequence.commands) {
        const result = applyCommandWithDelta(state, command)
        state = result.state
        deltas.push(result.delta)
    }

    const serialized = serializeState(state)

    return {
        state: {
            ...serialized,
            meta: {
                ...serialized.meta,
                revision: 0,
            },
        },
        deltas,
        revisionDelta: state.meta.revision - sequence.initial.meta.revision,
        expected: sequence.expected,
    }
}

describe('applyCommand Deselect', () => {
    it('removes the requested ids from the current selection fixture', () => {
        const result = comparableRuntimeState('103-deselect-command')

        expect(result.state).toEqual(comparableState('003-flat-three-nodes'))
        expect(result.revisionDelta).toBe(result.expected?.revisionDelta)
        expect(result.deltas).toHaveLength(result.expected?.deltas?.length ?? 0)
        expect(result.deltas[0]).toMatchObject(result.expected?.deltas?.[0] ?? {})
    })

    it('round-trips back to the baseline after select then deselect', () => {
        const result = comparableRuntimeState('112-select-deselect-round-trip')

        expect(result.state).toEqual(comparableState('003-flat-three-nodes'))
        expect(result.revisionDelta).toBe(result.expected?.revisionDelta)
        expect(result.state.selection).toEqual([])
    })
})
