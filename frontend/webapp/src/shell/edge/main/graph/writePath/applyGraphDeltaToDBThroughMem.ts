import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import {applyGraphDeltaToGraph, type Env, type GraphDelta} from '@/pure/graph'
import {apply_graph_deltas_to_db} from '@/pure/graph/graphActionsToDBEffects.ts'
import {getGraph, getVaultPath, setGraph} from '@/shell/edge/main/state/graph-store.ts'
import type {Either} from "fp-ts/es6/Either";

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
export async function applyGraphDeltaToDBThroughMem(delta: GraphDelta): Promise<void> {
    // DO NOT Notify UI of the change here (fs events will do it)
    // and most paths would have done optimistic ui updates already.
    // it would cause bugs to send a graph-state change, as we haven't yet made it idempotent for markdown editors

    // However, do update in-memory state (purposefully unnecessary, fs events do the same, but latency)
    setGraph(applyGraphDeltaToGraph(getGraph(), delta))

    // Extract vault path (fail fast at edge)
    const vaultPath = pipe(
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
