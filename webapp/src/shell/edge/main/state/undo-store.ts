// Re-export shim — actual implementation in @vt/graph-db-server
export {
    getUndoState,
    resetUndoState,
    recordUserActionAndSetDeltaHistoryState,
    popUndoDelta,
    popRedoDelta,
    canUndo,
    canRedo,
} from '@vt/graph-db-server/state/undo-store'
