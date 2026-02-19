/**
 * Auto Layout: Automatically run Cola or fcose layout on graph changes
 *
 * Two-phase layout for batch-added nodes:
 * Phase 1: Local Cola on 2-hop neighborhood of new nodes (4-hop pinned boundary)
 * Phase 2: Global layout with configured engine (Cola or fCOSE)
 * Falls back to full-graph layout when >30% nodes are new or no new nodes tracked.
 *
 * NOTE (commit 033c57a4): We tried a two-phase layout algorithm that ran Phase 1 with only
 * constraint iterations (no unconstrained) for fast global stabilization, then Phase 2 ran
 * full iterations on just the neighborhood of most-displaced nodes. We tried this algo, and
 * that it was okay, but went on for too long since it doubled the animation period, and the
 * second phase could still be quite janky which was what we were trying to avoid.
 * The current approach differs: Phase 1 is truly local (small subgraph), not global.
 */

import cytoscape from 'cytoscape';
import type {Core, EdgeSingular, NodeSingular, NodeDefinition, CollectionReturnValue, Layouts, EventObject} from 'cytoscape';
import ColaLayout from './cola';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - cytoscape-fcose has no bundled types; ambient declaration in utils/types/cytoscape-fcose.d.ts
import fcose from 'cytoscape-fcose';
import { getEdgeDistance } from './cytoscape-graph-constants';
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { queryNodesInRect } from '@/pure/graph/spatial';
import type { SpatialIndex, SpatialNodeEntry, Rect } from '@/pure/graph/spatial';
import { needsLayoutCorrection } from '@/pure/graph/geometry';
import type { LocalGeometry, EdgeSegment } from '@/pure/graph/geometry';
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

type LayoutEngine = 'cola' | 'fcose';

interface LayoutConfig {
  engine: LayoutEngine;
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

const VALID_ENGINES: readonly LayoutEngine[] = ['cola', 'fcose'] as const;

/**
 * Parse layoutConfig JSON string into typed layout options.
 * Falls back to cola defaults on any parse error.
 */
function parseLayoutConfig(json: string | undefined): LayoutConfig {
  const defaults: LayoutConfig = { engine: 'cola', cola: DEFAULT_OPTIONS, fcose: DEFAULT_FCOSE_OPTIONS };
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

    return { engine, cola, fcose: fcoseOpts };
  } catch {
    return defaults;
  }
}

/**
 * Expand a set of root nodes to their N-hop neighborhood.
 * Each iteration includes the closed neighborhood (node + all its direct neighbors).
 */
function getNHopNeighborhood(roots: CollectionReturnValue, hops: number): CollectionReturnValue {
  let collection: CollectionReturnValue = roots;
  for (let i: number = 0; i < hops; i++) {
    collection = collection.closedNeighborhood();
  }
  // .filter() returns CollectionReturnValue (unlike .nodes() which returns NodeCollection)
  return collection.filter(ele => ele.isNode());
}

/**
 * Compute hybrid topology+spatial neighborhood for local Cola layout.
 *
 * Run set: 2-hop topology (Cola needs edges for force computation).
 * Pin set: 4-hop topology boundary ∪ spatially nearby nodes from R-tree query.
 * Both topology and spatial pin sets are capped at MAX_PINS each (sorted by
 * distance from run-set centroid) to bound Cola's O(n²) iteration cost.
 */
