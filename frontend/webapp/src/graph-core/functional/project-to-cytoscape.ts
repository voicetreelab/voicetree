import * as O from 'fp-ts/Option'
import {
  Graph,
  CytoscapeElements,
  CytoscapeNodeElement,
  CytoscapeEdgeElement,
  NodeId
} from './types'

/**
 * Pure projection function that converts our domain Graph to Cytoscape's UI representation.
 *
 * This function is:
 * - PURE: No side effects, same input always produces same output
 * - IDEMPOTENT: Calling multiple times with same input produces identical results
 * - IMMUTABLE: Does not mutate the input graph
 *
 * @param graph - The domain graph to project
 * @returns CytoscapeElements containing nodes and edges for rendering
 */
export function projectToCytoscape(graph: Graph): CytoscapeElements {
  // Pure projection: Graph → CytoscapeElements
  // This function is PURE, IDEMPOTENT, and IMMUTABLE

  // Project nodes: Map domain GraphNode to Cytoscape representation
  const nodes: readonly CytoscapeNodeElement[] = Object.values(graph.nodes).map(
    (node): CytoscapeNodeElement => ({
      data: {
        id: node.id,
        label: node.title,
        content: node.content,
        summary: node.summary,
        color: node.color
      }
    })
  )

  // Project edges: Flatten adjacency list to edge elements
  const edges: readonly CytoscapeEdgeElement[] = Object.entries(graph.edges).flatMap(
    ([sourceId, targets]): readonly CytoscapeEdgeElement[] =>
      targets.map(
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
