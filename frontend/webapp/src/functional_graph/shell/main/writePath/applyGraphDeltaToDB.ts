import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import { pipe } from 'fp-ts/lib/function.js'
import type { Env, Graph, GraphDelta } from '@/functional_graph/pure/types.ts'
import { apply_graph_deltas_to_db } from '@/functional_graph/pure/applyGraphActionsToDB.ts'
import { getVaultPath } from '@/functional_graph/shell/state/graph-store.ts'

/**
 * Shell-level function to apply graph deltas to the database.
 *
 * This is the impure edge function that:
 * 1. Unwraps the vault path from Option (fail fast)
 * 2. Constructs the Env
 * 3. Executes the pure core effect
 * 4. Unwraps the Either result (fail fast)
 *
 * Per architecture: Pure core returns effects, impure shell executes them.
 * Graph state updates come from file watch handlers detecting the filesystem change.
 */
export async function applyGraphDeltaToDB(graph: Graph, delta: GraphDelta): Promise<void> {
  // Extract vault path (fail fast at edge)
  const vaultPath = pipe(
    getVaultPath(),
    // eslint-disable-next-line functional/no-throw-statements
    O.getOrElseW(() => { throw new Error('Vault path not initialized') })
  )

  // Construct env and execute effect
  const env: Env = { vaultPath }
  const result = await apply_graph_deltas_to_db(graph, delta)(env)()

  // Handle errors (fail fast)
  if (E.isLeft(result)) {
    // eslint-disable-next-line functional/no-throw-statements
    throw result.left
  }
  // result.right contains computed graph but we ignore per architecture
  // Graph state updates come from file watch handlers
}
