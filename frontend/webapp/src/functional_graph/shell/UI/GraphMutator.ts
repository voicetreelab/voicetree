// import type { Core as CytoscapeCore, NodeSingular, EdgeSingular } from 'cytoscape';
// import { GHOST_ROOT_ID } from '@/graph-core/constants.ts';
// import { calculateChildAngle, polarToCartesian, SPAWN_RADIUS, calculateParentAngle } from '@/graph-core/graphviz/layout/angularPositionSeeding.ts';

// TODO JUST ENSURE WE HAVE COPIED EVERYTHING NECESSARY FROM HERE TO HANDLE UI ACTIONS

// /**
//  * GraphMutator - Deep module for all graph mutations
//  *
//  * Centralizes node/edge creation, updates, and deletion logic.
//  * Includes positioning calculations to minimize animation thrashing.
//  *
//  * Philosophy: Single responsibility for graph mutations with minimal public API
//  *
//  * Note: Layout is now handled by auto-layout system (see autoLayout.ts)
//  */
// export class GraphMutator {
//   constructor(
//     private cy: CytoscapeCore,
//     // TODO: Remove this parameter in future cleanup (kept for backwards compatibility)
//     // eslint-disable-next-line @typescript-eslint/no-unused-vars
//     _unusedLayoutManager: null
//   ) {}
//
//   /**
//    * Add a new node to the graph with calculated initial position
//    */
//   addNode(data: {
//     nodeId: string;
//     label: string;
//     linkedNodeIds: string[];
//     parentId?: string;
//     color?: string;
//     skipPositioning?: boolean;
//     explicitPosition?: { x: number; y: number };
//   }): NodeSingular {
//     const { nodeId, label, linkedNodeIds, parentId, color, skipPositioning, explicitPosition } = data;
//
//     // Calculate initial position to minimize animation thrashing
//     // Priority: explicitPosition > skipPositioning > calculated position
//     const initialPosition = explicitPosition
//       ? explicitPosition
//       : skipPositioning
//       ? { x: 0, y: 0 }
//       : this.calculateInitialPosition(parentId);
//
//     // Use batch to ensure node and ghost edge are added atomically
//     // This prevents layout from running before ghost edge exists
//     let node: NodeSingular;
//     this.cy.batch(() => {
//       // Create node with all data
//       node = this.cy.add({
//         data: {
//           id: nodeId,
//           label,
//           linkedNodeIds,
//           parentId,
//           ...(color && { color })
//         },
//         position: initialPosition
//       });
//
//       // Connect to ghost root if this is an orphan node (no parent)
//       // This ensures all nodes are part of a single connected component for layout
//       if (!parentId) {
//         // Ensure ghost root exists before creating edge to it
//         // This prevents race condition when ghost root was removed (e.g., during watch stop)
//         this.ensureGhostRoot();
//
//         this.cy.add({
//           data: {
//             id: `${GHOST_ROOT_ID}->${nodeId}`,
//             source: GHOST_ROOT_ID,
//             target: nodeId,
//             isGhostEdge: true
//           }
//         });
//       }
//     });
//
//     return node!;
//   }
//
//   /**
//    * Add an edge between two nodes, ensuring both source and target exist
//    */
//   addEdge(
//     sourceId: string,
//     targetId: string,
//     label?: string
//   ): EdgeSingular {
//     // Ensure both source and target nodes exist
//     // Source might be ghost root which could have been removed
//     if (sourceId === GHOST_ROOT_ID) {
//       this.ensureGhostRoot();
//     } else if (!this.cy.getElementById(sourceId).length) {
//       console.warn(`[GraphMutator] Attempted to create edge with nonexistent source: ${sourceId}. Skipping edge creation.`);
//       return this.cy.collection(); // Return empty collection
//     }
//
//     // Ensure target node exists (create placeholder if needed)
//     this.ensurePlaceholderNode(targetId, sourceId); // todo, suspicious, do we really need this?
//
//     const edgeId = `${sourceId}->${targetId}`;
//
//     // Add edge if it doesn't exist
//     if (!this.cy.getElementById(edgeId).length) {
//       const formattedLabel = label ? label.replace(/_/g, ' ') : '';
//       return this.cy.add({
//         data: {
//           id: edgeId,
//           source: sourceId,
//           target: targetId,
//           label: formattedLabel
//         }
//       });
//     }
//
//     return this.cy.getElementById(edgeId);
//   }
//
//   /**
//    * Update a node's linked nodes and rebuild outgoingEdges
//    * Used when file content changes
//    */
//   updateNodeLinks(
//     nodeId: string,
//     linkedNodeIds: string[],
//     edgeLabels: Map<string, string>
//   ): void {
//     // Update linkedNodeIds data
//     const node = this.cy.getElementById(nodeId);
//     node.data('linkedNodeIds', linkedNodeIds);
//
//     // Get current markdown-based outgoingEdges (exclude programmatic outgoingEdges like floating windows)
//     const currentEdges = this.cy.edges(`[source = "${nodeId}"]`).filter(edge => {
//       const targetNode = edge.target();
//       const isFloatingWindow = targetNode.data('isFloatingWindow');
//       return !isFloatingWindow;
//     });
//
//     // Build map of current edge targets and labels
//     const currentEdgeMap = new Map<string, string>();
//     currentEdges.forEach(edge => {
//       const targetId = edge.target().id();
//       const label = edge.data('label') || '';
//       currentEdgeMap.set(targetId, label);
//     });
//
//     // Build map of new edge targets and labels
//     const newEdgeMap = new Map<string, string>();
//     linkedNodeIds.forEach(targetId => {
//       const label = edgeLabels.get(targetId) || '';
//       newEdgeMap.set(targetId, label);
//     });
//
//     // Check if outgoingEdges actually changed
//     const edgesChanged = this.edgeMapsAreDifferent(currentEdgeMap, newEdgeMap);
//
//     // Only update outgoingEdges if they actually changed (prevents unnecessary layout triggers)
//     if (edgesChanged) {
//       console.log(`[GraphMutator] Edges changed for node ${nodeId}, updating...`);
//
//       // Remove old markdown-based outgoingEdges
//       currentEdges.remove();
//
//       // Recreate outgoingEdges from current wikilinks
//       for (const targetId of linkedNodeIds) {
//         const label = edgeLabels.get(targetId) || '';
//         this.addEdge(nodeId, targetId, label);
//       }
//     } else {
//       console.log(`[GraphMutator] Edges unchanged for node ${nodeId}, skipping update`);
//     }
//   }
//
//   /**
//    * Compare two edge maps to detect changes
//    * Returns true if maps are different (different targets or different labels)
//    */
//   private edgeMapsAreDifferent(
//     map1: Map<string, string>,
//     map2: Map<string, string>
//   ): boolean {
//     // Different number of outgoingEdges
//     if (map1.size !== map2.size) {
//       return true;
//     }
//
//     // Check if all outgoingEdges match (both target and label)
//     for (const [targetId, label] of map1) {
//       if (!map2.has(targetId) || map2.get(targetId) !== label) {
//         return true;
//       }
//     }
//
//     return false;
//   }
//
//   /**
//    * Remove a node from the graph
//    */
//   removeNode(nodeId: string): void {
//     this.cy.getElementById(nodeId).remove();
//   }
//
//   /**
//    * Bulk add multiple nodes (for initial load)
//    * Returns array of created nodes
//    */
//   bulkAddNodes(nodesData: Array<{
//     nodeId: string;
//     label: string;
//     linkedNodeIds: string[];
//     edgeLabels: Map<string, string>;
//     parentId?: string;
//     color?: string;
//     explicitPosition?: { x: number; y: number };
//   }>): NodeSingular[] {
//     const createdNodes: NodeSingular[] = [];
//
//     // Wrap entire bulk operation in a single batch for performance
//     // This fires only ONE 'add' event instead of N events
//     this.cy.batch(() => {
//       // PHASE 1: Create all nodes first (so parents exist when children reference them)
//       for (const data of nodesData) {
//         const { nodeId, label, linkedNodeIds, parentId, color, explicitPosition } = data;
//
//         // Check if node already exists
//         const existingNode = this.cy.getElementById(nodeId);
//         if (existingNode.length > 0) {
//           // Update existing node
//           existingNode.data('linkedNodeIds', linkedNodeIds);
//           continue;
//         }
//
//         // Add new node with explicit position if provided, otherwise skip positioning
//         const node = this.addNode({
//           nodeId,
//           label,
//           linkedNodeIds,
//           parentId,
//           color,
//           skipPositioning: !explicitPosition,
//           explicitPosition
//         });
//         createdNodes.push(node);
//       }
//
//       // PHASE 2: Create all outgoingEdges after all nodes exist
//       for (const data of nodesData) {
//         const { nodeId, linkedNodeIds, edgeLabels } = data;
//
//         for (const targetId of linkedNodeIds) {
//           const label = edgeLabels.get(targetId) || '';
//           this.addEdge(nodeId, targetId, label);
//         }
//       }
//     });
//
//     return createdNodes;
//   }
//
//     // pos moved to src/functional_graph/pure/positioning/calculateInitialPosition.ts
//
//   /**
//    * Ensure a node exists, creating a placeholder if necessary
//    * Used for edge targets that don't have markdown files yet
//    */
//   private ensurePlaceholderNode(targetId: string, referenceNodeId: string): void {
//     if (!this.cy.getElementById(targetId).length) {
//       // Position placeholder near reference node
//       const referenceNode = this.cy.getElementById(referenceNodeId);
//       let placeholderPos = { x: this.cy.width() / 2, y: this.cy.height() / 2 };
//
//       if (referenceNode.length > 0) {
//         const refPos = referenceNode.position();
//         placeholderPos = {
//           x: refPos.x + 150,
//           y: refPos.y
//         };
//       }
//
//       this.cy.add({
//         data: {
//           id: targetId,
//           label: targetId.replace(/_/g, ' '),
//           linkedNodeIds: []
//         },
//         position: placeholderPos
//       });
//     }
//   }
//
//   /**
//    * Ensure ghost root node exists in the graph
//    * This prevents race conditions where ghost root is removed but still referenced
//    */
//   private ensureGhostRoot(): void {
//     if (!this.cy.getElementById(GHOST_ROOT_ID).length) {
//       console.log('[GraphMutator] Ghost root missing, recreating...');
//       this.cy.add({
//         data: {
//           id: GHOST_ROOT_ID,
//           label: '',
//           linkedNodeIds: [],
//           isGhostRoot: true
//         },
//         position: { x: 0, y: 0 }
//       });
//     }
//   }
// }
