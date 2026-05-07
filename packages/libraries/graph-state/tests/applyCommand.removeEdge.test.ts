import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, loadSnapshot, serializeState } from '../src/fixtures'

interface EdgeChange {
    readonly source: string
    readonly targetId: string
    readonly label: string
}

describe('applyCommand RemoveEdge', () => {
    it('matches the canonical remove-edge snapshot and revision delta', () => {
        const sequence = loadSequence('107-remove-edge-command')
        let state = sequence.initial

        for (const command of sequence.commands) {
            state = applyCommand(state, command)
        }

        const expectedSnapshotId = sequence.expected?.finalSnapshot
        expect(expectedSnapshotId).toBeTruthy()

        const actual = serializeState(state)
        const expected = serializeState(loadSnapshot(expectedSnapshotId!))

        expect(actual).toEqual({
            ...expected,
            meta: {
                ...expected.meta,
                revision: actual.meta.revision,
            },
        })
        expect(actual.meta.revision - sequence.initial.meta.revision).toBe(
            sequence.expected?.revisionDelta,
        )
    })

    it('emits the removed edge summary and cleans the incoming index', () => {
        const sequence = loadSequence('107-remove-edge-command')
        const command = sequence.commands[0]
        expect(command?.type).toBe('RemoveEdge')

        const sourceNode = sequence.initial.graph.nodes[(command as { readonly source: string }).source]
        const expectedRemoved: readonly EdgeChange[] = sourceNode.outgoingEdges
            .filter((edge) => edge.targetId === (command as { readonly targetId: string }).targetId)
            .map((edge) => ({
                source: (command as { readonly source: string }).source,
                targetId: (command as { readonly targetId: string }).targetId,
                label: edge.label,
            }))

        const { state, delta } = applyCommandWithDelta(sequence.initial, command)
        const graphSummary = delta.graph as { readonly edgesRemoved?: readonly EdgeChange[] } | undefined

        expect(delta.revision).toBe(sequence.initial.meta.revision + 1)
        expect(graphSummary?.edgesRemoved).toEqual(expectedRemoved)
        expect(state.graph.incomingEdgesIndex.has((command as { readonly targetId: string }).targetId)).toBe(false)
    })
})
