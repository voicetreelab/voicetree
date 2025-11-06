import type {
  CytoscapeElements,
  CytoscapeNodeElement,
  CytoscapeEdgeElement,
  CytoscapeDiff
} from '@/functional_graph/pure/types'
import type cytoscape from 'cytoscape'

/**
 * PURE: Compute diff between current Cytoscape state and desired elements.
 *
 * This function is:
 * - PURE: No side effects, reads Cytoscape state but doesn't mutate
 * - DETERMINISTIC: Same inputs always produce same output
 * - TESTABLE: Can be tested without DOM or Cytoscape instance
 *
 * @param cy - Current Cytoscape core instance (read-only access)
 * @param desired - Desired Cytoscape elements to reconcile to
 * @returns Diff describing what operations are needed
 */
export function computeCytoscapeDiff(
  cy: cytoscape.Core,
  desired: CytoscapeElements
): CytoscapeDiff {
  // Build lookup structures for desired state
  const desiredNodeMap = new Map(
    desired.nodes.map(n => [n.data.id, n])
  )
  const desiredEdgeMap = new Map(
    desired.edges.map(e => [e.data.id, e])
  )

  // Track current state (excluding special nodes)
  const currentNodeIds = new Set<string>()
  const currentEdgeIds = new Set<string>()

  // Scan current Cytoscape state
  cy.nodes().forEach(node => {
    // Skip special nodes (ghost root, floating windows, etc.)
    if (!node.data('isGhostRoot') && !node.data('isFloatingWindow')) {
      currentNodeIds.add(node.id())
    }
  })

  cy.edges().forEach(edge => {
    currentEdgeIds.add(edge.id())
  })

  // Compute diff operations using functional patterns

  // Partition nodes into add vs update based on existence in current state
  const { nodesToAdd, nodesToUpdate } = desired.nodes.reduce<{
    readonly nodesToAdd: readonly CytoscapeNodeElement[]
    readonly nodesToUpdate: readonly { readonly id: string; readonly data: Partial<CytoscapeNodeElement['data']> }[]
  }>((acc, nodeElem) => {
    if (currentNodeIds.has(nodeElem.data.id)) {
      // Node exists - mark for update
      return {
        ...acc,
        nodesToUpdate: [...acc.nodesToUpdate, { id: nodeElem.data.id, data: nodeElem.data }]
      }
    } else {
      // Node doesn't exist - mark for add
      return {
        ...acc,
        nodesToAdd: [...acc.nodesToAdd, nodeElem]
      }
    }
  }, { nodesToAdd: [], nodesToUpdate: [] })

  // Find nodes to remove (in current but not in desired)
  const nodesToRemove: readonly string[] = Array.from(currentNodeIds).filter(id => !desiredNodeMap.has(id))

  // Find edges to add (in desired but not in current)
  const edgesToAdd: readonly CytoscapeEdgeElement[] = desired.edges.filter(
    edgeElem => !currentEdgeIds.has(edgeElem.data.id)
  )

  // Find edges to remove (in current but not in desired)
  const edgesToRemove: readonly string[] = Array.from(currentEdgeIds).filter(id => !desiredEdgeMap.has(id))

  return {
    nodesToAdd,
    nodesToUpdate,
    nodesToRemove,
    edgesToAdd,
    edgesToRemove
  }
}
