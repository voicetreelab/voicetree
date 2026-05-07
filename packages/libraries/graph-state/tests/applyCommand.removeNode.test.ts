import { describe, expect, it } from 'vitest'

import { applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, readSnapshotDocument, serializeState } from '../src/fixtures'
import type { State } from '../src/contract'

const DELTA_ID = '/tmp/graph-state-fixtures/root-a/delta.md'

function runSequence(initialState: State, sequenceId: string) {
    const sequence = loadSequence(sequenceId)
    let state = initialState
    const deltas = []

    for (const command of sequence.commands) {
        const result = applyCommandWithDelta(state, command)
        state = result.state
        deltas.push(result.delta)
    }

    return { sequence, state, deltas }
}

function expectedSerializedState(snapshotId: string, revision: number) {
    const snapshot = readSnapshotDocument(snapshotId)
    return {
        ...snapshot.state,
        meta: {
            ...snapshot.state.meta,
            revision,
        },
    }
}

describe('applyCommand RemoveNode', () => {
    it('matches fixture 105 by pruning the extra node and its folder-tree entry', () => {
        const sequence = loadSequence('105-remove-node-command')
        const result = runSequence(sequence.initial, '105-remove-node-command')
        const removeDelta = result.deltas.at(-1)

        expect(serializeState(result.state)).toEqual(
            expectedSerializedState('003-flat-three-nodes', result.state.meta.revision),
        )
        expect(result.state.meta.revision - sequence.initial.meta.revision).toBe(
            sequence.expected?.revisionDelta,
        )
        expect(removeDelta?.graph?.some((entry) => (
            entry.type === 'DeleteNode' && entry.nodeId === DELTA_ID
        ))).toBe(true)
    })

    it('matches fixture 114 and cascades selection plus layout cleanup', () => {
        const sequence = loadSequence('114-add-then-remove-node')
        const initial: State = {
            ...sequence.initial,
            selection: new Set([...sequence.initial.selection, DELTA_ID]),
            layout: {
                ...sequence.initial.layout,
                positions: new Map([
                    ...sequence.initial.layout.positions,
                    [DELTA_ID, { x: 420, y: 69 }],
                ]),
            },
        }
        const result = runSequence(initial, '114-add-then-remove-node')
        const removeDelta = result.deltas.at(-1)

        expect(serializeState(result.state)).toEqual(
            expectedSerializedState('003-flat-three-nodes', result.state.meta.revision),
        )
        expect(result.state.meta.revision - initial.meta.revision).toBe(
            sequence.expected?.revisionDelta,
        )
        expect(result.state.selection.has(DELTA_ID)).toBe(false)
        expect(result.state.layout.positions.has(DELTA_ID)).toBe(false)
        expect(removeDelta?.selectionRemoved).toEqual([DELTA_ID])
        expect(removeDelta?.graph?.some((entry) => (
            entry.type === 'DeleteNode' && entry.nodeId === DELTA_ID
        ))).toBe(true)
    })
})
