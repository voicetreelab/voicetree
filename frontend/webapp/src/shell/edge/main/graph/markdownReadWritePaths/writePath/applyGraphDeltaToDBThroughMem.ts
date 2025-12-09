import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import {type Env, type GraphDelta} from '@/pure/graph'
import {apply_graph_deltas_to_db} from '@/shell/edge/main/graph/graphActionsToDBEffects'
import {getWatchedDirectory} from '@/shell/edge/main/graph/watchFolder'
import {recordUserActionAndSetDeltaHistoryState} from '@/shell/edge/main/state/undo-store'
import type {Either} from "fp-ts/es6/Either";
import {
    applyGraphDeltaToMemState,
    broadcastGraphDelta
} from "@/shell/edge/main/graph/markdownReadWritePaths/applyGraphDeltaToMemStateAndUI";

/**
 * Shell-level function to apply graph deltas to the database.
 *
 * This is the impure edge function that:
 * 1. Unwraps the vault path from Option (fail fast)
 * 2. Constructs the Env
 * 3. Executes the pure core effect
 * 4. Unwraps the Either result (fail fast)
 * 5. Updates in-memory state and broadcasts to UI
 *
 * Per architecture: Pure core returns effects, impure shell executes them.
 * We update MEM + broadcast immediately to avoid waiting for file watcher events.
 */
export async function applyGraphDeltaToDBThroughMem(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    // Record for undo BEFORE applying (so we can reverse from current state)
    if (recordForUndo) {
        recordUserActionAndSetDeltaHistoryState(delta)
    }

    // Update in-memory state
    applyGraphDeltaToMemState(delta)

    // Broadcast to UI - this triggers graph UI updates (cytoscape nodes/edges)
    // The renderer's VoiceTreeGraphView.handleGraphDelta calls both:
    // - applyGraphDeltaToUI (cytoscape updates)
    // - updateFloatingEditors (editor content sync)
    //
    // For editor-originated changes, the editor deduplication mechanism
    // (awaitingUISavedContent) prevents feedback loops to the same editor.
    broadcastGraphDelta(delta)

    // Note: FS event acknowledgement is now handled per-file in graphActionsToDBEffects.ts
    // using content hash matching instead of delta hash matching

    // Extract watched directory (fail fast at edge)
    const watchedDirectory: string = pipe(
        O.fromNullable(getWatchedDirectory()),
        O.getOrElseW(() => {
            throw new Error('Watched directory not initialized')
        })
    )

    // Construct env and execute effect
    const env: Env = {watchedDirectory}
    const result: Either<Error, GraphDelta> = await apply_graph_deltas_to_db(delta)(env)()

    // Handle errors (fail fast)
    if (E.isLeft(result)) {
        throw result.left
    }
}
