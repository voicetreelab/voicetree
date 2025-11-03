import { projectToCytoscape } from './project-to-cytoscape'
import type { Graph, CytoscapeElements } from './types'
import type { Core as CytoscapeCore } from 'cytoscape'

/**
 * GraphStateManager - Manages graph state subscription and Cytoscape reconciliation.
 *
 * This class is the IMPERATIVE SHELL around our FUNCTIONAL CORE.
 *
 * Responsibilities:
 * 1. Subscribe to graph state broadcasts from main process
 * 2. Project domain Graph to Cytoscape elements (pure)
 * 3. Reconcile Cytoscape DOM to match projected elements (idempotent)
 *
 * IMPORTANT:
 * - Graph state comes ONLY from main process (single source of truth)
 * - Projection is PURE (projectToCytoscape)
 * - Reconciliation is IDEMPOTENT (same input = no-op)
 * - This class does NOT mutate domain state
 */
export class GraphStateManager {
  private readonly cy: CytoscapeCore
  private readonly currentGraph: Graph | null = null

  constructor(cy: CytoscapeCore) {
    this.cy = cy
    this.subscribeToGraphChanges()
  }

  /**
   * Subscribe to graph state broadcasts from main process.
   * Called once during initialization.
   */
  private subscribeToGraphChanges(): void {
    // Check if we're in an Electron environment
    if (typeof window !== 'undefined' && (window as any).electronAPI?.graph?.onStateChanged) {
      (window as any).electronAPI.graph.onStateChanged((graph: Graph) => {
        console.log('[GraphStateManager] Received graph state update:', {
          nodeCount: Object.keys(graph.nodes).length,
          edgeCount: Object.keys(graph.edges).reduce((sum, key) => sum + graph.edges[key].length, 0)
        })
        this.currentGraph = graph
        this.renderGraph(graph)
      })
    } else {
      console.warn('[GraphStateManager] electronAPI.graph not available - running in non-Electron environment?')
    }
  }

  /**
   * Render graph state to Cytoscape.
   * This is the main rendering pipeline: Graph → Elements → Reconciliation
   */
  private renderGraph(graph: Graph): void {
    // PURE projection: Graph → CytoscapeElements
    const elements = projectToCytoscape(graph)

    // IDEMPOTENT reconciliation: Update Cytoscape DOM
    this.reconcileCytoscape(elements)
  }

  /**
   * Reconcile Cytoscape DOM to match desired elements.
   *
   * MUST be IDEMPOTENT: Calling twice with same input has no additional effect.
   *
   * Algorithm:
   * 1. Add/update nodes that exist in elements
   * 2. Add/update edges that exist in elements
   * 3. Remove nodes not in elements
   * 4. Remove edges not in elements
   */
  private reconcileCytoscape(elements: CytoscapeElements): void {
    this.cy.batch(() => {
      // Build sets for efficient lookup
      const desiredNodeIds = new Set(elements.nodes.map(n => n.data.id))
      const desiredEdgeIds = new Set(elements.edges.map(e => e.data.id))

      // Add/update nodes
      elements.nodes.forEach(nodeElem => {
        const existing = this.cy.getElementById(nodeElem.data.id)

        if (existing.length > 0) {
          // Update if data changed
          const currentData = existing.data()
          if (this.hasDataChanged(currentData, nodeElem.data)) {
            existing.data(nodeElem.data)
          }
        } else {
          // Add new node
          this.cy.add({
            group: 'nodes' as const,
            data: nodeElem.data
          })
        }
      })

      // Add/update edges
      elements.edges.forEach(edgeElem => {
        const existing = this.cy.getElementById(edgeElem.data.id)

        if (existing.length === 0) {
          // Add new edge
          this.cy.add({
            group: 'edges' as const,
            data: edgeElem.data
          })
        }
        // Edges typically don't need updates, but we could add logic here if needed
      })

      // Remove nodes not in desired set
      this.cy.nodes().forEach(node => {
        // Skip special nodes (ghost root, floating windows, etc.)
        if (node.data('isGhostRoot') || node.data('isFloatingWindow')) {
          return
        }

        const nodeId = node.id()
        if (!desiredNodeIds.has(nodeId)) {
          node.remove()
        }
      })

      // Remove edges not in desired set
      this.cy.edges().forEach(edge => {
        const edgeId = edge.id()
        if (!desiredEdgeIds.has(edgeId)) {
          edge.remove()
        }
      })
    })
  }

  /**
   * Check if node data has changed.
   * Used to avoid unnecessary updates.
   */
  private hasDataChanged(current: any, next: any): boolean {
    // Deep comparison of data objects
    // Note: This is a simple implementation. For production, consider using a deep equality library.
    return JSON.stringify(current) !== JSON.stringify(next)
  }

  /**
   * Get current graph state (for queries).
   * Returns null if no graph has been loaded yet.
   */
  getCurrentGraph(): Graph | null {
    return this.currentGraph
  }

  /**
   * Manually trigger a re-render.
   * Useful for testing or forced updates.
   */
  forceRender(): void {
    if (this.currentGraph) {
      this.renderGraph(this.currentGraph)
    }
  }
}
