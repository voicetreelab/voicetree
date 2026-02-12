import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import {applyGraphDeltaToGraph, type Env, type Graph, type GraphDelta} from '@/pure/graph'
import {apply_graph_deltas_to_db} from '@/shell/edge/main/graph/graphActionsToDBEffects'
import {recordUserActionAndSetDeltaHistoryState} from '@/shell/edge/main/state/undo-store'
import type {Either} from "fp-ts/es6/Either";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";
import {resolveLinkedNodesInWatchedFolder} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk";
import {getProjectRootWatchedDirectory} from "@/shell/edge/main/state/watch-folder-store";
import {refreshAllInjectBadges} from "@/shell/edge/main/terminals/inject-badge-refresh";

/**
 * Applies a delta to the in-memory graph state and resolves any new wikilinks.
 *
 * This is the unified path for both FS events and editor changes.
 * After applying the delta, it resolves any wikilinks that point to files
 * in the watched folder (lazy resolution).
 *
 * @param delta - The delta to apply
 * @returns The merged delta (original + any resolved links) for UI broadcast
 */
export async function applyGraphDeltaToMemState(delta: GraphDelta): Promise<GraphDelta> {
    const currentGraph: Graph = getGraph();
    let newGraph: Graph = applyGraphDeltaToGraph(currentGraph, delta);

    // Only resolve wikilinks when delta contains UpsertNode (which might introduce new links)
    // Skip for delete-only deltas - we don't want to re-add deleted nodes via link resolution
    const hasAddOrUpdate: boolean = delta.some(d => d.type === 'UpsertNode');

    if (hasAddOrUpdate) {
        const watchedDir: string | null = getProjectRootWatchedDirectory();
        if (watchedDir) {
            const resolutionDelta: GraphDelta = await resolveLinkedNodesInWatchedFolder(newGraph, watchedDir);
            if (resolutionDelta.length > 0) {
                newGraph = applyGraphDeltaToGraph(newGraph, resolutionDelta);
                // Merge resolution delta into original for caller
                delta = [...delta, ...resolutionDelta];
            }
        }
    }

    setGraph(newGraph);
    return delta;
}

export function broadcastGraphDeltaToUI(delta: GraphDelta): void {
    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
    // Debounced push of unseen node counts to InjectBar badges
    refreshAllInjectBadges();
}



export async function applyGraphDeltaToDBThroughMemAndUI(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    // Extract watched directory (fail fast at edge)
    const watchedDirectory: string = pipe(
        O.fromNullable(getProjectRootWatchedDirectory()),
        O.getOrElseW(() => {
            throw new Error('Watched directory not initialized')
        })
    )

    // Record for undo BEFORE applying (so we can reverse from current state)
    if (recordForUndo) {
        recordUserActionAndSetDeltaHistoryState(delta)
    }

    // Apply to memory and resolve any new wikilinks (returns merged delta)
    const mergedDelta: GraphDelta = await applyGraphDeltaToMemState(delta)

    // Broadcast merged delta (includes resolved links) to UI
    broadcastGraphDeltaToUI(mergedDelta)

    // Construct env and execute effect (only original delta goes to DB)
    const env: Env = {projectRootWatchedDirectory: watchedDirectory}
    const result: Either<Error, GraphDelta> = await apply_graph_deltas_to_db(delta)(env)()

    // Handle errors (fail fast)
    if (E.isLeft(result)) {
        throw result.left
    }
}