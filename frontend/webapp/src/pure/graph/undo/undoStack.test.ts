import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {
    createEmptyUndoState,
    pushUndo,
    popUndo,
    popRedo,
    MAX_UNDO_SIZE
} from './undoStack'
import type { UndoState } from './undoStack'
import type { GraphDelta, GraphNode } from '@/pure/graph'

// Helper to create a minimal GraphNode for testing
function createTestNode(id: string): GraphNode {
    return {
        relativeFilePathIsID: id,
        contentWithoutYamlOrLinks: '# Test',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map()
        }
    }
}

function createTestDelta(nodeId: string): GraphDelta {
    return [{
        type: 'UpsertNode',
        nodeToUpsert: createTestNode(nodeId),
        previousNode: O.none
    }]
}

describe('undoStack', () => {
    describe('createEmptyUndoState', () => {
        it('returns empty undo and redo stacks', () => {
            const state: UndoState = createEmptyUndoState()
            expect(state.undoStack).toEqual([])
            expect(state.redoStack).toEqual([])
        })
    })

    describe('pushUndo', () => {
        it('adds delta to front of undo stack', () => {
            const delta: GraphDelta = createTestDelta('new.md')
            const state: UndoState = pushUndo(createEmptyUndoState(), delta)

            expect(state.undoStack).toHaveLength(1)
            expect(state.undoStack[0]).toBe(delta)
        })

        it('preserves existing undo stack items', () => {
            const delta1: GraphDelta = createTestDelta('first.md')
            const delta2: GraphDelta = createTestDelta('second.md')

            const state1: UndoState = pushUndo(createEmptyUndoState(), delta1)
            const state2: UndoState = pushUndo(state1, delta2)

            expect(state2.undoStack).toHaveLength(2)
            expect(state2.undoStack[0]).toBe(delta2) // Most recent first
            expect(state2.undoStack[1]).toBe(delta1)
        })

        it('clears redo stack on new action', () => {
            const delta1: GraphDelta = createTestDelta('first.md')
            const delta2: GraphDelta = createTestDelta('second.md')

            // Build up undo stack
            const state1: UndoState = pushUndo(createEmptyUndoState(), delta1)
            // Simulate undo to populate redo stack
            const { newState: stateAfterUndo } = popUndo(state1)
            expect(stateAfterUndo.redoStack).toHaveLength(1)

            // New action should clear redo
            const state2: UndoState = pushUndo(stateAfterUndo, delta2)
            expect(state2.redoStack).toEqual([])
        })

        it('limits undo stack to MAX_UNDO_SIZE', () => {
            const finalState: UndoState = Array.from({ length: MAX_UNDO_SIZE + 10 }).reduce(
                (state: UndoState, _, i: number) =>
                    pushUndo(state, createTestDelta(`node${i}.md`)),
                createEmptyUndoState()
            )

            expect(finalState.undoStack).toHaveLength(MAX_UNDO_SIZE)
        })

        it('keeps most recent items when stack overflows', () => {
            const finalState: UndoState = Array.from({ length: MAX_UNDO_SIZE + 1 }).reduce(
                (state: UndoState, _, i: number) =>
                    pushUndo(state, createTestDelta(`node${i}.md`)),
                createEmptyUndoState()
            )

            // Most recent (last pushed) should be first
            const mostRecentDelta: GraphDelta = finalState.undoStack[0]
            expect((mostRecentDelta[0] as { readonly nodeToUpsert: GraphNode }).nodeToUpsert.relativeFilePathIsID)
                .toBe(`node${MAX_UNDO_SIZE}.md`)

            // Oldest (first pushed, node0) should have been dropped
            const allNodeIds: readonly string[] = finalState.undoStack.map(d =>
                (d[0] as { readonly nodeToUpsert: GraphNode }).nodeToUpsert.relativeFilePathIsID
            )
            expect(allNodeIds).not.toContain('node0.md')
        })
    })

    describe('popUndo', () => {
        it('returns undefined deltaToReverse for empty stack', () => {
            const { newState, deltaToReverse } = popUndo(createEmptyUndoState())

            expect(deltaToReverse).toBeUndefined()
            expect(newState.undoStack).toEqual([])
            expect(newState.redoStack).toEqual([])
        })

        it('removes and returns most recent delta from undo stack', () => {
            const delta1: GraphDelta = createTestDelta('first.md')
            const delta2: GraphDelta = createTestDelta('second.md')

            const state1: UndoState = pushUndo(createEmptyUndoState(), delta1)
            const state2: UndoState = pushUndo(state1, delta2)

            const { newState, deltaToReverse } = popUndo(state2)

            expect(deltaToReverse).toBe(delta2)
            expect(newState.undoStack).toHaveLength(1)
            expect(newState.undoStack[0]).toBe(delta1)
        })

        it('pushes popped delta to redo stack', () => {
            const delta: GraphDelta = createTestDelta('test.md')
            const state: UndoState = pushUndo(createEmptyUndoState(), delta)

            const { newState } = popUndo(state)

            expect(newState.redoStack).toHaveLength(1)
            expect(newState.redoStack[0]).toBe(delta)
        })

        it('accumulates multiple undos in redo stack', () => {
            const delta1: GraphDelta = createTestDelta('first.md')
            const delta2: GraphDelta = createTestDelta('second.md')

            const state1: UndoState = pushUndo(createEmptyUndoState(), delta1)
            const state2: UndoState = pushUndo(state1, delta2)

            const result1: { newState: UndoState; deltaToReverse: GraphDelta | undefined; } = popUndo(state2)
            const state3: UndoState = result1.newState
            const result2: { newState: UndoState; deltaToReverse: GraphDelta | undefined; } = popUndo(state3)
            const state4: UndoState = result2.newState

            expect(state4.undoStack).toHaveLength(0)
            expect(state4.redoStack).toHaveLength(2)
            // Redo stack should be in reverse order (most recent undo first)
            expect(state4.redoStack[0]).toBe(delta1)
            expect(state4.redoStack[1]).toBe(delta2)
        })
    })

    describe('popRedo', () => {
        it('returns undefined deltaToApply for empty redo stack', () => {
            const { newState, deltaToApply } = popRedo(createEmptyUndoState())

            expect(deltaToApply).toBeUndefined()
            expect(newState.undoStack).toEqual([])
            expect(newState.redoStack).toEqual([])
        })

        it('removes and returns most recent delta from redo stack', () => {
            const delta: GraphDelta = createTestDelta('test.md')
            const state: UndoState = pushUndo(createEmptyUndoState(), delta)
            const { newState: stateAfterUndo } = popUndo(state)

            const { newState, deltaToApply } = popRedo(stateAfterUndo)

            expect(deltaToApply).toBe(delta)
            expect(newState.redoStack).toHaveLength(0)
        })

        it('pushes redone delta back to undo stack', () => {
            const delta: GraphDelta = createTestDelta('test.md')
            const state: UndoState = pushUndo(createEmptyUndoState(), delta)
            const { newState: stateAfterUndo } = popUndo(state)
            expect(stateAfterUndo.undoStack).toHaveLength(0)

            const { newState } = popRedo(stateAfterUndo)

            expect(newState.undoStack).toHaveLength(1)
            expect(newState.undoStack[0]).toBe(delta)
        })
    })

    describe('undo/redo cycle', () => {
        it('undo -> redo returns to same state', () => {
            const delta: GraphDelta = createTestDelta('test.md')
            const initialState: UndoState = pushUndo(createEmptyUndoState(), delta)

            const { newState: afterUndo, deltaToReverse } = popUndo(initialState)
            expect(deltaToReverse).toBe(delta)

            const { newState: afterRedo, deltaToApply } = popRedo(afterUndo)
            expect(deltaToApply).toBe(delta)

            // Undo stack should be restored
            expect(afterRedo.undoStack).toHaveLength(1)
            expect(afterRedo.undoStack[0]).toBe(delta)
            expect(afterRedo.redoStack).toHaveLength(0)
        })

        it('new action after undo clears redo', () => {
            const delta1: GraphDelta = createTestDelta('first.md')
            const delta2: GraphDelta = createTestDelta('second.md')

            const state1: UndoState = pushUndo(createEmptyUndoState(), delta1)
            const { newState: afterUndo } = popUndo(state1)
            expect(afterUndo.redoStack).toHaveLength(1)

            // New action should clear redo
            const state2: UndoState = pushUndo(afterUndo, delta2)
            expect(state2.redoStack).toHaveLength(0)
            expect(state2.undoStack).toHaveLength(1)
            expect(state2.undoStack[0]).toBe(delta2)
        })
    })
})
