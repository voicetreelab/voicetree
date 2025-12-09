/**
 * Auto Layout: Automatically run Cola layout on graph changes
 *
 * Two-phase layout approach to fix shrink-expand bug while maintaining quality:
 * - Phase 1: Fast global stabilization (constraints only, no unconstrained iterations)
 * - Phase 2: Quality pass on local neighborhood of most-displaced nodes
 */

import type {Core, EdgeSingular, NodeDefinition, NodeSingular, Position as CyPosition} from 'cytoscape';
import ColaLayout from './cola';

// ============================================================================
// Position tracking types and helpers for two-phase layout
// ============================================================================

interface Position {
  readonly x: number;
  readonly y: number;
}

type PositionMap = ReadonlyMap<string, Position>;

/**
 * Captures current positions of all nodes
 */
function capturePositions(cy: Core): PositionMap {
  const positions: Map<string, Position> = new Map<string, Position>();
  cy.nodes().forEach((node: NodeSingular) => {
    const pos: CyPosition = node.position();
    positions.set(node.id(), { x: pos.x, y: pos.y });
  });
  return positions;
}

/**
 * Finds the top N nodes with highest displacement between two position snapshots.
 * Complexity: O(N log N) due to sorting. Could be optimized to O(N) using quickselect.
 */
function findTopNDisplaced(
  before: PositionMap,
  after: PositionMap,
  n: number,
  cy: Core
): NodeSingular[] {
  const displacements: Array<{ node: NodeSingular; displacement: number }> = [];

  cy.nodes().forEach((node: NodeSingular) => {
    const id: string = node.id();
    const beforePos: Position | undefined = before.get(id);
    const afterPos: Position | undefined = after.get(id);

    if (beforePos && afterPos) {
      const displacement: number = Math.hypot(
        afterPos.x - beforePos.x,
        afterPos.y - beforePos.y
      );
      displacements.push({ node, displacement });
    }
  });

  // Sort by displacement descending and take top N
  displacements.sort((a, b) => b.displacement - a.displacement);
  return displacements.slice(0, n).map(d => d.node);
}

/**
 * Finds the closest N nodes to any of the seed nodes by Euclidean distance.
 * This catches nearby disconnected components that BFS would miss.
 * Complexity: O(N log N) due to sorting. Could be optimized to O(N) using quickselect.
 */
function getClosestNodesByEuclidean(
  cy: Core,
  seedNodes: NodeSingular[],
  count: number
): Set<string> {
  const seedIds: Set<string> = new Set(seedNodes.map(n => n.id()));
  const distances: Array<{ id: string; distance: number }> = [];

  cy.nodes().forEach((node: NodeSingular) => {
    const id: string = node.id();

    // Seed nodes have distance 0
    if (seedIds.has(id)) {
      distances.push({ id, distance: 0 });
      return;
    }

    // Find minimum distance to any seed node
    const pos: CyPosition = node.position();
    let minDist: number = Infinity;

    for (const seed of seedNodes) {
      const seedPos: CyPosition = seed.position();
      const dist: number = Math.hypot(pos.x - seedPos.x, pos.y - seedPos.y);
      minDist = Math.min(minDist, dist);
    }

    distances.push({ id, distance: minDist });
  });

  // Sort by distance ascending and take top N
  distances.sort((a, b) => a.distance - b.distance);
  return new Set(distances.slice(0, count).map(d => d.id));
}

export interface AutoLayoutOptions {
  animate?: boolean;
  maxSimulationTime?: number;
  avoidOverlap?: boolean;
  nodeSpacing?: number;
  handleDisconnected?: boolean;
  convergenceThreshold?: number;
  unconstrIter?: number;
  userConstIter?: number;
  allConstIter?: number;
  // Edge length options - different methods of specifying edge length
  edgeLength?: number | ((edge: EdgeSingular) => number);
  edgeSymDiffLength?: number | ((edge: EdgeSingular) => number);
  edgeJaccardLength?: number | ((edge: EdgeSingular) => number);
}

// Two-phase layout configuration
interface TwoPhaseConfig {
  readonly phase1: {
    readonly unconstrIter: number;
    readonly userConstIter: number;
    readonly allConstIter: number;
  };
  readonly phase2: {
    readonly unconstrIter: number;
    readonly userConstIter: number;
    readonly allConstIter: number;
  };
  readonly topNDisplaced: number;
  readonly neighborhoodSize: number;
  readonly minDisplacementThreshold: number;
}

