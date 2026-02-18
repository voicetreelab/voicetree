/**
 * Auto Layout: Automatically run Cola, fcose, ELK, or Dagre layout on graph changes
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
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - cytoscape-elk has no bundled types; ambient declaration in utils/types/cytoscape-elk.d.ts
import elk from 'cytoscape-elk';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - cytoscape-dagre has no bundled types; ambient declaration in utils/types/cytoscape-dagre.d.ts
import dagre from 'cytoscape-dagre';
import { getEdgeDistance } from './cytoscape-graph-constants';
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';
import { consumePendingPan } from '@/shell/edge/UI-edge/state/PendingPanStore';
import { onSettingsChange } from '@/shell/edge/UI-edge/api';

// Register layout extensions once
let fcoseRegistered: boolean = false;
function registerFcose(): void {
  if (!fcoseRegistered) {
    cytoscape.use(fcose);
    fcoseRegistered = true;
  }
}

let elkRegistered: boolean = false;
function registerElk(): void {
  if (!elkRegistered) {
    cytoscape.use(elk);
    elkRegistered = true;
  }
}

let dagreRegistered: boolean = false;
function registerDagre(): void {
  if (!dagreRegistered) {
    cytoscape.use(dagre);
    dagreRegistered = true;
  }
}

// Registry for layout triggers - allows external code to trigger layout via triggerLayout(cy)
const layoutTriggers: Map<Core, () => void> = new Map<Core, () => void>();

// Registry for cola layout triggers - allows external code to run cola layout on demand
const colaLayoutTriggers: Map<Core, () => void> = new Map<Core, () => void>();

/**
 * Trigger a debounced layout run for the given cytoscape instance.
 * Use this for user-initiated resize events (expand button, CSS drag resize).
 */
export function triggerLayout(cy: Core): void {
  layoutTriggers.get(cy)?.();
}

/**
 * Trigger a one-shot cola layout run for the given cytoscape instance.
 * Use this for user-initiated "tidy up" / reorganize layout.
 */
export function triggerColaLayout(cy: Core): void {
  colaLayoutTriggers.get(cy)?.();
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
  // Position anchoring - ghost nodes that softly anchor existing nodes to prior positions
  anchorEnabled?: boolean;  // default true
  anchorStrength?: number;  // 1-200, default 10 (lower = stronger anchor)
}

interface FcoseLayoutOptions {
  quality: 'default' | 'proof';
  animate: boolean;
  fit: boolean;
  incremental: boolean;
  animationDuration: number;
  numIter: number;
  initialEnergyOnIncremental: number;
  gravity: number;
  gravityRange: number;
  gravityCompound: number;
  gravityRangeCompound: number;
  nestingFactor: number;
  tile: boolean;
  tilingPaddingVertical: number;
  tilingPaddingHorizontal: number;
  nodeRepulsion: number;
  idealEdgeLength: number;
  edgeElasticity: number;
  nodeSpacing: number;
  uniformNodeDimensions: boolean;
  packComponents: boolean;
  coolingFactor: number;
}

interface ElkLayoutOptions {
  algorithm: 'layered' | 'stress' | 'mrtree' | 'radial' | 'force' | 'disco' | 'sporeOverlap' | 'sporeCompaction' | 'rectpacking';
  'elk.direction': 'DOWN' | 'UP' | 'LEFT' | 'RIGHT';
  'elk.spacing.nodeNode': number;
  'elk.layered.spacing.nodeNodeBetweenLayers': number;
  'elk.edgeRouting': 'POLYLINE' | 'ORTHOGONAL' | 'SPLINES';
  animationDuration: number;
}

interface DagreLayoutOptions {
  rankDir: 'TB' | 'BT' | 'LR' | 'RL';
  rankSep: number;
  nodeSep: number;
  edgeSep: number;
  ranker: 'network-simplex' | 'tight-tree' | 'longest-path';
  animationDuration: number;
}

type LayoutEngine = 'cola' | 'fcose' | 'elk' | 'dagre';