function getLocalNeighborhood(
  cy: Core,
  newNodes: CollectionReturnValue,
  spatialIndex: SpatialIndex | undefined
): { runNodes: CollectionReturnValue; pinNodes: CollectionReturnValue } {
  const MAX_PINS: number = 30;

  // Run set: 2-hop topology, filtered for non-context nodes (Cola needs edge structure)
  const runNodes: CollectionReturnValue = getNHopNeighborhood(newNodes, 2).filter(
    ele => !ele.data('isContextNode')
  );

  // Topology pins: hop 3-4 boundary anchors
  const allTopologyNodes: CollectionReturnValue = getNHopNeighborhood(newNodes, 4).filter(
    ele => !ele.data('isContextNode')
  );
  let pinNodes: CollectionReturnValue = allTopologyNodes.difference(runNodes);

  // Compute run-set bounding box centroid (reused for topology cap + spatial query)
  if (runNodes.length === 0) {
    return { runNodes, pinNodes };
  }
  const bb: { x1: number; y1: number; x2: number; y2: number } = runNodes.boundingBox({
    includeLabels: false, includeOverlays: false, includeEdges: false
  });
  const centroidX: number = (bb.x1 + bb.x2) / 2;
  const centroidY: number = (bb.y1 + bb.y2) / 2;

  // Cap topology pins at MAX_PINS, keeping closest to run-set centroid
  if (pinNodes.length > MAX_PINS) {
    pinNodes = pinNodes.sort((a, b) => {
      const aPos: { x: number; y: number } = (a as NodeSingular).position();
      const bPos: { x: number; y: number } = (b as NodeSingular).position();
      return ((aPos.x - centroidX) ** 2 + (aPos.y - centroidY) ** 2)
           - ((bPos.x - centroidX) ** 2 + (bPos.y - centroidY) ** 2);
    }).slice(0, MAX_PINS);
  }

  // Spatial augmentation: merge nearby nodes from R-tree when index available
  if (spatialIndex) {
    const halfDiag: number = Math.sqrt((bb.x2 - bb.x1) ** 2 + (bb.y2 - bb.y1) ** 2) / 2;
    const searchRadius: number = halfDiag + 400;

    const searchRect: { minX: number; minY: number; maxX: number; maxY: number } = {
      minX: centroidX - searchRadius,
      minY: centroidY - searchRadius,
      maxX: centroidX + searchRadius,
      maxY: centroidY + searchRadius,
    };

    const nearbyEntries: readonly SpatialNodeEntry[] = queryNodesInRect(spatialIndex, searchRect);

    // Sort by distance from centroid, closest first; cap at MAX_PINS new spatial pins
    const sortedEntries: SpatialNodeEntry[] = [...nearbyEntries].sort((a, b) => {
      return (((a.minX + a.maxX) / 2 - centroidX) ** 2 + ((a.minY + a.maxY) / 2 - centroidY) ** 2)
           - (((b.minX + b.maxX) / 2 - centroidX) ** 2 + ((b.minY + b.maxY) / 2 - centroidY) ** 2);
    });

    let spatialPinCount: number = 0;
    for (const entry of sortedEntries) {
      if (spatialPinCount >= MAX_PINS) break;
      const node: CollectionReturnValue = cy.getElementById(entry.nodeId);
      if (node.length > 0 && !runNodes.contains(node) && !pinNodes.contains(node) && !node.data('isContextNode')) {
        pinNodes = pinNodes.merge(node);
        spatialPinCount++;
      }
    }
  }

  return { runNodes, pinNodes };
}

/**
 * Extract plain geometry data from cytoscape collections for pure layout-correction check.
 * Shell boundary: reads cytoscape positions, produces immutable LocalGeometry.
 */
