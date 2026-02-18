/**
 * Auto Layout: Automatically run Cola or fcose layout on graph changes
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

import cytoscape from 'cytoscape';
import type {Core, EdgeSingular, NodeDefinition, CollectionReturnValue, Layouts} from 'cytoscape';
import ColaLayout from './cola';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - cytoscape-fcose has no bundled types; ambient declaration in utils/types/cytoscape-fcose.d.ts
import fcose from 'cytoscape-fcose';
import { getEdgeDistance } from './cytoscape-graph-constants';
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';
import { consumePendingPan } from '@/shell/edge/UI-edge/state/PendingPanStore';
import { onSettingsChange } from '@/shell/edge/UI-edge/api';

// Register fcose extension once
let fcoseRegistered: boolean = false;
function registerFcose(): void {
  if (!fcoseRegistered) {
    cytoscape.use(fcose);
    fcoseRegistered = true;
  }
}

// Registry for layout triggers - allows external code to trigger layout via triggerLayout(cy)
const layoutTriggers: Map<Core, () => void> = new Map<Core, () => void>();

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

interface FcoseLayoutOptions {
  quality: 'default' | 'proof';
  initialEnergyOnIncremental: number;
  gravity: number;
  gravityRange: number;
  tile: boolean;
  tilingPaddingVertical: number;
  tilingPaddingHorizontal: number;
  nodeRepulsion: number;
  idealEdgeLength: number;
  edgeElasticity: number;
  nodeSpacing: number;
}

interface LayoutConfig {
  engine: 'cola' | 'fcose';
  cola: AutoLayoutOptions;
  fcose: FcoseLayoutOptions;
}

const DEFAULT_OPTIONS: AutoLayoutOptions = {
  animate: true,
  maxSimulationTime: 2000,
  avoidOverlap: true,
  nodeSpacing: 70,
  handleDisconnected: true, // handles disconnected components
  convergenceThreshold: 0.4,
  unconstrIter: 15, // TODO SOMETHINIG ABOUT THIS IS VERY IMPORTANT LAYOUT BREAK WITHOUT
  userConstIter: 15,
  allConstIter: 25,
  edgeLength: (edge: EdgeSingular) => {
    return getEdgeDistance(edge.target().data('windowType'));
  },
  // edgeSymDiffLength: undefined,
  // edgeJaccardLength: undefined
};

const DEFAULT_FCOSE_OPTIONS: FcoseLayoutOptions = {
  quality: 'default',
  initialEnergyOnIncremental: 0.3,
  gravity: 0.1,
  gravityRange: 3.8,
  tile: true,
  tilingPaddingVertical: 10,
  tilingPaddingHorizontal: 10,
  nodeRepulsion: 10000,
  idealEdgeLength: 250,
  edgeElasticity: 0.45,
  nodeSpacing: 70,
};

/**
 * Parse layoutConfig JSON string into typed layout options.
 * Falls back to cola defaults on any parse error.
 */
