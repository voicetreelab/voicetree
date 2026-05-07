import type { RelativePath } from './types'
import type { Graph, GraphDelta, FSUpdate } from '../graph'
import { createEmptyGraph } from '../graph/createGraph'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '../graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { applyGraphDeltaToGraph } from '../graph/graphDelta/applyGraphDeltaToGraph'

/**
 * Build a Graph from a map of file paths → content.
 * Identical algorithm to loadGraphFromDisk, minus fs.readFile.
 * Uses existing addNodeToGraphWithEdgeHealingFromFSEvent + applyGraphDeltaToGraph.
 */
export function buildGraphFromFiles(files: ReadonlyMap<RelativePath, string>): Graph {
  const mdFiles: Map<RelativePath, string> = new Map(
    Array.from(files.entries()).filter(([path]) => path.endsWith('.md'))
  )
  return Array.from(mdFiles.entries()).reduce(
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
