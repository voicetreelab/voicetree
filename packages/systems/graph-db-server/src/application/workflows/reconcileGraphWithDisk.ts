import { access } from 'node:fs/promises'
import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks, type DeleteNode, type Graph, type GraphDelta } from '@vt/graph-model'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { publish } from '@vt/graph-db-server/state/events/deltaEventBus'
import { isPendingWrite } from '@vt/graph-db-server/watch-folder/pending-writes'
import {
    applyGraphDeltaToMemState,
    refreshGraphChangeSideEffects,
} from '@vt/graph-db-server/graph/applyGraphDelta'

async function pathExistsOnDisk(absolutePath: string): Promise<boolean> {
    try {
        await access(absolutePath)
        return true
    } catch {
        return false
    }
}

/**
 * One-shot reconciliation: delete graph nodes whose backing files are gone
 * from disk. Skips paths with pending daemon writes (so a delete racing a
 * write does not undo the write). Applies the resulting delta to memory and
 * broadcasts it via the same sequence handleFSEventWithStateAndUISides uses.
 *
 * Used at vault-open and on the daemon `/graph/reconcile-disk` route so that
 * an external file removal (git checkout, manual `rm`, agent batch) does not
 * leave stale nodes in the in-memory graph or in any open floating editors.
 *
 * Lives in application/ (shell layer) because the `fs.access` probe is an
 * effect; per the FP rearchitecting guidance, effects belong at the shell
 * boundary, not in data/.
 */
export async function reconcileGraphWithDisk(): Promise<GraphDelta> {
    const currentGraph: Graph = getGraph()
    const deletes: DeleteNode[] = []
    for (const [nodeId, node] of Object.entries(currentGraph.nodes)) {
        if (isPendingWrite(nodeId)) continue
        if (await pathExistsOnDisk(nodeId)) continue
        deletes.push({ type: 'DeleteNode', nodeId, deletedNode: O.some(node) })
    }
    if (deletes.length === 0) return []

    const mergedDelta: GraphDelta = await applyGraphDeltaToMemState(deletes)
    refreshGraphChangeSideEffects()
    publish({ delta: mergedDelta, source: 'reconcile:disk', suppressForSubscribers: [] })
    getCallbacks().onFloatingEditorUpdate?.(mergedDelta, [])
    return mergedDelta
}