function parseLayoutConfig(json: string | undefined): LayoutConfig {
  if (!json) {
    return { engine: 'cola', cola: DEFAULT_OPTIONS, fcose: DEFAULT_FCOSE_OPTIONS };
  }

  try {
    const parsed: Record<string, unknown> = JSON.parse(json) as Record<string, unknown>;
    const engine: 'cola' | 'fcose' = parsed.engine === 'fcose' ? 'fcose' : 'cola';

    const cola: AutoLayoutOptions = {
      ...DEFAULT_OPTIONS,
      nodeSpacing: typeof parsed.nodeSpacing === 'number' ? parsed.nodeSpacing : DEFAULT_OPTIONS.nodeSpacing,
      convergenceThreshold: typeof parsed.convergenceThreshold === 'number' ? parsed.convergenceThreshold : DEFAULT_OPTIONS.convergenceThreshold,
      unconstrIter: typeof parsed.unconstrIter === 'number' ? parsed.unconstrIter : DEFAULT_OPTIONS.unconstrIter,
      allConstIter: typeof parsed.allConstIter === 'number' ? parsed.allConstIter : DEFAULT_OPTIONS.allConstIter,
      handleDisconnected: typeof parsed.handleDisconnected === 'boolean' ? parsed.handleDisconnected : DEFAULT_OPTIONS.handleDisconnected,
      edgeLength: typeof parsed.edgeLength === 'number'
        ? parsed.edgeLength
        : DEFAULT_OPTIONS.edgeLength,
    };

    const fcoseOpts: FcoseLayoutOptions = {
      quality: parsed.quality === 'default' || parsed.quality === 'proof' ? parsed.quality : DEFAULT_FCOSE_OPTIONS.quality,
      initialEnergyOnIncremental: typeof parsed.initialEnergyOnIncremental === 'number' ? parsed.initialEnergyOnIncremental : DEFAULT_FCOSE_OPTIONS.initialEnergyOnIncremental,
      gravity: typeof parsed.gravity === 'number' ? parsed.gravity : DEFAULT_FCOSE_OPTIONS.gravity,
      gravityRange: typeof parsed.gravityRange === 'number' ? parsed.gravityRange : DEFAULT_FCOSE_OPTIONS.gravityRange,
      tile: typeof parsed.tile === 'boolean' ? parsed.tile : DEFAULT_FCOSE_OPTIONS.tile,
      tilingPaddingVertical: typeof parsed.tilingPaddingVertical === 'number' ? parsed.tilingPaddingVertical : DEFAULT_FCOSE_OPTIONS.tilingPaddingVertical,
      tilingPaddingHorizontal: typeof parsed.tilingPaddingHorizontal === 'number' ? parsed.tilingPaddingHorizontal : DEFAULT_FCOSE_OPTIONS.tilingPaddingHorizontal,
      nodeRepulsion: typeof parsed.nodeRepulsion === 'number' ? parsed.nodeRepulsion : DEFAULT_FCOSE_OPTIONS.nodeRepulsion,
      idealEdgeLength: typeof parsed.idealEdgeLength === 'number' ? parsed.idealEdgeLength : DEFAULT_FCOSE_OPTIONS.idealEdgeLength,
      edgeElasticity: typeof parsed.edgeElasticity === 'number' ? parsed.edgeElasticity : DEFAULT_FCOSE_OPTIONS.edgeElasticity,
      nodeSpacing: typeof parsed.nodeSpacing === 'number' ? parsed.nodeSpacing : DEFAULT_FCOSE_OPTIONS.nodeSpacing,
    };

    return { engine, cola, fcose: fcoseOpts };
  } catch {
    return { engine: 'cola', cola: DEFAULT_OPTIONS, fcose: DEFAULT_FCOSE_OPTIONS };
  }
}

/**
 * Enable automatic layout on graph changes
 *
 * Listens to node/edge add/remove events and triggers Cola or fcose layout
 * based on layoutConfig from settings.
 *
 * @param cy Cytoscape instance
 * @param options Cola layout options (used as additional overrides)
 * @returns Cleanup function to disable auto-layout
 */
