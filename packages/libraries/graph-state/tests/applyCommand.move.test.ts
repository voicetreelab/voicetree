import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, readSnapshotDocument, serializeState } from '../src/fixtures'

const BETA_ID = '/tmp/graph-state-fixtures/root-a/beta.md'

describe('applyCommand Move', () => {
    it('updates layout.positions and node position in graph', () => {
        const { initial, commands, expected } = loadSequence('108-move-command')
        const command = commands[0]

        const { state, delta } = applyCommandWithDelta(initial, command)

        expect(state.layout.positions.get(BETA_ID)).toEqual({ x: 360, y: 240 })
        expect(O.isSome(state.graph.nodes[BETA_ID].nodeUIMetadata.position)).toBe(true)
        if (O.isSome(state.graph.nodes[BETA_ID].nodeUIMetadata.position)) {
            expect(state.graph.nodes[BETA_ID].nodeUIMetadata.position.value).toEqual({ x: 360, y: 240 })
        }
        expect(delta.positionsMoved?.get(BETA_ID)).toEqual({ x: 360, y: 240 })
        expect(state.meta.revision - initial.meta.revision).toBe(expected?.revisionDelta)
    })

    it('matches fixture 007-with-layout-positions-moved', () => {
        const { initial, commands, expected } = loadSequence('108-move-command')
        let state = initial
        for (const cmd of commands) {
            state = applyCommandWithDelta(state, cmd).state
        }

        const snapshot = readSnapshotDocument('007-with-layout-positions-moved')
        expect(serializeState(state)).toEqual({
            ...snapshot.state,
            meta: { ...snapshot.state.meta, revision: state.meta.revision },
        })
        expect(state.meta.revision - initial.meta.revision).toBe(expected?.revisionDelta)
    })

    it('is a no-op for unknown node id', () => {
        const { initial } = loadSequence('108-move-command')
        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'Move',
            id: '/does/not/exist.md',
            to: { x: 99, y: 99 },
        })

        expect(state.layout.positions.has('/does/not/exist.md')).toBe(false)
        expect(delta.positionsMoved).toBeUndefined()
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
    })
})
