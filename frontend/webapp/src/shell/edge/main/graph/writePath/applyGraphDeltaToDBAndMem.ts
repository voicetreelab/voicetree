import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import { pipe } from 'fp-ts/lib/function.js'
import type { Env, Graph, GraphDelta } from '@/pure/graph'
import { apply_graph_deltas_to_db } from '@/pure/graph/graphActionsToDBEffects.ts'
import {getGraph, getVaultPath, setGraph} from '@/shell/edge/main/state/graph-store.ts'
import type {Either} from "fp-ts/es6/Either";
import {getMainWindow} from '@/shell/edge/main/state/app-electron-state.ts';

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
export async function applyGraphDeltaToDBAndMem(delta: GraphDelta): Promise<void> {
    const graph = getGraph();

    // Extract vault path (fail fast at edge)
  const vaultPath = pipe(
    getVaultPath(),
    O.getOrElseW(() => { throw new Error('Vault path not initialized') })
  )

    // Notify UI of the change early (purposefully unnecessary, fs events do the same)
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }

  // Construct env and execute effect
  const env: Env = { vaultPath }
  const result: Either<Error, Graph> = await apply_graph_deltas_to_db(graph, delta)(env)()

  // Handle errors (fail fast)
  if (E.isLeft(result)) {
    throw result.left
  }
  else {
      // Update in-memory state (purposefully unnecessary, fs events do the same)
      setGraph(result.right)
  }
}
