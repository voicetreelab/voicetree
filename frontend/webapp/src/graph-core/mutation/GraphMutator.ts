import type { Core as CytoscapeCore, NodeSingular, EdgeSingular } from 'cytoscape';
import { GHOST_ROOT_ID } from '@/graph-core/constants';
import { calculateChildAngle, polarToCartesian, SPAWN_RADIUS, calculateParentAngle } from '@/graph-core/graphviz/layout/angularPositionSeeding';

/**
 * GraphMutator - Deep module for all graph mutations
 *
 * Centralizes node/edge creation, updates, and deletion logic.
 * Includes positioning calculations to minimize animation thrashing.
 *
 * Philosophy: Single responsibility for graph mutations with minimal public API
 *
 * Note: Layout is now handled by auto-layout system (see autoLayout.ts)
 */
export class GraphMutator {
  constructor(
    private cy: CytoscapeCore,
    // TODO: Remove this parameter in future cleanup (kept for backwards compatibility)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _unusedLayoutManager: null
  ) {}

  /**
   * Add a new node to the graph with calculated initial position
   */
  addNode(data: {
    nodeId: string;
    label: string;
    linkedNodeIds: string[];
    parentId?: string;
    color?: string;
    skipPositioning?: boolean;
  }): NodeSingular {
    const { nodeId, label, linkedNodeIds, parentId, color, skipPositioning } = data;

    // Calculate initial position to minimize animation thrashing
    // Skip positioning for bulk loads (layout will handle it)
    const initialPosition = skipPositioning
      ? { x: 0, y: 0 }
      : this.calculateInitialPosition(parentId);

    // Use batch to ensure node and ghost edge are added atomically
    // This prevents layout from running before ghost edge exists
    let node: NodeSingular;
    this.cy.batch(() => {
      // Create node with all data
      node = this.cy.add({
        data: {
          id: nodeId,
          label,
          linkedNodeIds,
          parentId,
          ...(color && { color })
        },
        position: initialPosition
      });

      // Connect to ghost root if this is an orphan node (no parent)
      // This ensures all nodes are part of a single connected component for layout
      if (!parentId) {
        this.cy.add({
          data: {
            id: `${GHOST_ROOT_ID}->${nodeId}`,
            source: GHOST_ROOT_ID,
            target: nodeId,
            isGhostEdge: true
          }
        });
      }
    });

    return node!;
  }

  /**
   * Add an edge between two nodes, ensuring target node exists
   */
  addEdge(
    sourceId: string,
    targetId: string,
    label?: string
  ): EdgeSingular {
    // Ensure target node exists (create placeholder if needed)
    this.ensurePlaceholderNode(targetId, sourceId);

    const edgeId = `${sourceId}->${targetId}`;

    // Add edge if it doesn't exist
    if (!this.cy.getElementById(edgeId).length) {
      const formattedLabel = label ? label.replace(/_/g, ' ') : '';
      return this.cy.add({
        data: {
          id: edgeId,
          source: sourceId,
          target: targetId,
          label: formattedLabel
        }
      });
    }

    return this.cy.getElementById(edgeId);
  }

  /**
   * Update a node's linked nodes and rebuild edges
   * Used when file content changes
   */
  updateNodeLinks(
    nodeId: string,
    linkedNodeIds: string[],
    edgeLabels: Map<string, string>
  ): void {
    // Update linkedNodeIds data
    const node = this.cy.getElementById(nodeId);
    node.data('linkedNodeIds', linkedNodeIds);

    // IMPORTANT: Remove old markdown-based edges, but preserve programmatic edges
    // (e.g., floating window edges with isFloatingWindow=true)
    const edgesToRemove = this.cy.edges(`[source = "${nodeId}"]`).filter(edge => {
      const targetNode = edge.target();
      const isFloatingWindow = targetNode.data('isFloatingWindow');
      return !isFloatingWindow;
    });
    edgesToRemove.remove();

    // Recreate edges from current wikilinks
    for (const targetId of linkedNodeIds) {
      const label = edgeLabels.get(targetId) || '';
      this.addEdge(nodeId, targetId, label);
    }
  }

  /**
   * Remove a node from the graph
   */
  removeNode(nodeId: string): void {
    this.cy.getElementById(nodeId).remove();
  }

  /**
   * Bulk add multiple nodes (for initial load)
   * Returns array of created nodes
   */
  bulkAddNodes(nodesData: Array<{
    nodeId: string;
    label: string;
    linkedNodeIds: string[];
    edgeLabels: Map<string, string>;
    parentId?: string;
    color?: string;
  }>): NodeSingular[] {
    const createdNodes: NodeSingular[] = [];

    // Wrap entire bulk operation in a single batch for performance
    // This fires only ONE 'add' event instead of N events
    this.cy.batch(() => {
      // PHASE 1: Create all nodes first (so parents exist when children reference them)
      for (const data of nodesData) {
        const { nodeId, label, linkedNodeIds, parentId, color } = data;

        // Check if node already exists
        const existingNode = this.cy.getElementById(nodeId);
        if (existingNode.length > 0) {
          // Update existing node
          existingNode.data('linkedNodeIds', linkedNodeIds);
          continue;
        }

        // Add new node with skip positioning (layout will position them)
        const node = this.addNode({
          nodeId,
          label,
          linkedNodeIds,
          parentId,
          color,
          skipPositioning: true
        });
        createdNodes.push(node);
      }

      // PHASE 2: Create all edges after all nodes exist
      for (const data of nodesData) {
        const { nodeId, linkedNodeIds, edgeLabels } = data;

        for (const targetId of linkedNodeIds) {
          const label = edgeLabels.get(targetId) || '';
          this.addEdge(nodeId, targetId, label);
        }
      }
    });

    return createdNodes;
  }

  /**
   * Calculate initial position for a new node using angular positioning
   * Position at calculated angle relative to parent
   */
  private calculateInitialPosition(parentId?: string): { x: number; y: number } {
    if (parentId) {
      const parentNode = this.cy.getElementById(parentId);
      if (parentNode.length > 0) {
        const parentPos = parentNode.position();
        const parentAngle = calculateParentAngle(parentNode, this.cy);

        // Count existing siblings (children with same parentId)
        const siblingCount = this.cy.nodes().filter(n => n.data('parentId') === parentId).length;

        // Calculate angle for this child (will be the Nth child, 0-indexed)
        const angle = calculateChildAngle(siblingCount, parentAngle);

        // Convert to cartesian offset
        const offset = polarToCartesian(angle, SPAWN_RADIUS);

        return {
          x: parentPos.x + offset.x,
          y: parentPos.y + offset.y
        };
      }
    }

    // No parent - root node at origin
    return { x: 0, y: 0 };
  }

  /**
   * Ensure a node exists, creating a placeholder if necessary
   * Used for edge targets that don't have markdown files yet
   */
  private ensurePlaceholderNode(targetId: string, referenceNodeId: string): void {
    if (!this.cy.getElementById(targetId).length) {
      // Position placeholder near reference node
      const referenceNode = this.cy.getElementById(referenceNodeId);
      let placeholderPos = { x: this.cy.width() / 2, y: this.cy.height() / 2 };

      if (referenceNode.length > 0) {
        const refPos = referenceNode.position();
        placeholderPos = {
          x: refPos.x + 150,
          y: refPos.y
        };
      }

      this.cy.add({
        data: {
          id: targetId,
          label: targetId.replace(/_/g, ' '),
          linkedNodeIds: []
        },
        position: placeholderPos
      });
    }
  }
}
