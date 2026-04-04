import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import {applyGraphDeltaToGraph, type Env, type Graph, type GraphDelta} from '../pure/graph'
import {apply_graph_deltas_to_db} from './graphActionsToDBEffects'
import {recordUserActionAndSetDeltaHistoryState} from '../state/undo-store'
import type {Either} from "fp-ts/es6/Either";
import {getGraph, setGraph} from "../state/graph-store";
import {resolveLinkedNodesInWatchedFolder} from "./loadGraphFromDisk";
import {getProjectRootWatchedDirectory} from "../state/watch-folder-store";
import {loadSettings} from "../settings/settings_IO";
import {getCallbacks} from '../types'

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
        if (watchedDir && newGraph.unresolvedLinksIndex.size > 0) {
            const resolutionDelta: GraphDelta = await resolveLinkedNodesInWatchedFolder(newGraph, watchedDir);
            if (resolutionDelta.length > 0) {
                newGraph = applyGraphDeltaToGraph(newGraph, resolutionDelta);
                // Merge resolution delta into original for caller
                delta = [...delta, ...resolutionDelta];
            }
        }
    }

    setGraph(newGraph);

    // Fire onNewNode hook (fire-and-forget). Runs for both UI and FS-event paths.
    // dispatchOnNewNodeHooks filters for UpsertNode with previousNode=None, so
    // delete-only deltas (e.g. removeReadPath) are no-ops.
    void loadSettings().then(settings => {
        const hookPath: string | undefined = settings.hooks?.onNewNode
        if (hookPath && !hookPath.startsWith('#')) {
            const callbacks = getCallbacks()
            if (callbacks.onNewNodeHook) {
                // Dispatch for each new node upsert
                for (const d of delta) {
                    if (d.type === 'UpsertNode' && O.isNone(d.previousNode)) {
                        callbacks.onNewNodeHook(d.nodeToUpsert.absoluteFilePathIsID, delta)
                    }
                }
            }
        }
    })

    return delta;
}

export function broadcastGraphDeltaToUI(delta: GraphDelta): void {
    const callbacks = getCallbacks()
    callbacks.onGraphDelta?.(delta)
    // Debounced push of unseen node counts to InjectBar badges
    callbacks.refreshBadge?.()
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

/**
 * Apply delta to DB through memory and UI, plus notify floating editors.
 * The floating editor update is delegated to the onFloatingEditorUpdate callback.
 */
export async function applyGraphDeltaToDBThroughMemAndUIAndEditors(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    await applyGraphDeltaToDBThroughMemAndUI(delta, recordForUndo)
    getCallbacks().onFloatingEditorUpdate?.(delta)
}
