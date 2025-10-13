/**
 * ColaRefinement: Physics-based layout refinement using Cytoscape Cola
 *
 * This module provides an alternative to the naive physics simulation in TidyLayoutStrategy.
 * It uses the sophisticated Cola.js force-directed layout with constraint support.
 *
 * Key features:
 * - Overlap prevention (better than naive repulsion)
 * - Constraint-based positioning (alignment, gaps, flow)
 * - Optimized force calculations
 * - Edge length configuration
 *
 * Usage:
 *   const positions = await applyColaRefinement(cy, initialPositions, options);
 */

import cytoscape, { type Core, type NodeSingular, type EdgeSingular } from 'cytoscape';
import cola from 'cytoscape-cola';

// Register the cola layout extension with cytoscape
cytoscape.use(cola);

export interface Position {
  x: number;
  y: number;
}

export interface NodeInfo {
  id: string;
  size: { width: number; height: number };
  parentId?: string;
  linkedNodeIds?: string[];
  isShadowNode?: boolean;
}

export interface ColaRefinementOptions {
  // Physics simulation
  maxSimulationTime?: number;         // Max time in ms (default: 4000)
  convergenceThreshold?: number;      // Stop when energy below this (default: 0.01)

  // Spacing
  avoidOverlap?: boolean;             // Prevent node overlaps (default: true)
  nodeSpacing?: number | ((node: NodeSingular) => number); // Extra spacing around nodes

  // Tree structure
  flow?: {                            // DAG/tree flow layout
    axis: 'x' | 'y';                  // 'x' for left-right, 'y' for top-down
    minSeparation: number;            // Minimum spacing between levels
  };

  // Edge lengths
  parentChildEdgeLength?: number;     // Length for parent-child edges (default: 300)
  defaultEdgeLength?: number;         // Length for other edges (default: 100)

  // Advanced
  centerGraph?: boolean;              // Center graph after layout (default: true)
  handleDisconnected?: boolean;       // Separate disconnected components (default: true)
}

/**
 * Apply Cola physics refinement to positioned nodes
 *
 * @param cy Cytoscape instance with nodes already added
 * @param initialPositions Starting positions for nodes (typically from Tidy layout)
 * @param allNodes Node metadata for relationship information
 * @param options Cola configuration options
 * @returns Refined positions after physics simulation
 */