interface LayoutConfig {
  engine: LayoutEngine;
  cola: AutoLayoutOptions;
  fcose: FcoseLayoutOptions;
  elk: ElkLayoutOptions;
  dagre: DagreLayoutOptions;
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
  animate: true,
  fit: false,
  incremental: true,
  animationDuration: 1000,
  numIter: 2500,
  initialEnergyOnIncremental: 0.15,
  gravity: 0.02,
  gravityRange: 1.5,
  gravityCompound: 1.0,
  gravityRangeCompound: 1.5,
  nestingFactor: 0.1,
  tile: true,
  tilingPaddingVertical: 10,
  tilingPaddingHorizontal: 10,
  nodeRepulsion: 25000,
  idealEdgeLength: 250,
  edgeElasticity: 0.45,
  nodeSpacing: 70,
  uniformNodeDimensions: false,
  packComponents: true,
  coolingFactor: 0.3,
};

const DEFAULT_ELK_OPTIONS: ElkLayoutOptions = {
  algorithm: 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': 70,
  'elk.layered.spacing.nodeNodeBetweenLayers': 100,
  'elk.edgeRouting': 'POLYLINE',
  animationDuration: 1000,
};

const DEFAULT_DAGRE_OPTIONS: DagreLayoutOptions = {
  rankDir: 'TB',
  rankSep: 100,
  nodeSep: 70,
  edgeSep: 10,
  ranker: 'network-simplex',
  animationDuration: 1000,
};

const VALID_ENGINES: readonly LayoutEngine[] = ['cola', 'fcose', 'elk', 'dagre'] as const;

/**
 * Parse layoutConfig JSON string into typed layout options.
 * Falls back to cola defaults on any parse error.
 */
