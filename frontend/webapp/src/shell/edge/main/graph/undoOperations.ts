import { applyGraphDeltaToDBThroughMem } from '@/shell/edge/main/graph/markdownReadWritePaths/writePath/applyGraphDeltaToDBThroughMem'
import { popUndoDelta, popRedoDelta } from '@/shell/edge/main/state/undo-store'

/**
 * Performs undo operation by reversing the last user action.
 * Returns true if undo was performed, false if nothing to undo.
 */
export async function performUndo(): Promise<boolean> {
    const reverseDelta = popUndoDelta()
    if (reverseDelta === undefined) {
        return false
    }
    // Apply reverse delta WITHOUT recording for undo (would create infinite loop)
    await applyGraphDeltaToDBThroughMem(reverseDelta, false)
    return true
}

/**
 * Performs redo operation by re-applying a previously undone action.
 * Returns true if redo was performed, false if nothing to redo.
 */
export async function performRedo(): Promise<boolean> {
    const deltaToApply = popRedoDelta()
    if (deltaToApply === undefined) {
        return false
    }
    // Apply delta WITHOUT recording for undo (it's already in the stack)
    await applyGraphDeltaToDBThroughMem(deltaToApply, false)
    return true
}
