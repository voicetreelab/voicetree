/**
 * Auto Layout: Automatically run Cola or fcose layout on graph changes
 *
 * Layout strategy:
 * - Initial load: fCOSE for global positioning → Cola for refinement
 * - Incremental (batch-added nodes <30% of graph):
 *   Always: Local Cola on 4-hop neighborhood of new nodes (6-hop pinned boundary)
 *   Every 7th layout: chains into global Cola on full graph for stabilization
 * - Fallback (>30% new or no new nodes tracked): Global Cola every 7th layout only
 *
 * fCOSE is only used on initial load because its gravity pulls nodes too aggressively
 * for incremental layout updates. Cola handles all ongoing layout after the first run.
 *
 * NOTE (commit 033c57a4): We tried a two-phase layout algorithm that ran Phase 1 with only
 * constraint iterations (no unconstrained) for fast global stabilization, then Phase 2 ran
 * full iterations on just the neighborhood of most-displaced nodes. We tried this algo, and
 * that it was okay, but went on for too long since it doubled the animation period, and the
 * second phase could still be quite janky which was what we were trying to avoid.
 * The current approach differs: Phase 1 is truly local (small subgraph), not global.
 */

import type {Core, EdgeSingular, NodeSingular, NodeDefinition, CollectionReturnValue, Layouts, EventObject} from 'cytoscape';
import ColaLayout from './cola';
import { getEdgeDistance } from './cytoscape-graph-constants';
import { refreshSpatialIndex, getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { queryEdgesInRect } from '@/pure/graph/spatial';
import type { SpatialIndex, SpatialEdgeEntry } from '@/pure/graph/spatial';
import { needsLayoutCorrection, hasEdgeCrossingsAmong } from '@/pure/graph/geometry';
import type { LocalGeometry, EdgeSegment } from '@/pure/graph/geometry';
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';
import { consumePendingPan } from '@/shell/edge/UI-edge/state/PendingPanStore';
import { onSettingsChange } from '@/shell/edge/UI-edge/api';
import type { AutoLayoutOptions, LayoutConfig, FcoseLayoutOptions } from './autoLayoutTypes';
import { DEFAULT_OPTIONS, DEFAULT_FCOSE_OPTIONS, COLA_ANIMATE_DURATION, COLA_FAST_ANIMATE_DURATION } from './autoLayoutTypes';
import { parseLayoutConfig, registerFcose } from './autoLayoutConfig';
import { getLocalNeighborhood, extractLocalGeometry } from './autoLayoutNeighborhood';
import { layoutTriggers, colaLayoutTriggers, dirtyNodeMarkers, fullLayoutTriggers } from './autoLayoutTriggers';

// Re-export public API from sibling modules
export type { AutoLayoutOptions } from './autoLayoutTypes';
export { triggerLayout, triggerColaLayout, markNodeDirty, triggerFullLayout } from './autoLayoutTriggers';

/**
 * Compute Cola layout synchronously, then smoothly animate nodes to final positions.
 * Avoids Cola's frame-1 teleport caused by synchronous initial constraint iterations.
 */
const computeColaAndAnimate: (
  colaLayoutOpts: Record<string, unknown>,
  nodes: CollectionReturnValue,
  duration: number,
  onComplete: () => void
) => void = (colaLayoutOpts, nodes, duration, onComplete) => {
  const startPos: Map<string, { x: number; y: number }> = new Map();
  nodes.forEach((n: NodeSingular) => { startPos.set(n.id(), { ...n.position() }); });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layout: any = new (ColaLayout as any)({ ...colaLayoutOpts, animate: false });

  layout.one('layoutstop', () => {
    const endPos: Map<string, { x: number; y: number }> = new Map();
    nodes.forEach((n: NodeSingular) => { endPos.set(n.id(), { ...n.position() }); });

    // Reset to original positions
    nodes.forEach((n: NodeSingular) => {
      const s: { x: number; y: number } | undefined = startPos.get(n.id());
      if (s) n.position(s);
    });

    // Animate to computed final positions
    nodes.forEach((n: NodeSingular) => {
      const e: { x: number; y: number } | undefined = endPos.get(n.id());
      if (e) n.animate({ position: e }, { duration, easing: 'ease-in-out-cubic' });
    });

    setTimeout(onComplete, duration + 16);
  });
  layout.run();
};

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
  let hasRunInitialLayout: boolean = false;

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

  const runFcoseLayout: (qualityOverride?: 'default' | 'proof', onComplete?: () => void) => void = (qualityOverride, onComplete) => {
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
      (onComplete ?? onLayoutComplete)();
    });
    layout.run();
  };

  /**
   * Run Cola on the local neighborhood of newly added nodes.
   * Hop 1-4: run set (free to move) — Cola can rearrange the local region.
   * Hop 5-6: pin boundary (locked anchors) — prevents ripple to distant nodes.
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
    const subgraphElements: CollectionReturnValue = allNodes.union(subgraphEdges);

    // Check for edge crossings or node overlaps in the local region
    const geo: LocalGeometry = extractLocalGeometry(newNodes, subgraphEdges, runNodes);
    if (!needsLayoutCorrection(geo)) {
      // Fast-tier: no overlap — light Cola pass for edge-length polish
      computeColaAndAnimate({
        cy: cy,
        eles: subgraphElements,
        randomize: false,
        avoidOverlap: true,
        handleDisconnected: false,
        convergenceThreshold: 1.5,
        maxSimulationTime: 200,
        unconstrIter: 3,
        userConstIter: 3,
        allConstIter: 5,
        nodeSpacing: 70,
        edgeLength: currentConfig.cola.edgeLength ?? DEFAULT_OPTIONS.edgeLength,
        centerGraph: false,
        fit: false,
        nodeDimensionsIncludeLabels: true,
      }, runNodes, COLA_FAST_ANIMATE_DURATION, () => {
        pinNodes.unlock();
        refreshSpatialIndex(cy);
        onComplete();
      });
      return;
    }

    computeColaAndAnimate({
      cy: cy,
      eles: subgraphElements,
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
    }, runNodes, COLA_ANIMATE_DURATION, () => {
      pinNodes.unlock();

      // Rebuild spatial index with post-animation positions (layoutstop rebuild is stale
      // because computeColaAndAnimate resets to startPos during animation)
      refreshSpatialIndex(cy);

      const postColaIndex: SpatialIndex | undefined = getCurrentIndex(cy);
      if (postColaIndex) {
        // Query edges in the region affected by local Cola
        const regionBB: { x1: number; y1: number; x2: number; y2: number } = allNodes.boundingBox({
          includeLabels: false, includeOverlays: false, includeEdges: false
        });
        const edgesInRegion: readonly SpatialEdgeEntry[] = queryEdgesInRect(postColaIndex, {
          minX: regionBB.x1, minY: regionBB.y1,
          maxX: regionBB.x2, maxY: regionBB.y2
        });

        // Convert spatial entries to EdgeSegments for intersection testing
        const segments: EdgeSegment[] = edgesInRegion.map(e => ({
          p1: { x: e.x1, y: e.y1 },
          p2: { x: e.x2, y: e.y2 }
        }));

        if (hasEdgeCrossingsAmong(segments)) {
          // Edge overlaps found in local region — run global Cola to resolve
          runColaLayout();
          return;
        }
      }

      onComplete();
    });
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
    const shouldRunGlobal: boolean = layoutCount % 7 === 0;

    if (!hasRunInitialLayout) {
      // Initial load: fCOSE for global positioning, then Cola to refine
      hasRunInitialLayout = true;
      runFcoseLayout(undefined, () => {
        runColaLayout();
      });
    } else if (newNodeIds.size > 0 && newNodeIds.size < totalNodes * 0.3) {
      // Incremental: always local Cola; global Cola every 7th layout for stabilization
      runLocalCola(newNodeIds, () => {
        if (shouldRunGlobal) {
          runColaLayout();
        } else {
          onLayoutComplete();
        }
      });
    } else {
      // Fallback (>30% new or no new nodes): global Cola every 7th, otherwise skip
      if (shouldRunGlobal) {
        runColaLayout();
      } else {
        onLayoutComplete();
      }
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

  // Register dirty-node marker for external callers (floating window resize)
  dirtyNodeMarkers.set(cy, (nodeId: string) => {
    pendingNewNodeIds.add(nodeId);
    debouncedRunLayout();
  });

  // Register full layout reset for external callers (vault path changes)
  fullLayoutTriggers.set(cy, () => {
    hasRunInitialLayout = false;
    debouncedRunLayout();
  });

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
    dirtyNodeMarkers.delete(cy);
    fullLayoutTriggers.delete(cy);
    unsubSettings();

    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    //console.log('[AutoLayout] Auto-layout disabled');
  };
}
