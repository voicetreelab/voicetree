/**
 * Auto Layout: Automatically run Cola layout on graph changes
 *
 * Simple approach: Listen to cytoscape events (add/remove node/edge) and trigger layout.
 * No state tracking, no complexity - just re-layout the whole graph each time.
 *
 * NOTE (commit 033c57a4): We tried a two-phase layout algorithm that ran Phase 1 with only
 * constraint iterations (no unconstrained) for fast global stabilization, then Phase 2 ran
 * full iterations on just the neighborhood of most-displaced nodes. We tried this algo, and
 * that it was okay, but went on for too long since it doubled the animation period, and the
 * second phase could still be quite janky which was what we were trying to avoid.
 */

import type {Core, EdgeSingular, NodeDefinition, NodeSingular, Position} from 'cytoscape';
import ColaLayout from './cola';
import {CONTEXT_NODE_EDGE_LENGTH, DEFAULT_EDGE_LENGTH} from './cytoscape-graph-constants';
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';

// Registry for layout triggers - allows external code to trigger layout via triggerLayout(cy)
const layoutTriggers = new Map<Core, () => void>();

/**
 * Trigger a debounced layout run for the given cytoscape instance.
 * Use this for user-initiated resize events (expand button, CSS drag resize).
 */
export function triggerLayout(cy: Core): void {
  layoutTriggers.get(cy)?.();
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

const DEFAULT_OPTIONS: AutoLayoutOptions = {
  animate: true,
  maxSimulationTime: 1750,
  avoidOverlap: true,
  nodeSpacing: 10,
  handleDisconnected: true, // handles disconnected components
  convergenceThreshold: 0.5,
  unconstrIter: 10, // TODO SOMETHINIG ABOUT THIS IS VERY IMPORTANT LAYOUT BREAK WITHOUT
  userConstIter: 10,
  allConstIter: 20,
  edgeLength: (edge: EdgeSingular) => {
    const source: NodeSingular = edge.source();
    const target: NodeSingular = edge.target();

    // Dynamic edge length for terminal shadow nodes based on placement direction
    const isTerminalShadow: boolean = target.data('isShadowNode') === true &&
                             target.data('windowType') === 'Terminal';
    const targetIsContextNode: boolean = target.data('isContextNode') === true;

    if (isTerminalShadow) {
      // Terminal only spawns in cardinal directions (right, left, above, below)
      // so we just need to check if horizontal or vertical placement
      const sourcePos: Position = source.position();
      const targetPos: Position = target.position();
      const dx: number = Math.abs(targetPos.x - sourcePos.x);
      const dy: number = Math.abs(targetPos.y - sourcePos.y);
      const gap: number = 20;

      if (dx > dy) {
        // Horizontal placement: use widths
        return (target.width() / 2) + (source.width() / 2) + gap;
      } else {
        // Vertical placement: use heights
        return (target.height() / 2) + (source.height() / 2) + gap;
      }
    }
    if (targetIsContextNode){
        return CONTEXT_NODE_EDGE_LENGTH;
    }
    return DEFAULT_EDGE_LENGTH;
  },
  // edgeSymDiffLength: undefined,
  // edgeJaccardLength: undefined
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

  const runLayout: () => void = () => {
    // If layout already running, queue another run for after it completes
    if (layoutRunning) {
      layoutQueued = true;
      return;
    }

    // Skip if no nodes
    if (cy.nodes().length === 0) {
      return;
    }

    console.log('[AutoLayout] Running Cola layout on', cy.nodes().length, 'nodes');
    layoutRunning = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = new (ColaLayout as any)({
      cy: cy,
      eles: cy.elements(),
      animate: colaOptions.animate,
      randomize: false, // Don't randomize - preserve existing positions
      avoidOverlap: colaOptions.avoidOverlap,
      handleDisconnected: colaOptions.handleDisconnected,
      convergenceThreshold: colaOptions.convergenceThreshold,
      maxSimulationTime: colaOptions.maxSimulationTime,
      unconstrIter: colaOptions.unconstrIter,
      userConstIter: colaOptions.userConstIter,
      allConstIter: colaOptions.allConstIter,
      nodeSpacing: colaOptions.nodeSpacing,
      edgeLength: colaOptions.edgeLength,
      edgeSymDiffLength: colaOptions.edgeSymDiffLength,
      edgeJaccardLength: colaOptions.edgeJaccardLength,
      centerGraph: false,
      fit: false,
      // padding: 0,
      nodeDimensionsIncludeLabels: true,
    });

    layout.one('layoutstop', () => {
      console.log('[AutoLayout] Cola layout complete');
      void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);
      layoutRunning = false;

      // If another layout was queued, run it now
      if (layoutQueued) {
        layoutQueued = false;
        runLayout();
      }
    });
    layout.run();
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

  // NOTE: We intentionally do NOT listen to 'floatingwindow:resize' here.
  // That event fires on zoom-induced dimension changes (not just user resize),
  // which would cause unnecessary full layout recalculations during zoom/pan.
  // Shadow node dimensions still update correctly without triggering layout.
  // User-initiated resizes (expand button, CSS drag) call triggerLayout() directly.

  // Register trigger for external callers (user-initiated resize)
  layoutTriggers.set(cy, debouncedRunLayout);

  console.log('[AutoLayout] Auto-layout enabled');

  // Return cleanup function
  return () => {
    cy.off('add', 'node', debouncedRunLayout);
    cy.off('remove', 'node', debouncedRunLayout);
    cy.off('add', 'edge', debouncedRunLayout);
    cy.off('remove', 'edge', debouncedRunLayout);
    layoutTriggers.delete(cy);

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    console.log('[AutoLayout] Auto-layout disabled');
  };
}
