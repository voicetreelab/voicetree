import { createEmptyGraph } from './createGraph'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from './graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { applyGraphDeltaToGraph } from './graphDelta/applyGraphDeltaToGraph'
import type { Graph, FSUpdate, GraphDelta } from './'

export function buildGraphFromFiles(
  files: readonly { readonly absolutePath: string; readonly content: string }[]
): Graph {
  return files.reduce((graph: Graph, { absolutePath, content }): Graph => {
    const fsEvent: FSUpdate = { absolutePath, content, eventType: 'Added' }
    const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph)
    return applyGraphDeltaToGraph(graph, delta)
  }, createEmptyGraph())
}
