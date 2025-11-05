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

  // Compute diff operations
  const nodesToAdd: CytoscapeNodeElement[] = []
  const nodesToUpdate: Array<{ id: string; data: any }> = []
  const nodesToRemove: string[] = []
  const edgesToAdd: CytoscapeEdgeElement[] = []
  const edgesToRemove: string[] = []

  // Find nodes to add/update
  desired.nodes.forEach(nodeElem => {
    if (currentNodeIds.has(nodeElem.data.id)) {
      // Node exists - mark for update
      // Note: We update unconditionally for now. Could add deep comparison later.
      nodesToUpdate.push({
        id: nodeElem.data.id,
        data: nodeElem.data
      })
    } else {
      // Node doesn't exist - mark for add
      nodesToAdd.push(nodeElem)
    }
  })

  // Find nodes to remove
  currentNodeIds.forEach(id => {
    if (!desiredNodeMap.has(id)) {
      nodesToRemove.push(id)
    }
  })

  // Find outgoingEdges to add
  desired.edges.forEach(edgeElem => {
    if (!currentEdgeIds.has(edgeElem.data.id)) {
      edgesToAdd.push(edgeElem)
    }
    // Note: Edges typically don't need updates, so we skip update logic
  })

  // Find outgoingEdges to remove
  currentEdgeIds.forEach(id => {
    if (!desiredEdgeMap.has(id)) {
      edgesToRemove.push(id)
    }
  })

  return {
    nodesToAdd,
    nodesToUpdate,
    nodesToRemove,
    edgesToAdd,
    edgesToRemove
  }
}
