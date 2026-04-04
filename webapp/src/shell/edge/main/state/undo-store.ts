// Re-export shim — actual implementation in @vt/graph-model
export {
    getUndoState,
    resetUndoState,
    recordUserActionAndSetDeltaHistoryState,
    popUndoDelta,
    popRedoDelta,
    canUndo,
    canRedo,
} from '@vt/graph-model'
