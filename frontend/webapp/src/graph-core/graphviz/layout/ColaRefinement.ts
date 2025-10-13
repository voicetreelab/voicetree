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

import cytoscape, { type Core } from 'cytoscape';
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
  // Physics simulation (animate:true spreads iterations across frames)
  maxSimulationTime?: number;         // Max time in ms (default: 100)
  convergenceThreshold?: number;      // Stop when energy below this (default: 0.01)

  // Iteration limits (optional - mainly for testing)
  unconstrIter?: number;              // Unconstrained initial layout iterations
  userConstIter?: number;             // Initial layout iterations with user-specified constraints
  allConstIter?: number;              // Initial layout iterations with all constraints

  // Spacing
  avoidOverlap?: boolean;             // Prevent node overlaps (default: true)

  // Tree structure
  flow?: {                            // DAG/tree flow layout
    axis: 'x' | 'y';                  // 'x' for left-right, 'y' for top-down
    minSeparation: number;            // Minimum spacing between levels
  };

  // Advanced
  centerGraph?: boolean;              // Center graph after layout (default: false)
  handleDisconnected?: boolean;       // Separate disconnected components (default: false)
}

/**
 * Apply Cola physics refinement to positioned nodes
 *
 * @param cy Cytoscape instance with nodes already added
 * @param initialPositions Starting positions for nodes (typically from Tidy layout)
 * @param options Cola configuration options
 * @returns Refined positions after physics simulation
 */
export async function applyColaRefinement(
  cy: Core,
  initialPositions: Map<string, Position>,
  options: ColaRefinementOptions = {}
): Promise<Map<string, Position>> {

  console.log('[ColaRefinement] Starting refinement for', initialPositions.size, 'nodes');

  // CRITICAL: Set initial positions on Cytoscape nodes before running Cola
  // Without this, Cola starts from scratch instead of refining existing layout!
  for (const [nodeId, pos] of initialPositions) {
    const node = cy.getElementById(nodeId);
    if (node.length > 0) {
      node.position({ x: pos.x, y: pos.y });
    }
  }

  const colaOptions = {
    name: 'cola',
    animate: true, // Critical: spreads iterations across frames, respects maxSimulationTime
    randomize: false,
    avoidOverlap: options.avoidOverlap ?? true,
    handleDisconnected: options.handleDisconnected ?? false,
    convergenceThreshold: options.convergenceThreshold ?? 1,
    maxSimulationTime: options.maxSimulationTime ?? 100, // Now this actually works!
    unconstrIter: options.unconstrIter ?? undefined,
    userConstIter: options.userConstIter ?? undefined,
    allConstIter: options.allConstIter ?? undefined,
    flow: options.flow,
    centerGraph: options.centerGraph ?? false,
    fit: false,
    padding: 0,
    nodeDimensionsIncludeLabels: true,
  };

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
