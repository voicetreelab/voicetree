import type { GraphDelta } from '@/pure/graph'

/**
 * Immutable undo/redo state.
 * Uses readonly arrays to enforce immutability.
 */
export interface UndoState {
    readonly undoStack: readonly GraphDelta[]
    readonly redoStack: readonly GraphDelta[]
}

export const MAX_UNDO_SIZE = 50

/**
 * Creates an empty undo state with no history.
 */
export function createEmptyUndoState(): UndoState {
    return { undoStack: [], redoStack: [] }
}

/**
 * Pushes a new delta to the undo stack.
 * - Adds delta to the front of the undo stack
 * - Clears the redo stack (new action invalidates redo history)
 * - Limits stack size to MAX_UNDO_SIZE
 */
export function pushUndo(state: UndoState, delta: GraphDelta): UndoState {
    const newUndoStack = [delta, ...state.undoStack].slice(0, MAX_UNDO_SIZE)
    return {
        undoStack: newUndoStack,
        redoStack: []  // Clear redo on new action
    }
}

/**
 * Pops the most recent delta from the undo stack.
 * - Returns the delta to reverse and new state
 * - Moves the popped delta to the redo stack
 * - Returns undefined deltaToReverse if stack is empty
 */
export function popUndo(state: UndoState): {
    readonly newState: UndoState
    readonly deltaToReverse: GraphDelta | undefined
} {
    if (state.undoStack.length === 0) {
        return { newState: state, deltaToReverse: undefined }
    }
    const [deltaToReverse, ...remainingUndo] = state.undoStack
    return {
        newState: {
            undoStack: remainingUndo,
            redoStack: [deltaToReverse, ...state.redoStack]
        },
        deltaToReverse
    }
}

/**
 * Pops the most recent delta from the redo stack.
 * - Returns the delta to re-apply and new state
 * - Moves the popped delta back to the undo stack
 * - Returns undefined deltaToApply if stack is empty
 */
export function popRedo(state: UndoState): {
    readonly newState: UndoState
    readonly deltaToApply: GraphDelta | undefined
} {
    if (state.redoStack.length === 0) {
        return { newState: state, deltaToApply: undefined }
    }
    const [deltaToApply, ...remainingRedo] = state.redoStack
    return {
        newState: {
            undoStack: [deltaToApply, ...state.undoStack],
            redoStack: remainingRedo
        },
        deltaToApply
    }
}