export async function applyColaRefinement(
  cy: Core,
  initialPositions: Map<string, Position>,
  allNodes: NodeInfo[],
  options: ColaRefinementOptions = {}
): Promise<Map<string, Position>> {

  console.log('[ColaRefinement] Starting refinement for', initialPositions.size, 'nodes');

  // Apply default options
  const opts = {
    maxSimulationTime: options.maxSimulationTime ?? 10,
    convergenceThreshold: options.convergenceThreshold ?? 1,
    avoidOverlap: options.avoidOverlap ?? true,
    nodeSpacing: options.nodeSpacing ?? 30,
    parentChildEdgeLength: options.parentChildEdgeLength ?? undefined,
    defaultEdgeLength: options.defaultEdgeLength ?? undefined,
    centerGraph: options.centerGraph ?? false,
    handleDisconnected: options.handleDisconnected ?? false,
    flow: options.flow
  };

  // // Step 1: Set initial positions from input
  // for (const [nodeId, pos] of Array.from(initialPositions.entries())) {
  //   const node = cy.getElementById(nodeId);
  //   if (node.length > 0) {
  //     node.position({ x: pos.x, y: pos.y });
  //   }
  // }
  //
  // // Step 2: Build parent map for edge length configuration
  // const parentMap = buildParentMap(allNodes);
  //
  // // Step 3: Determine if node is a leaf (for spacing)
  // const childrenMap = new Map<string, string[]>();
  // for (const node of allNodes) {
  //   const parentId = parentMap.get(node.id);
  //   if (parentId) {
  //     if (!childrenMap.has(parentId)) {
  //       childrenMap.set(parentId, []);
  //     }
  //     childrenMap.get(parentId)!.push(node.id);
  //   }
  // }
  //
  // const isLeafNode = (nodeId: string): boolean => {
  //   const node = allNodes.find(n => n.id === nodeId);
  //   if (!node) return false;
  //
  //   const hasChildren = childrenMap.has(nodeId) && childrenMap.get(nodeId)!.length > 0;
  //   return !hasChildren && !node.isShadowNode;
  // };

  // Step 4: Configure and run Cola layout
  const colaOptions = {
    name: 'cola',
    animate: false,              // We handle animation separately
    randomize: false,            // Start from current (initial) positions
    avoidOverlap: opts.avoidOverlap,
    handleDisconnected: opts.handleDisconnected,
    convergenceThreshold: opts.convergenceThreshold,
    maxSimulationTime: opts.maxSimulationTime,

    // // Spacing configuration
    // nodeSpacing: typeof opts.nodeSpacing === 'function'
    //   ? opts.nodeSpacing
    //   : (node: NodeSingular) => {
    //       // Larger spacing for parent nodes, smaller for leaves
    //       const isLeaf = isLeafNode(node.id());
    //       return isLeaf ? opts.nodeSpacing as number : (opts.nodeSpacing as number) * 2;
    //     },

    // Edge length based on parent-child relationship
    // edgeLength: (edge: EdgeSingular) => {
    //   const sourceId = edge.source().id();
    //   const targetId = edge.target().id();
    //   const parentId = parentMap.get(targetId);
    //
    //   // Parent-child edges should be longer
    //   if (parentId === sourceId) {
    //     return opts.parentChildEdgeLength;
    //   }
    //   return opts.defaultEdgeLength;
    // },

    // Flow layout for tree structure (if specified)
    flow: opts.flow,

    // Other options
    centerGraph: opts.centerGraph,
    fit: false,                  // Don't auto-fit viewport
    padding: 0,

    // Don't include labels in node dimensions (we handle this separately)
    nodeDimensionsIncludeLabels: false,
  };

  // console.log('[ColaRefinement] Running Cola layout with options:', {
  //   avoidOverlap: colaOptions.avoidOverlap,
  //   maxTime: colaOptions.maxSimulationTime,
  //   flow: colaOptions.flow
  // });

  // Run layout
  const layout = cy.layout(colaOptions);

  // Wait for completion
  await new Promise<void>((resolve) => {
    layout.on('layoutstop', () => {
      console.log('[ColaRefinement] Cola layout complete');
      resolve();
    });
    layout.run();
  });

  // Step 5: Extract final positions
  const finalPositions = new Map<string, Position>();
  for (const nodeId of Array.from(initialPositions.keys())) {
    const node = cy.getElementById(nodeId);
    if (node.length > 0) {
      const pos = node.position();
      finalPositions.set(nodeId, { x: pos.x, y: pos.y });
    }
  }

  console.log('[ColaRefinement] Refined', finalPositions.size, 'node positions');
  return finalPositions;
}

/**
 * Build parent map from node metadata
 * Uses explicit parentId first, falls back to linkedNodeIds with cycle prevention
 */
function buildParentMap(nodes: NodeInfo[]): Map<string, string> {
  const parentMap = new Map<string, string>();
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // First pass: collect all explicit parentId relationships
  for (const node of nodes) {
    if (node.parentId && nodeIds.has(node.parentId) && node.parentId !== node.id) {
      parentMap.set(node.id, node.parentId);
    }
  }

  // Second pass: for nodes without explicit parentId, try linkedNodeIds (with cycle check)
  for (const node of nodes) {
    if (parentMap.has(node.id)) {
      continue; // Already has explicit parent
    }

    // Try to use first valid linkedNode as parent (if it doesn't create cycle)
    if (node.linkedNodeIds && node.linkedNodeIds.length > 0) {
      for (const linkedId of node.linkedNodeIds) {
        if (linkedId === node.id || !nodeIds.has(linkedId)) {
          continue; // Skip self-reference or non-existent nodes
        }

        // Check if linkedNode has this node as its parent (would create cycle)
        const linkedNode = nodeMap.get(linkedId);
        if (linkedNode?.parentId === node.id || parentMap.get(linkedId) === node.id) {
          continue; // Skip - would create cycle
        }

        // Valid parent found
        parentMap.set(node.id, linkedId);
        break;
      }
    }
    // Otherwise, node is an orphan (will be handled by Cola's handleDisconnected)
  }

  return parentMap;
}
