import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta } from '../src/applyCommand'
import { loadSequence, loadSnapshot } from '../src/fixtures'
import type { AddEdge } from '../src/contract'

interface EdgeChange {
    readonly source: string
    readonly targetId: string
    readonly label: string
}

describe('applyCommand AddEdge', () => {
    it('appends an edge to the source node and bumps revision', () => {
        const sequence = loadSequence('106-add-edge-command')
        const command = sequence.commands[0] as AddEdge

        const { state, delta } = applyCommandWithDelta(sequence.initial, command)
        const sourceNode = state.graph.nodes[command.source]

        const priorEdgeCount = sequence.initial.graph.nodes[command.source]?.outgoingEdges.length ?? 0
        expect(sourceNode?.outgoingEdges.length).toBe(priorEdgeCount + 1)
        expect(sourceNode?.outgoingEdges.some(
            (e) => e.targetId === command.edge.targetId && e.label === command.edge.label,
        )).toBe(true)
        expect(delta.revision).toBe(sequence.initial.meta.revision + 1)
    })

    it('updates incomingEdgesIndex for the target node', () => {
        const sequence = loadSequence('106-add-edge-command')
        const command = sequence.commands[0] as AddEdge

        const { state } = applyCommandWithDelta(sequence.initial, command)

        expect(state.graph.incomingEdgesIndex.has(command.edge.targetId)).toBe(true)
        expect(state.graph.incomingEdgesIndex.get(command.edge.targetId)).toContain(command.source)
    })

    it('emits edgesAdded in delta.graph', () => {
        const sequence = loadSequence('106-add-edge-command')
        const command = sequence.commands[0] as AddEdge

        const { delta } = applyCommandWithDelta(sequence.initial, command)
        const graphSummary = delta.graph as { readonly edgesAdded?: readonly EdgeChange[] } | undefined

        expect(graphSummary?.edgesAdded).toEqual([{
            source: command.source,
            targetId: command.edge.targetId,
            label: command.edge.label,
        }])
    })

    it('updates unresolvedLinksIndex when target is absent from graph', () => {
        const initial = loadSnapshot('003-flat-three-nodes')
        const command: AddEdge = {
            type: 'AddEdge',
            source: '/tmp/graph-state-fixtures/root-a/alpha.md',
            edge: { targetId: '/tmp/graph-state-fixtures/root-a/nonexistent.md', label: '' },
        }

        const { state } = applyCommandWithDelta(initial, command)

        expect(state.graph.unresolvedLinksIndex.has('nonexistent')).toBe(true)
        expect(state.graph.unresolvedLinksIndex.get('nonexistent')).toContain(command.source)
    })

    it('is idempotent on duplicate (targetId, label) — edge not added twice', () => {
        const sequence = loadSequence('106-add-edge-command')
        const command = sequence.commands[0] as AddEdge

        const afterFirst = applyCommand(sequence.initial, command)
        const edgeCountAfterFirst = afterFirst.graph.nodes[command.source]?.outgoingEdges.length ?? 0

        const afterSecond = applyCommand(afterFirst, command)
        const edgeCountAfterSecond = afterSecond.graph.nodes[command.source]?.outgoingEdges.length ?? 0

        expect(edgeCountAfterSecond).toBe(edgeCountAfterFirst)
    })

    it('handles missing source node gracefully — no crash, revision bumps', () => {
        const initial = loadSnapshot('003-flat-three-nodes')
        const command: AddEdge = {
            type: 'AddEdge',
            source: '/tmp/graph-state-fixtures/root-a/does-not-exist.md',
            edge: { targetId: '/tmp/graph-state-fixtures/root-a/alpha.md', label: '' },
        }

        const { state, delta } = applyCommandWithDelta(initial, command)

        expect(delta.revision).toBe(initial.meta.revision + 1)
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
    })
})
