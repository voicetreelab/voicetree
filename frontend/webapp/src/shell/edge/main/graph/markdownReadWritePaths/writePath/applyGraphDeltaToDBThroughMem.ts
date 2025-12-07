import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import {applyGraphDeltaToGraph, type Env, type GraphDelta} from '@/pure/graph'
import {apply_graph_deltas_to_db} from '@/shell/edge/main/graph/graphActionsToDBEffects'
import {getGraph, setGraph} from '@/shell/edge/main/state/graph-store'
import {getVaultPath} from '@/shell/edge/main/graph/watchFolder'
import {recordUserActionAndSetDeltaHistoryState} from '@/shell/edge/main/state/undo-store'
import type {Either} from "fp-ts/es6/Either";
import {
    applyGraphDeltaToMemStateAndUI
} from "@/shell/edge/main/graph/markdownReadWritePaths/applyGraphDeltaToMemStateAndUI";
import {hashGraphDelta} from "@/pure/graph/deltaHashing";
import {addUnacknowledgedDelta} from "@/shell/edge/main/state/unacknowledged-deltas-store";

/**
 * Shell-level function to apply graph deltas to the database.
 *
 * This is the impure edge function that:
 * 1. Unwraps the vault path from Option (fail fast)
 * 2. Constructs the Env
 * 3. Executes the pure core effect
 * 4. Unwraps the Either result (fail fast)
 * 5. Updates in-memory state and notifies UI
 *
 * Per architecture: Pure core returns effects, impure shell executes them.
 * We update the UI immediately to avoid waiting for file watcher events.
 */
export async function applyGraphDeltaToDBThroughMem(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    // Record for undo BEFORE applying (so we can reverse from current state)
    if (recordForUndo) {
        recordUserActionAndSetDeltaHistoryState(delta)
    }

    // DO NOT Notify UI of the change here (fs events will do it)
    // and most paths would have done optimistic ui updates already.
    // it would cause bugs to send a graph-state change, as we haven't yet made it idempotent for markdown editors

    // However, do update in-memory state (purposefully unnecessary, fs events do the same, but latency)
    // setGraph(applyGraphDeltaToGraph(getGraph(), delta))
    // todo, i undisabled this, bc it broke spawnTerminalWithCommandFromUI which assumed node already in mem ( no wait req'd)
    // todo, disabling this because it can introduce bugs and complexity
    // for example, if a new node is created from ui, optimistic ui, and gets written to mem
    // then, when fs event comes thru it won't be a new node delta (already exists)
    // but the original new node delta, was never extracted from recent deltas
    // bc the original delta was in th
    // etc etc...
    // just ensure one path...

    applyGraphDeltaToMemStateAndUI(delta)

    // Track this delta so the FS event handler will skip it (already applied)
    addUnacknowledgedDelta(hashGraphDelta(delta), delta)

    // Extract vault path (fail fast at edge)
    const vaultPath: string = pipe(
        getVaultPath(),
        O.getOrElseW(() => {
            throw new Error('Vault path not initialized')
        })
    )

    // Construct env and execute effect
    const env: Env = {vaultPath}
    const result: Either<Error, GraphDelta> = await apply_graph_deltas_to_db(delta)(env)()

    // Handle errors (fail fast)
    if (E.isLeft(result)) {
        throw result.left
    }
}