export function enableAutoLayout(cy: Core, options: AutoLayoutOptions = {}): () => void {
  // Mutable config that gets updated when settings change
  let currentConfig: LayoutConfig = { engine: 'cola', cola: { ...DEFAULT_OPTIONS, ...options }, fcose: DEFAULT_FCOSE_OPTIONS };

  // Load initial config from settings
  void window.electronAPI?.main.loadSettings().then(settings => {
    currentConfig = parseLayoutConfig(settings.layoutConfig);
    // Merge any explicit options passed to enableAutoLayout into cola config
    currentConfig.cola = { ...currentConfig.cola, ...options };
  });

  // Subscribe to settings changes to pick up layoutConfig edits
  const unsubSettings: () => void = onSettingsChange(() => {
    void window.electronAPI?.main.loadSettings().then(settings => {
      currentConfig = parseLayoutConfig(settings.layoutConfig);
      currentConfig.cola = { ...currentConfig.cola, ...options };
      // Re-run layout with new config
      debouncedRunLayout();
    });
  });

  let layoutRunning: boolean = false;
  let layoutQueued: boolean = false;
  let layoutCount: number = 0;

  const onLayoutComplete: () => void = () => {
    void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);
    layoutRunning = false;

    // Execute any pending pan after layout completes (instead of arbitrary timeout)
    // This ensures viewport fits to new nodes only after their positions are finalized
    consumePendingPan(cy);

    // If another layout was queued, run it now
    if (layoutQueued) {
      layoutQueued = false;
      runLayout();
    }
  };

  const getNonContextElements: () => CollectionReturnValue = () => {
    return cy.elements().filter(ele => {
      if (ele.isNode()) return !ele.data('isContextNode');
      // Exclude edges connected to context nodes
      return !ele.source().data('isContextNode') && !ele.target().data('isContextNode');
    });
  };

  const runColaLayout: (onComplete?: () => void) => void = (onComplete) => {
    const colaOpts: AutoLayoutOptions = currentConfig.cola;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = new (ColaLayout as any)({
      cy: cy,
      // Exclude context nodes and their edges - position controlled by anchor-to-node.ts
      eles: getNonContextElements(),
      animate: colaOpts.animate,
      randomize: false, // Don't randomize - preserve existing positions
      avoidOverlap: colaOpts.avoidOverlap,
      handleDisconnected: colaOpts.handleDisconnected,
      convergenceThreshold: colaOpts.convergenceThreshold,
      maxSimulationTime: colaOpts.maxSimulationTime,
      unconstrIter: colaOpts.unconstrIter,
      userConstIter: colaOpts.userConstIter,
      allConstIter: colaOpts.allConstIter,
      nodeSpacing: colaOpts.nodeSpacing,
      edgeLength: colaOpts.edgeLength,
      edgeSymDiffLength: colaOpts.edgeSymDiffLength,
      edgeJaccardLength: colaOpts.edgeJaccardLength,
      centerGraph: false,
      fit: false,
      nodeDimensionsIncludeLabels: true,
    });

    layout.one('layoutstop', onComplete ?? onLayoutComplete);
    layout.run();
  };

  const runFcoseLayout: () => void = () => {
    registerFcose();
    const fcoseOpts: FcoseLayoutOptions = currentConfig.fcose;

    // fcose options are not covered by cytoscape's built-in LayoutOptions type
    const fcoseLayoutOptions: { name: string } & Record<string, unknown> = {
      name: 'fcose',
      eles: getNonContextElements(),
      animate: true,
      randomize: false,
      quality: fcoseOpts.quality,
      initialEnergyOnIncremental: fcoseOpts.initialEnergyOnIncremental,
      fit: false,
      nodeRepulsion: () => fcoseOpts.nodeRepulsion,
      idealEdgeLength: (edge: EdgeSingular) => getEdgeDistance(edge.target().data('windowType')),
      edgeElasticity: () => fcoseOpts.edgeElasticity,
      gravity: fcoseOpts.gravity,
      gravityRange: fcoseOpts.gravityRange,
      tile: fcoseOpts.tile,
      tilingPaddingVertical: fcoseOpts.tilingPaddingVertical,
      tilingPaddingHorizontal: fcoseOpts.tilingPaddingHorizontal,
      nodeSeparation: fcoseOpts.nodeSpacing,
      nodeDimensionsIncludeLabels: true,
    };
    const layout: Layouts = cy.layout(fcoseLayoutOptions);

    layout.one('layoutstop', onLayoutComplete);
    layout.run();
  };

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

    layoutRunning = true;
    layoutCount++;

    if (currentConfig.engine === 'fcose' && layoutCount % 7 === 0) {
      runColaLayout(() => runFcoseLayout());
    } else if (currentConfig.engine === 'fcose') {
      runFcoseLayout();
    } else {
      runColaLayout();
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

  // NOTE: We intentionally do NOT listen to 'floatingwindow:resize' here.
  // That event fires on zoom-induced dimension changes (not just user resize),
  // which would cause unnecessary full layout recalculations during zoom/pan.
  // Shadow node dimensions still update correctly without triggering layout.
  // User-initiated resizes (expand button, CSS drag) call triggerLayout() directly.

  // Register trigger for external callers (user-initiated resize)
  layoutTriggers.set(cy, debouncedRunLayout);

  //console.log('[AutoLayout] Auto-layout enabled');

  // Return cleanup function
  return () => {
    cy.off('add', 'node', debouncedRunLayout);
    cy.off('remove', 'node', debouncedRunLayout);
    cy.off('add', 'edge', debouncedRunLayout);
    cy.off('remove', 'edge', debouncedRunLayout);
    layoutTriggers.delete(cy);
    unsubSettings();

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    //console.log('[AutoLayout] Auto-layout disabled');
  };
}
