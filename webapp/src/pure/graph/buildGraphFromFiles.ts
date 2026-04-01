import { createEmptyGraph } from '@/pure/graph/createGraph'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'
import type { Graph, FSUpdate, GraphDelta } from '@/pure/graph'

export function buildGraphFromFiles(
  files: readonly { readonly absolutePath: string; readonly content: string }[]
): Graph {
  return files.reduce((graph: Graph, { absolutePath, content }): Graph => {
    const fsEvent: FSUpdate = { absolutePath, content, eventType: 'Added' }
    const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph)
    return applyGraphDeltaToGraph(graph, delta)
  }, createEmptyGraph())
}
