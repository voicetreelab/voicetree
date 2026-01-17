import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import path from 'path'
import {applyGraphDeltaToGraph, type Env, type Graph, type GraphDelta, type NodeDelta, type GraphNode} from '@/pure/graph'
import {apply_graph_deltas_to_db} from '@/shell/edge/main/graph/graphActionsToDBEffects'
import {getWatchedDirectory} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {recordUserActionAndSetDeltaHistoryState} from '@/shell/edge/main/state/undo-store'
import type {Either} from "fp-ts/es6/Either";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";

/**
 * Normalize node IDs in a delta to absolute paths.
 *
 * This ensures consistency between:
 * - Node IDs stored in the graph
 * - Node IDs stored in recent-deltas-store (for duplicate detection)
 * - Node IDs computed by the file watcher from absolute file paths
 *
 * Without this normalization, the file watcher would create duplicate nodes
 * because it computes absolute IDs but the graph might store relative IDs.
 */
function normalizeNodeIdsToAbsolute(delta: GraphDelta, watchedDirectory: string): GraphDelta {
    return delta.map((nodeDelta: NodeDelta): NodeDelta => {
        if (nodeDelta.type === 'UpsertNode') {
            const nodeId: string = nodeDelta.nodeToUpsert.absoluteFilePathIsID
            // If already absolute, no change needed
            if (path.isAbsolute(nodeId)) {
                return nodeDelta
            }
            // Convert relative to absolute
            const absoluteNodeId: string = path.join(watchedDirectory, nodeId)
            const normalizedNode: GraphNode = {
                ...nodeDelta.nodeToUpsert,
                absoluteFilePathIsID: absoluteNodeId
            }
            return {
                ...nodeDelta,
                nodeToUpsert: normalizedNode
            }
        } else {
            // DeleteNode
            const nodeId: string = nodeDelta.nodeId
            if (path.isAbsolute(nodeId)) {
                return nodeDelta
            }
            return {
                ...nodeDelta,
                nodeId: path.join(watchedDirectory, nodeId)
            }
        }
    })
}

export function applyGraphDeltaToMemState(delta: GraphDelta): void {
    const currentGraph: Graph = getGraph();
    const newGraph: Graph = applyGraphDeltaToGraph(currentGraph, delta);
    setGraph(newGraph);
}

export function broadcastGraphDeltaToUI(delta: GraphDelta): void {
    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}



export async function applyGraphDeltaToDBThroughMemAndUI(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    // Extract watched directory (fail fast at edge)
    const watchedDirectory: string = pipe(
        O.fromNullable(getWatchedDirectory()),
        O.getOrElseW(() => {
            throw new Error('Watched directory not initialized')
        })
    )

    // Normalize node IDs to absolute paths FIRST
    // This ensures consistency with file watcher (which computes absolute IDs)
    // and prevents duplicate node creation from relative/absolute ID mismatch
    const normalizedDelta: GraphDelta = normalizeNodeIdsToAbsolute(delta, watchedDirectory)
    console.log('[applyGraphDelta] Normalized delta node IDs:', normalizedDelta.map(d => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : d.nodeId))

    // Record for undo BEFORE applying (so we can reverse from current state)
    if (recordForUndo) {
        recordUserActionAndSetDeltaHistoryState(normalizedDelta)
    }

    applyGraphDeltaToMemState(normalizedDelta)

    broadcastGraphDeltaToUI(normalizedDelta)

    // Construct env and execute effect
    const env: Env = {watchedDirectory}
    const result: Either<Error, GraphDelta> = await apply_graph_deltas_to_db(normalizedDelta)(env)()

    // Handle errors (fail fast)
    if (E.isLeft(result)) {
        throw result.left
    }
}