const TWO_PHASE_CONFIG: TwoPhaseConfig = {
  // Phase 1: Fast global stabilization (no shrink-expand because constraints always active)
  phase1: {
    unconstrIter: 0,
    userConstIter: 0,
    allConstIter: 20,
  },
  // Phase 2: Quality pass on local neighborhood
  phase2: {
    unconstrIter: 20,
    userConstIter: 20,
    allConstIter: 20,
  },
  // How many most-displaced nodes to consider as seeds for neighborhood
  topNDisplaced: 3,
  // Size of neighborhood for Phase 2 (closest N nodes by Euclidean distance)
  neighborhoodSize: 20,
  // Minimum displacement (px) to trigger Phase 2; below this, Phase 1 result is good enough
  minDisplacementThreshold: 5,
} as const;

const DEFAULT_OPTIONS: AutoLayoutOptions = {
  animate: true,
  maxSimulationTime: 1750,
  avoidOverlap: true,
  nodeSpacing: 20,
  handleDisconnected: true,
  convergenceThreshold: 1,
  // These are now overridden per-phase in the two-phase algorithm
  unconstrIter: TWO_PHASE_CONFIG.phase1.unconstrIter,
  userConstIter: TWO_PHASE_CONFIG.phase1.userConstIter,
  allConstIter: TWO_PHASE_CONFIG.phase1.allConstIter,
  edgeLength: 200,
};

/**
 * Enable automatic layout on graph changes
 *
 * Listens to node/edge add/remove events and triggers Cola layout
 *
 * @param cy Cytoscape instance
 * @param options Cola layout options
 * @returns Cleanup function to disable auto-layout
 */
