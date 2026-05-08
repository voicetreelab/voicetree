import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, loadSnapshot, serializeState } from '../src/fixtures'

function serializeStateWithoutRevision(name: string) {
    const state = loadSnapshot(name)
    const serialized = serializeState(state)

    return {
        ...serialized,
        meta: {
            ...serialized.meta,
            revision: 0,
        },
    }
}

function stripDeltaCause(deltas: readonly Record<string, unknown>[]) {
    return deltas.map(({ cause: _cause, ...delta }) => delta)
}

describe('applyCommand Expand', () => {
    it('matches the single-expand sequence fixture', () => {
        const sequence = loadSequence('101-expand-command')
        const deltas: Record<string, unknown>[] = []
        let state = sequence.initial

        for (const command of sequence.commands) {
            const result = applyCommandWithDelta(state, command)
            state = result.state
            deltas.push(result.delta as Record<string, unknown>)
        }

        expect(sequence.expected).toBeDefined()
        expect(stripDeltaCause(deltas)).toEqual(sequence.expected?.deltas)
        expect(state.meta.revision).toBe(sequence.initial.meta.revision + (sequence.expected?.revisionDelta ?? 0))

        const serialized = serializeState(state)
        expect({
            ...serialized,
            meta: {
                ...serialized.meta,
                revision: 0,
            },
        }).toEqual(serializeStateWithoutRevision(sequence.expected?.finalSnapshot ?? '010-flat-folder'))
    })

    it('restores the original state after collapse then expand', () => {
        const sequence = loadSequence('111-collapse-expand-round-trip')
        let state = sequence.initial

        for (const command of sequence.commands) {
            state = applyCommand(state, command)
        }

        expect(state.meta.revision).toBe(sequence.initial.meta.revision + (sequence.expected?.revisionDelta ?? 0))

        const serialized = serializeState(state)
        expect({
            ...serialized,
            meta: {
                ...serialized.meta,
                revision: 0,
            },
        }).toEqual(serializeStateWithoutRevision('010-flat-folder'))
    })
})
