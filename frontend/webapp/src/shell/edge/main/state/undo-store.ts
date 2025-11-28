import type { GraphDelta } from '@/pure/graph'
import {
    createEmptyUndoState,
    pushUndo,
    popUndo,
    popRedo,
    reverseDelta,
    type UndoState
} from '@/pure/graph/undo'

// The ONLY mutable undo state in the functional architecture
let undoState: UndoState = createEmptyUndoState()

// Getter for current undo state (primarily for debugging/testing)
export const getUndoState = (): UndoState => undoState

// Reset undo state (e.g., when changing vaults)
export const resetUndoState = (): void => {
    undoState = createEmptyUndoState()
}

/**
 * Records a user action for undo support.
 * Call this BEFORE applying the delta to the graph.
 */
export const recordUserAction = (delta: GraphDelta): void => {
    undoState = pushUndo(undoState, delta)
}

/**
 * Pops from undo stack and returns the reversed delta to apply.
 * Returns undefined if nothing to undo.
 */
export const popUndoDelta = (): GraphDelta | undefined => {
    const { newState, deltaToReverse } = popUndo(undoState)
    undoState = newState

    if (deltaToReverse === undefined) {
        return undefined
    }

    return reverseDelta(deltaToReverse)
}

/**
 * Pops from redo stack and returns the delta to re-apply.
 * Returns undefined if nothing to redo.
 */
export const popRedoDelta = (): GraphDelta | undefined => {
    const { newState, deltaToApply } = popRedo(undoState)
    undoState = newState
    return deltaToApply
}

// Convenience getters for UI feedback
export const canUndo = (): boolean => undoState.undoStack.length > 0
export const canRedo = (): boolean => undoState.redoStack.length > 0