export function enableAutoLayout(cy: Core, options: AutoLayoutOptions = {}): () => void {
  const colaOptions: { animate?: boolean; maxSimulationTime?: number; avoidOverlap?: boolean; nodeSpacing?: number; handleDisconnected?: boolean; convergenceThreshold?: number; unconstrIter?: number; userConstIter?: number; allConstIter?: number; edgeLength?: number | ((edge: EdgeSingular) => number); edgeSymDiffLength?: number | ((edge: EdgeSingular) => number); edgeJaccardLength?: number | ((edge: EdgeSingular) => number); } = { ...DEFAULT_OPTIONS, ...options };

  let layoutRunning: boolean = false;
  let layoutQueued: boolean = false;

  /**
   * Creates and runs a Cola layout with specified iteration parameters
   */
  const createAndRunLayout: (
    iterConfig: { unconstrIter: number; userConstIter: number; allConstIter: number },
    onComplete: () => void
  ) => void = (iterConfig, onComplete) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: unknown = new (ColaLayout as unknown as new (opts: unknown) => { one: (event: string, cb: () => void) => void; run: () => void })({
      cy: cy,
      eles: cy.elements(),
      animate: colaOptions.animate,
      randomize: false,
      avoidOverlap: colaOptions.avoidOverlap,
      handleDisconnected: colaOptions.handleDisconnected,
      convergenceThreshold: colaOptions.convergenceThreshold,
      maxSimulationTime: colaOptions.maxSimulationTime,
      unconstrIter: iterConfig.unconstrIter,
      userConstIter: iterConfig.userConstIter,
      allConstIter: iterConfig.allConstIter,
      nodeSpacing: colaOptions.nodeSpacing,
      edgeLength: colaOptions.edgeLength,
      edgeSymDiffLength: colaOptions.edgeSymDiffLength,
      edgeJaccardLength: colaOptions.edgeJaccardLength,
      centerGraph: false,
      fit: false,
      nodeDimensionsIncludeLabels: true,
    });

    const typedLayout: { one: (event: string, cb: () => void) => void; run: () => void } = layout as { one: (event: string, cb: () => void) => void; run: () => void };
    typedLayout.one('layoutstop', onComplete);
    typedLayout.run();
  };

  /**
   * Two-phase layout algorithm:
   * Phase 1: Fast global stabilization (no shrink-expand)
   * Phase 2: Quality pass on local neighborhood of most-displaced nodes
   */
  const runLayout: () => void = () => {
    if (layoutRunning) {
      layoutQueued = true;
      return;
    }

    if (cy.nodes().length === 0) {
      return;
    }

    const nodeCount: number = cy.nodes().length;
    console.log('[AutoLayout] Running two-phase Cola layout on', nodeCount, 'nodes');
    layoutRunning = true;

    // Capture positions before Phase 1
    const beforePositions: PositionMap = capturePositions(cy);

    // Phase 1: Fast global stabilization (constraints only, no unconstrained iterations)
    console.log('[AutoLayout] Phase 1: Global stabilization');
    createAndRunLayout(TWO_PHASE_CONFIG.phase1, () => {
      // Capture positions after Phase 1
      const afterPhase1Positions: PositionMap = capturePositions(cy);

      // Find top N nodes with highest displacement
      const topDisplaced: NodeSingular[] = findTopNDisplaced(
        beforePositions,
        afterPhase1Positions,
        TWO_PHASE_CONFIG.topNDisplaced,
        cy
      );

      // Check if any node moved significantly enough to warrant Phase 2
      const maxDisplacement: number = topDisplaced.length > 0
        ? Math.hypot(
            (afterPhase1Positions.get(topDisplaced[0].id())?.x ?? 0) - (beforePositions.get(topDisplaced[0].id())?.x ?? 0),
            (afterPhase1Positions.get(topDisplaced[0].id())?.y ?? 0) - (beforePositions.get(topDisplaced[0].id())?.y ?? 0)
          )
        : 0;

      // Skip Phase 2 if displacement is below threshold
      if (maxDisplacement < TWO_PHASE_CONFIG.minDisplacementThreshold) {
        console.log('[AutoLayout] Phase 1 sufficient (displacement:', maxDisplacement.toFixed(1), 'px)');
        finishLayout();
        return;
      }

      // Get neighborhood by Euclidean distance (catches disconnected but nearby nodes)
      const neighborhood: Set<string> = getClosestNodesByEuclidean(
        cy,
        topDisplaced,
        TWO_PHASE_CONFIG.neighborhoodSize
      );

      // Lock all nodes outside the neighborhood for Phase 2
      cy.nodes().forEach((node: NodeSingular) => {
        if (!neighborhood.has(node.id())) {
          node.lock();
        }
      });

      console.log('[AutoLayout] Phase 2: Quality pass on', neighborhood.size, 'nodes');

      // Phase 2: Quality pass on local neighborhood only
      createAndRunLayout(TWO_PHASE_CONFIG.phase2, () => {
        // Unlock all nodes
        cy.nodes().unlock();
        console.log('[AutoLayout] Two-phase layout complete');
        finishLayout();
      });
    });
  };

  const finishLayout: () => void = () => {
    // Save positions via electron API if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronWindow: { electronAPI?: { main: { saveNodePositions: (nodes: NodeDefinition[]) => Promise<void> } } } = window as { electronAPI?: { main: { saveNodePositions: (nodes: NodeDefinition[]) => Promise<void> } } };
    if (electronWindow.electronAPI?.main.saveNodePositions) {
      void electronWindow.electronAPI.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);
    }
    layoutRunning = false;

    if (layoutQueued) {
      layoutQueued = false;
      runLayout();
    }
  };

  // Debounce helper to avoid rapid-fire layouts
  // Set to 300ms to prevent flickering during markdown editing (editor autosave is 100ms)
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  const debouncedRunLayout: () => void = () => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(() => {
      runLayout();
      debounceTimeout = null;
    }, 300); // 300ms debounce - prevents flickering during markdown typing
  };

  // Listen to graph modification events
  cy.on('add', 'node', debouncedRunLayout);
  cy.on('remove', 'node', debouncedRunLayout);
  cy.on('add', 'edge', debouncedRunLayout);
  cy.on('remove', 'edge', debouncedRunLayout);

  // Listen to floating window resize (custom event from your codebase)
  cy.on('floatingwindow:resize', debouncedRunLayout);

  console.log('[AutoLayout] Auto-layout enabled');

  // Return cleanup function
  return () => {
    cy.off('add', 'node', debouncedRunLayout);
    cy.off('remove', 'node', debouncedRunLayout);
    cy.off('add', 'edge', debouncedRunLayout);
    cy.off('remove', 'edge', debouncedRunLayout);
    cy.off('floatingwindow:resize', debouncedRunLayout);

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    console.log('[AutoLayout] Auto-layout disabled');
  };
}
