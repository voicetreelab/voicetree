/**
 * Auto Layout: Automatically run Cola layout on graph changes
 *
 * Simple approach: Listen to cytoscape events (add/remove node/edge) and trigger layout.
 * No state tracking, no complexity - just re-layout the whole graph each time.
 */

import type { Core, EdgeSingular } from 'cytoscape';
import ColaLayout from './cola';

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
  maxSimulationTime: 750,
  avoidOverlap: true,
  nodeSpacing: 30,
  handleDisconnected: false, // shouldn't matter with ghost root node
  convergenceThreshold: 3,
  // unconstrIter: 3,
  // userConstIter: 50,
  // allConstIter: 30,
  edgeLength: 200,
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
  const colaOptions = { ...DEFAULT_OPTIONS, ...options };

  let layoutRunning = false;
  let layoutQueued = false;

  const runLayout = () => {
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

    const layout = new ColaLayout({
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
  const debouncedRunLayout = () => {
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
