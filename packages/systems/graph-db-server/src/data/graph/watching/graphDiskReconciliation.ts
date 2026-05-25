import { access } from 'node:fs/promises'
import * as O from 'fp-ts/lib/Option.js'
import type { DeleteNode, Graph, GraphDelta } from '@vt/graph-model/graph'
import { getCallbacks } from '@vt/graph-model'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { publish } from '@vt/graph-db-server/state/events/deltaEventBus'
import {
  applyGraphDeltaToMemState,
  refreshGraphChangeSideEffects,
} from '../mutations/applyGraphDelta.ts'
import { isPendingWrite } from '@vt/graph-db-server/watch-folder/pending-writes'

export interface GraphDiskReconciliationDependencies {
  readonly readGraph: () => Graph
  readonly graphNodePathExists: (nodeId: string) => Promise<boolean>
  readonly isPendingWrite: (nodeId: string) => boolean
  readonly applyGraphDeltaToMemState: (delta: GraphDelta) => Promise<GraphDelta>
  readonly publishDelta: (delta: GraphDelta) => void
  readonly refreshGraphChangeSideEffects: () => void
  readonly updateFloatingEditors: (delta: GraphDelta) => void
}

export async function graphNodePathExists(nodeId: string): Promise<boolean> {
  try {
    await access(nodeId)
    return true
  } catch {
    return false
  }
}

export const defaultDependencies: GraphDiskReconciliationDependencies = {
  readGraph: getGraph,
  graphNodePathExists,
  isPendingWrite,
  applyGraphDeltaToMemState,
  publishDelta(delta: GraphDelta): void {
    publish({ delta, source: 'reconcile:disk' })
  },
  refreshGraphChangeSideEffects,
  updateFloatingEditors(delta: GraphDelta): void {
    getCallbacks().onFloatingEditorUpdate?.(delta)
  },
}

export async function buildMissingFileDeleteDelta(
  graph: Graph,
  dependencies: Pick<
    GraphDiskReconciliationDependencies,
    'graphNodePathExists' | 'isPendingWrite'
  > = defaultDependencies,
): Promise<GraphDelta> {
  const deletes: DeleteNode[] = []

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (dependencies.isPendingWrite(nodeId)) continue
    if (await dependencies.graphNodePathExists(nodeId)) continue

    deletes.push({
      type: 'DeleteNode',
      nodeId,
      deletedNode: O.some(node),
    })
  }

  return deletes
}

export async function reconcileGraphWithDisk(
  dependencies: GraphDiskReconciliationDependencies = defaultDependencies,
): Promise<GraphDelta> {
  const delta: GraphDelta = await buildMissingFileDeleteDelta(
    dependencies.readGraph(),
    dependencies,
  )
  if (delta.length === 0) return []

  const appliedDelta: GraphDelta = await dependencies.applyGraphDeltaToMemState(delta)
  dependencies.refreshGraphChangeSideEffects()
  dependencies.publishDelta(appliedDelta)
  dependencies.updateFloatingEditors(appliedDelta)
  return appliedDelta
}
