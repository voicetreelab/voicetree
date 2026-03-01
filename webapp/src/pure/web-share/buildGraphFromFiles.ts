import type { RelativePath } from './types'
import type { Graph, GraphDelta, FSUpdate } from '@/pure/graph'
import { createEmptyGraph } from '@/pure/graph/createGraph'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'

/**
 * Build a Graph from a map of file paths → content.
 * Identical algorithm to loadGraphFromDisk, minus fs.readFile.
 * Uses existing addNodeToGraphWithEdgeHealingFromFSEvent + applyGraphDeltaToGraph.
 */
export function buildGraphFromFiles(files: ReadonlyMap<RelativePath, string>): Graph {
  return Array.from(files.entries()).reduce(
    (graph, [relativePath, content]) => {
      const fsEvent: FSUpdate = {
        absolutePath: relativePath,
        content,
        eventType: 'Added'
      }
      const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph)
      return applyGraphDeltaToGraph(graph, delta)
    },
    createEmptyGraph()
  )
}