function extractLocalGeometry(
    newNodes: CollectionReturnValue,
    subgraphEdges: CollectionReturnValue,
    runNodes: CollectionReturnValue
): LocalGeometry {
    const newEdgeSet: CollectionReturnValue = newNodes.connectedEdges().filter(
        (e: EdgeSingular) => subgraphEdges.contains(e)
    );
    const toSeg: (e: EdgeSingular) => EdgeSegment = (e: EdgeSingular): EdgeSegment => ({
        p1: (e.source() as NodeSingular).position(),
        p2: (e.target() as NodeSingular).position()
    });
    const toRect: (n: NodeSingular) => Rect = (n: NodeSingular): Rect => {
        const bb: { x1: number; y1: number; x2: number; y2: number } = n.boundingBox({
            includeLabels: false, includeOverlays: false, includeEdges: false
        });
        return { minX: bb.x1, minY: bb.y1, maxX: bb.x2, maxY: bb.y2 };
    };
    return {
        newEdges: newEdgeSet.map(toSeg),
        existingEdges: subgraphEdges.difference(newEdgeSet).map(toSeg),
        newNodeRects: newNodes.map(toRect),
        neighborRects: runNodes.difference(newNodes).map(toRect)
    };
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

  // Track newly added node IDs for local Cola layout
  const pendingNewNodeIds: Set<string> = new Set<string>();

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

    // Patch layoutDimensions so fcose sees 2x bounding box for content nodes only
    // (shadow, context, and floating window nodes keep real dimensions)
    type LayoutDimsFn = (opts: unknown) => { w: number; h: number };
    const firstNode: NodeSingular = cy.nodes().first();
    const nodeProto: Record<string, LayoutDimsFn> = Object.getPrototypeOf(firstNode) as Record<string, LayoutDimsFn>;
    const origLayoutDimensions: LayoutDimsFn = nodeProto.layoutDimensions;
    nodeProto.layoutDimensions = function(this: NodeSingular, opts: unknown): { w: number; h: number } {
      const dims: { w: number; h: number } = origLayoutDimensions.call(this, opts);
      if (this.data('isShadowNode') || this.data('isFloatingWindow')) {
        return dims;
      }
      return { w: dims.w * 2, h: dims.h * 2 };
    };

    layout.one('layoutstop', () => {
      nodeProto.layoutDimensions = origLayoutDimensions;
      onLayoutComplete();
    });
    layout.run();
  };

  /**
   * Run Cola on the local neighborhood of newly added nodes.
   * Hop 1-2: run set (free to move) — Cola can rearrange the local region.
   * Hop 3-4: pin boundary (locked anchors) — prevents ripple to distant nodes.
   * On completion, unlocks pins and chains to onComplete (Phase 2).
   */
  const runLocalCola: (newNodeIds: Set<string>, onComplete: () => void) => void = (newNodeIds, onComplete) => {
    // Collect cy nodes for the new IDs, skip context nodes
    let newNodes: CollectionReturnValue = cy.collection();
    for (const id of newNodeIds) {
      const node: CollectionReturnValue = cy.getElementById(id);
      if (node.length > 0 && !node.data('isContextNode')) {
        newNodes = newNodes.merge(node);
      }
    }

    if (newNodes.length === 0) {
      onComplete();
      return;
    }

    // Hybrid topology+spatial neighborhood selection
    const { runNodes, pinNodes } = getLocalNeighborhood(cy, newNodes, getCurrentIndex(cy));
    pinNodes.lock();
    const allNodes: CollectionReturnValue = runNodes.union(pinNodes);

    // Collect edges where both endpoints are in the subgraph, excluding indicator edges
    const subgraphEdges: CollectionReturnValue = allNodes.connectedEdges().filter(
      edge => !edge.data('isIndicatorEdge')
        && allNodes.contains(edge.source()) && allNodes.contains(edge.target())
    );
    // Skip local Cola if no edge crossings or node overlaps detected
    const geo: LocalGeometry = extractLocalGeometry(newNodes, subgraphEdges, runNodes);
    if (!needsLayoutCorrection(geo)) {
        pinNodes.unlock();
        onComplete();
        return;
    }

    const subgraphElements: CollectionReturnValue = allNodes.union(subgraphEdges);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localLayout: any = new (ColaLayout as any)({
      cy: cy,
      eles: subgraphElements,
      animate: true,
      randomize: false,
      avoidOverlap: true,
      handleDisconnected: false,
      convergenceThreshold: 0.5,
      maxSimulationTime: 800,
      unconstrIter: 12,
      userConstIter: 12,
      allConstIter: 20,
      nodeSpacing: 70,
      edgeLength: currentConfig.cola.edgeLength ?? DEFAULT_OPTIONS.edgeLength,
      centerGraph: false,
      fit: false,
      nodeDimensionsIncludeLabels: true,
    });

    localLayout.one('layoutstop', () => {
      pinNodes.unlock();
      onComplete();
    });
    localLayout.run();
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

    // Snapshot and clear pending new node IDs
    const newNodeIds: Set<string> = new Set(pendingNewNodeIds);
    pendingNewNodeIds.clear();

    const totalNodes: number = cy.nodes().length;

    // If new nodes present and < 30% of total, use local Cola → global engine two-phase path
    if (newNodeIds.size > 0 && newNodeIds.size < totalNodes * 0.3) {
      runLocalCola(newNodeIds, () => {
        // Phase 2: Full layout with configured engine
        if (currentConfig.engine === 'fcose') {
          runFcoseLayout(layoutCount % 7 === 0 ? 'proof' : undefined);
        } else {
          runColaLayout();
        }
      });
    } else if (currentConfig.engine === 'fcose') {
      // Every 7th layout, run fcose with 'proof' quality for a more thorough pass
      runFcoseLayout(layoutCount % 7 === 0 ? 'proof' : undefined);
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

  // Track new node IDs on add, then trigger debounced layout
  const onNodeAdd: (evt: EventObject) => void = (evt) => {
    const target: CollectionReturnValue = evt.target as CollectionReturnValue;
    if (!target.data('isContextNode')) {
      pendingNewNodeIds.add(target.id());
    }
    debouncedRunLayout();
  };

  // Listen to graph modification events
  cy.on('add', 'node', onNodeAdd);
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
    cy.off('add', 'node', onNodeAdd);
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