function parseLayoutConfig(json: string | undefined): LayoutConfig {
  const defaults: LayoutConfig = { engine: 'cola', cola: DEFAULT_OPTIONS, fcose: DEFAULT_FCOSE_OPTIONS, elk: DEFAULT_ELK_OPTIONS, dagre: DEFAULT_DAGRE_OPTIONS };
  if (!json) {
    return defaults;
  }

  try {
    const parsed: Record<string, unknown> = JSON.parse(json) as Record<string, unknown>;
    const engine: LayoutEngine = VALID_ENGINES.includes(parsed.engine as LayoutEngine) ? (parsed.engine as LayoutEngine) : 'cola';

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
      anchorEnabled: parsed['cola.anchorEnabled'] !== false,
      anchorStrength: typeof parsed['cola.anchorStrength'] === 'number'
        ? Math.max(1, Math.min(200, parsed['cola.anchorStrength'])) : 10,
    };

    const fcoseOpts: FcoseLayoutOptions = {
      quality: parsed.quality === 'default' || parsed.quality === 'proof' ? parsed.quality : DEFAULT_FCOSE_OPTIONS.quality,
      animate: typeof parsed.animate === 'boolean' ? parsed.animate : DEFAULT_FCOSE_OPTIONS.animate,
      fit: typeof parsed.fit === 'boolean' ? parsed.fit : DEFAULT_FCOSE_OPTIONS.fit,
      incremental: typeof parsed.incremental === 'boolean' ? parsed.incremental : DEFAULT_FCOSE_OPTIONS.incremental,
      animationDuration: typeof parsed.animationDuration === 'number' ? parsed.animationDuration : DEFAULT_FCOSE_OPTIONS.animationDuration,
      numIter: typeof parsed.numIter === 'number' ? parsed.numIter : DEFAULT_FCOSE_OPTIONS.numIter,
      initialEnergyOnIncremental: typeof parsed.initialEnergyOnIncremental === 'number' ? parsed.initialEnergyOnIncremental : DEFAULT_FCOSE_OPTIONS.initialEnergyOnIncremental,
      gravity: typeof parsed.gravity === 'number' ? parsed.gravity : DEFAULT_FCOSE_OPTIONS.gravity,
      gravityRange: typeof parsed.gravityRange === 'number' ? parsed.gravityRange : DEFAULT_FCOSE_OPTIONS.gravityRange,
      gravityCompound: typeof parsed.gravityCompound === 'number' ? parsed.gravityCompound : DEFAULT_FCOSE_OPTIONS.gravityCompound,
      gravityRangeCompound: typeof parsed.gravityRangeCompound === 'number' ? parsed.gravityRangeCompound : DEFAULT_FCOSE_OPTIONS.gravityRangeCompound,
      nestingFactor: typeof parsed.nestingFactor === 'number' ? parsed.nestingFactor : DEFAULT_FCOSE_OPTIONS.nestingFactor,
      tile: typeof parsed.tile === 'boolean' ? parsed.tile : DEFAULT_FCOSE_OPTIONS.tile,
      tilingPaddingVertical: typeof parsed.tilingPaddingVertical === 'number' ? parsed.tilingPaddingVertical : DEFAULT_FCOSE_OPTIONS.tilingPaddingVertical,
      tilingPaddingHorizontal: typeof parsed.tilingPaddingHorizontal === 'number' ? parsed.tilingPaddingHorizontal : DEFAULT_FCOSE_OPTIONS.tilingPaddingHorizontal,
      nodeRepulsion: typeof parsed.nodeRepulsion === 'number' ? parsed.nodeRepulsion : DEFAULT_FCOSE_OPTIONS.nodeRepulsion,
      idealEdgeLength: typeof parsed.idealEdgeLength === 'number' ? parsed.idealEdgeLength : DEFAULT_FCOSE_OPTIONS.idealEdgeLength,
      edgeElasticity: typeof parsed.edgeElasticity === 'number' ? parsed.edgeElasticity : DEFAULT_FCOSE_OPTIONS.edgeElasticity,
      nodeSpacing: typeof parsed.nodeSpacing === 'number' ? parsed.nodeSpacing : DEFAULT_FCOSE_OPTIONS.nodeSpacing,
      uniformNodeDimensions: typeof parsed.uniformNodeDimensions === 'boolean' ? parsed.uniformNodeDimensions : DEFAULT_FCOSE_OPTIONS.uniformNodeDimensions,
      packComponents: typeof parsed.packComponents === 'boolean' ? parsed.packComponents : DEFAULT_FCOSE_OPTIONS.packComponents,
      coolingFactor: typeof parsed.coolingFactor === 'number' ? parsed.coolingFactor : DEFAULT_FCOSE_OPTIONS.coolingFactor,
    };

    const validElkAlgorithms = ['layered', 'stress', 'mrtree', 'radial', 'force', 'disco', 'sporeOverlap', 'sporeCompaction', 'rectpacking'] as const;
    const validElkDirections = ['DOWN', 'UP', 'LEFT', 'RIGHT'] as const;
    const validElkRouting = ['POLYLINE', 'ORTHOGONAL', 'SPLINES'] as const;

    const elkOpts: ElkLayoutOptions = {
      algorithm: validElkAlgorithms.includes(parsed['elk.algorithm'] as typeof validElkAlgorithms[number]) ? (parsed['elk.algorithm'] as ElkLayoutOptions['algorithm']) : DEFAULT_ELK_OPTIONS.algorithm,
      'elk.direction': validElkDirections.includes(parsed['elk.direction'] as typeof validElkDirections[number]) ? (parsed['elk.direction'] as ElkLayoutOptions['elk.direction']) : DEFAULT_ELK_OPTIONS['elk.direction'],
      'elk.spacing.nodeNode': typeof parsed['elk.spacing.nodeNode'] === 'number' ? parsed['elk.spacing.nodeNode'] : DEFAULT_ELK_OPTIONS['elk.spacing.nodeNode'],
      'elk.layered.spacing.nodeNodeBetweenLayers': typeof parsed['elk.layered.spacing.nodeNodeBetweenLayers'] === 'number' ? parsed['elk.layered.spacing.nodeNodeBetweenLayers'] : DEFAULT_ELK_OPTIONS['elk.layered.spacing.nodeNodeBetweenLayers'],
      'elk.edgeRouting': validElkRouting.includes(parsed['elk.edgeRouting'] as typeof validElkRouting[number]) ? (parsed['elk.edgeRouting'] as ElkLayoutOptions['elk.edgeRouting']) : DEFAULT_ELK_OPTIONS['elk.edgeRouting'],
      animationDuration: typeof parsed.animationDuration === 'number' ? parsed.animationDuration : DEFAULT_ELK_OPTIONS.animationDuration,
    };

    const validRankDirs = ['TB', 'BT', 'LR', 'RL'] as const;
    const validRankers = ['network-simplex', 'tight-tree', 'longest-path'] as const;

    const dagreOpts: DagreLayoutOptions = {
      rankDir: validRankDirs.includes(parsed['dagre.rankDir'] as typeof validRankDirs[number]) ? (parsed['dagre.rankDir'] as DagreLayoutOptions['rankDir']) : DEFAULT_DAGRE_OPTIONS.rankDir,
      rankSep: typeof parsed['dagre.rankSep'] === 'number' ? parsed['dagre.rankSep'] : DEFAULT_DAGRE_OPTIONS.rankSep,
      nodeSep: typeof parsed['dagre.nodeSep'] === 'number' ? parsed['dagre.nodeSep'] : DEFAULT_DAGRE_OPTIONS.nodeSep,
      edgeSep: typeof parsed['dagre.edgeSep'] === 'number' ? parsed['dagre.edgeSep'] : DEFAULT_DAGRE_OPTIONS.edgeSep,
      ranker: validRankers.includes(parsed['dagre.ranker'] as typeof validRankers[number]) ? (parsed['dagre.ranker'] as DagreLayoutOptions['ranker']) : DEFAULT_DAGRE_OPTIONS.ranker,
      animationDuration: typeof parsed.animationDuration === 'number' ? parsed.animationDuration : DEFAULT_DAGRE_OPTIONS.animationDuration,
    };

    return { engine, cola, fcose: fcoseOpts, elk: elkOpts, dagre: dagreOpts };
  } catch {
    return defaults;
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
  let currentConfig: LayoutConfig = { engine: 'cola', cola: { ...DEFAULT_OPTIONS, ...options }, fcose: DEFAULT_FCOSE_OPTIONS, elk: DEFAULT_ELK_OPTIONS, dagre: DEFAULT_DAGRE_OPTIONS };

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
      anchorEnabled: colaOpts.anchorEnabled,
      anchorStrength: colaOpts.anchorStrength,
      centerGraph: false,
      fit: false,
      nodeDimensionsIncludeLabels: true,
    });

    layout.one('layoutstop', onComplete ?? onLayoutComplete);
    layout.run();
  };

  const runFcoseLayout: (qualityOverride?: 'default' | 'proof') => void = (qualityOverride) => {
    registerFcose();
    const fcoseOpts: FcoseLayoutOptions = currentConfig.fcose;

    // fcose options are not covered by cytoscape's built-in LayoutOptions type
    const fcoseLayoutOptions: { name: string } & Record<string, unknown> = {
      name: 'fcose',
      eles: getNonContextElements(),
      animate: fcoseOpts.animate,
      animationDuration: fcoseOpts.animationDuration,
      randomize: !fcoseOpts.incremental,
      quality: qualityOverride ?? fcoseOpts.quality,
      numIter: fcoseOpts.numIter,
      initialEnergyOnIncremental: fcoseOpts.initialEnergyOnIncremental,
      fit: fcoseOpts.fit,
      nodeRepulsion: () => fcoseOpts.nodeRepulsion,
      idealEdgeLength: (edge: EdgeSingular) => getEdgeDistance(edge.target().data('windowType')),
      edgeElasticity: () => fcoseOpts.edgeElasticity,
      gravity: fcoseOpts.gravity,
      gravityRange: fcoseOpts.gravityRange,
      gravityCompound: fcoseOpts.gravityCompound,
      gravityRangeCompound: fcoseOpts.gravityRangeCompound,
      nestingFactor: fcoseOpts.nestingFactor,
      tile: fcoseOpts.tile,
      tilingPaddingVertical: fcoseOpts.tilingPaddingVertical,
      tilingPaddingHorizontal: fcoseOpts.tilingPaddingHorizontal,
      nodeSeparation: fcoseOpts.nodeSpacing,
      nodeDimensionsIncludeLabels: true,
      uniformNodeDimensions: fcoseOpts.uniformNodeDimensions,
      packComponents: fcoseOpts.packComponents,
      coolingFactor: fcoseOpts.coolingFactor,
    };
    const layout: Layouts = cy.layout(fcoseLayoutOptions);

    layout.one('layoutstop', onLayoutComplete);
    layout.run();
  };

  const runElkLayout: () => void = () => {
    registerElk();
    const elkOpts: ElkLayoutOptions = currentConfig.elk;

    const elkLayoutOptions: { name: string } & Record<string, unknown> = {
      name: 'elk',
      eles: getNonContextElements(),
      animate: true,
      animationDuration: elkOpts.animationDuration,
      fit: false,
      nodeDimensionsIncludeLabels: true,
      elk: {
        algorithm: elkOpts.algorithm,
        'elk.direction': elkOpts['elk.direction'],
        'elk.spacing.nodeNode': elkOpts['elk.spacing.nodeNode'],
        'elk.layered.spacing.nodeNodeBetweenLayers': elkOpts['elk.layered.spacing.nodeNodeBetweenLayers'],
        'elk.edgeRouting': elkOpts['elk.edgeRouting'],
      },
    };
    const layout: Layouts = cy.layout(elkLayoutOptions);

    layout.one('layoutstop', onLayoutComplete);
    layout.run();
  };

  const runDagreLayout: () => void = () => {
    registerDagre();
    const dagreOpts: DagreLayoutOptions = currentConfig.dagre;

    const dagreLayoutOptions: { name: string } & Record<string, unknown> = {
      name: 'dagre',
      eles: getNonContextElements(),
      animate: true,
      animationDuration: dagreOpts.animationDuration,
      fit: false,
      nodeDimensionsIncludeLabels: true,
      rankDir: dagreOpts.rankDir,
      rankSep: dagreOpts.rankSep,
      nodeSep: dagreOpts.nodeSep,
      edgeSep: dagreOpts.edgeSep,
      ranker: dagreOpts.ranker,
    };
    const layout: Layouts = cy.layout(dagreLayoutOptions);

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

    if (currentConfig.engine === 'fcose') {
      // Every 7th layout, run fcose with 'proof' quality for a more thorough pass
      runFcoseLayout(layoutCount % 7 === 0 ? 'proof' : undefined);
    } else if (currentConfig.engine === 'elk') {
      runElkLayout();
    } else if (currentConfig.engine === 'dagre') {
      runDagreLayout();
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

  // Register cola layout trigger for manual "tidy up" button
  colaLayoutTriggers.set(cy, () => {
    if (layoutRunning) {
      layoutQueued = true;
      return;
    }
    if (cy.nodes().length === 0) return;
    layoutRunning = true;
    runColaLayout();
  });

  //console.log('[AutoLayout] Auto-layout enabled');

  // Return cleanup function
  return () => {
    cy.off('add', 'node', debouncedRunLayout);
    cy.off('remove', 'node', debouncedRunLayout);
    cy.off('add', 'edge', debouncedRunLayout);
    cy.off('remove', 'edge', debouncedRunLayout);
    layoutTriggers.delete(cy);
    colaLayoutTriggers.delete(cy);
    unsubSettings();

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    //console.log('[AutoLayout] Auto-layout disabled');
  };
}
