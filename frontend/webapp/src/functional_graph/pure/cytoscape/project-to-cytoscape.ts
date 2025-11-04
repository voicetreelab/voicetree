import type {
    Graph,
    CytoscapeElements,
    CytoscapeNodeElement,
    CytoscapeEdgeElement
} from '@/functional_graph/pure/types'
import * as O from 'fp-ts/lib/Option.js'

/**
 * Pure projection function that converts our pure Graph to Cytoscape's UI representation.
 *
 * This function is:
 * - PURE: No side effects, same input always produces same output
 * - IDEMPOTENT: Calling multiple times with same input produces identical results
 * - IMMUTABLE: Does not mutate the input graph
 *
 * @param graph - The pure graph to project
 * @returns CytoscapeElements containing nodes and edges for rendering
 */
export function projectToCytoscape(graph: Graph): CytoscapeElements {
  // Pure projection: Graph → CytoscapeElements
  // This function is PURE, IDEMPOTENT, and IMMUTABLE

  // Project nodes: Map pure GraphNode to Cytoscape representation
  const nodes: readonly CytoscapeNodeElement[] = Object.values(graph.nodes).map(
    (node): CytoscapeNodeElement => ({
      data: {
        id: node.id,
        label: node.title,
        content: node.content,
        summary: node.summary,
        // Unwrap Option<string> to string | undefined for Cytoscape
        color: O.isSome(node.color) ? node.color.value : undefined
      }
    })
  )

  // Project edges: Flatten adjacency list to edge elements
  // Filter out edges where target node doesn't exist (dangling references)
  const edges: readonly CytoscapeEdgeElement[] = Object.entries(graph.edges).flatMap(
    ([sourceId, targets]): readonly CytoscapeEdgeElement[] =>
      targets
        .filter((targetId) => graph.nodes[targetId] !== undefined)
        .map(
          (targetId): CytoscapeEdgeElement => ({
            data: {
              id: `${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId
            }
          })
        )
  )

  return {
    nodes,
    edges
  }
}
