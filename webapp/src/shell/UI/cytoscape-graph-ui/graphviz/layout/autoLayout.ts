/**
 * Auto Layout: Automatically run Cola layout on graph changes
 *
 * Layout strategy:
 * - Initial load / tidy button / large removal (>7 nodes): "Full Ultimate Layout" chain:
 *   R-tree pack (component separation) → Cola (positioning + refinement) → animated cy.fit()
 * - Small removal (≤7 nodes): skip layout (positions already stable)
 * - Incremental (batch-added nodes <30% of graph):
 *   Local Cola on 4-hop neighborhood of new nodes (6-hop pinned boundary)
 * - Batch (>30% new): skip (too many nodes for local Cola)
 *
 * Cola handles all layout. Our R-tree packComponents() handles disconnected component
 * separation before Cola runs.
 *
 * NOTE (commit 033c57a4): We tried a two-phase layout algorithm that ran Phase 1 with only
 * constraint iterations (no unconstrained) for fast global stabilization, then Phase 2 ran
 * full iterations on just the neighborhood of most-displaced nodes. We tried this algo, and
 * that it was okay, but went on for too long since it doubled the animation period, and the
 * second phase could still be quite janky which was what we were trying to avoid.
 * The current approach differs: Phase 1 is truly local (small subgraph), not global.
 */

import type {Core, EdgeSingular, NodeSingular, NodeDefinition, CollectionReturnValue, EventObject} from 'cytoscape';
import ColaLayout from './cola';
import { packComponents } from '@/pure/graph/positioning/packComponents';
import type { ComponentSubgraph } from '@/pure/graph/positioning/packComponents';
import { runLocalCola } from './autoLayoutLocalCola';
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';
import { panToTrackedNode, clearPendingPan } from '@/shell/edge/UI-edge/state/PendingPanStore';
import { getResponsivePadding } from '@/utils/responsivePadding';
import { onSettingsChange } from '@/shell/edge/UI-edge/api';
import type { AutoLayoutOptions, LayoutConfig } from './autoLayoutTypes';
import { DEFAULT_OPTIONS } from './autoLayoutTypes';
import { parseLayoutConfig } from './autoLayoutConfig';
import { layoutTriggers, colaLayoutTriggers, dirtyNodeMarkers, fullLayoutTriggers } from './autoLayoutTriggers';

// Re-export public API from sibling modules
export type { AutoLayoutOptions } from './autoLayoutTypes';
export { triggerLayout, triggerColaLayout, markNodeDirty, triggerFullLayout } from './autoLayoutTriggers';

/**
 * Enable automatic layout on graph changes
 *
 * Listens to node/edge add/remove events and triggers Cola layout
 * based on layoutConfig from settings.
 *
 * @param cy Cytoscape instance
 * @param options Cola layout options (used as additional overrides)
 * @returns Cleanup function to disable auto-layout
 */
export function enableAutoLayout(cy: Core, options: AutoLayoutOptions = {}): () => void {
  // Mutable config that gets updated when settings change
  let currentConfig: LayoutConfig = { engine: 'cola', cola: { ...DEFAULT_OPTIONS, ...options } };

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
  let layoutSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

  // Safety timeout: if a Cola layoutstop event never fires, layoutRunning
  // stays true and the entire layout system dies. This timeout forces a reset.
  const LAYOUT_SAFETY_TIMEOUT_MS: number = 8_000;

  // Track newly added node IDs for local Cola layout
  const pendingNewNodeIds: Set<string> = new Set<string>();

  // Track removed node count so we only run full ultimate layout for large removals (>7 nodes)
  let pendingRemovedNodeCount: number = 0;

  const onLayoutComplete: () => void = () => {
    // Clear safety timeout — layout completed normally
    if (layoutSafetyTimeout) {
      clearTimeout(layoutSafetyTimeout);
      layoutSafetyTimeout = null;
    }

    void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);
    layoutRunning = false;

    // Pan viewport to tracked node at end of full layout chain, then clear state
    panToTrackedNode(cy);
    clearPendingPan();

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

    layout.one('layoutstop', () => {
      // panToTrackedNode(cy);
      (onComplete ?? onLayoutComplete)();
    });
    layout.run();
  };

  /** Full ultimate layout chain: R-tree pack → Cola → animated cy.fit() */
  const runFullUltimateLayout: (onComplete?: () => void) => void = (onComplete) => {
    // R-tree packing: pack disconnected components before Cola
    const components: CollectionReturnValue[] = getNonContextElements().components();
    if (components.length > 1) {
      const subgraphs: ComponentSubgraph[] = components.map((comp: CollectionReturnValue): ComponentSubgraph => ({
        nodes: comp.nodes().map((n: NodeSingular) => ({
          x: n.position('x'),
          y: n.position('y'),
          width: n.width(),
          height: n.height(),
        })),
        edges: comp.edges().map((e: EdgeSingular) => ({
          startX: e.sourceEndpoint().x,
          startY: e.sourceEndpoint().y,
          endX: e.targetEndpoint().x,
          endY: e.targetEndpoint().y,
        })),
      }));

      const { shifts } = packComponents(subgraphs);

      components.forEach((comp: CollectionReturnValue, i: number): void => {
        const shift: { readonly dx: number; readonly dy: number } | undefined = shifts[i];
        if (shift && (shift.dx !== 0 || shift.dy !== 0)) {
          comp.nodes().shift({ x: shift.dx, y: shift.dy });
        }
      });
    }

    runColaLayout(() => {
      const padding: number = getResponsivePadding(cy, 15);
      cy.animate({
        fit: { eles: cy.elements(), padding },
      }, {
        duration: 300,
        easing: 'ease-in-out-cubic',
        complete: () => { (onComplete ?? onLayoutComplete)(); },
      });
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

    // Safety timeout: if layoutstop never fires (Cola error, empty collection,
    // destroyed cy), force-reset so the layout system doesn't permanently die.
    layoutSafetyTimeout = setTimeout(() => {
      if (layoutRunning) {
        console.error(`[AutoLayout] ⚠️ Safety timeout (${LAYOUT_SAFETY_TIMEOUT_MS}ms) — layout callback never fired, force-resetting.`);
        onLayoutComplete();
      }
    }, LAYOUT_SAFETY_TIMEOUT_MS);

    // Snapshot and clear pending new node IDs and removed node count
    const newNodeIds: Set<string> = new Set(pendingNewNodeIds);
    pendingNewNodeIds.clear();
    const removedNodeCount: number = pendingRemovedNodeCount;
    pendingRemovedNodeCount = 0;

    const totalNodes: number = cy.nodes().length;

    try {
      if (!hasRunInitialLayout) {
        // Initial load: full ultimate layout (R-tree pack → Cola → fit)
        hasRunInitialLayout = true;
        runFullUltimateLayout();
      } else if (newNodeIds.size > 0 && newNodeIds.size < totalNodes * 0.3) {
        // Incremental: local Cola on neighborhood of new nodes
        runLocalCola(cy, newNodeIds, currentConfig.cola, onLayoutComplete, runColaLayout);
      } else if (newNodeIds.size === 0) {
        if (removedNodeCount > 7) {
          // Large removal (>7 nodes): full ultimate layout to rebalance
          console.log(`[AutoLayout] Large removal (${removedNodeCount} nodes removed, layoutCount=${layoutCount}, totalNodes=${totalNodes}). Running full ultimate layout.`);
          runFullUltimateLayout();
        } else {
          // Small removal (≤7 nodes) or edge-only removal: positions are already fine, skip layout
          console.log(`[AutoLayout] Minor removal (${removedNodeCount} nodes removed, layoutCount=${layoutCount}, totalNodes=${totalNodes}). Skipping layout.`);
          onLayoutComplete();
        }
      } else {
        // >30% new nodes — batch too large for local Cola, skip
        console.warn(`[AutoLayout] ⚠️ Batch add: ${newNodeIds.size} new nodes (${Math.round(newNodeIds.size / totalNodes * 100)}% of graph). Skipping local Cola.`);
        onLayoutComplete();
      }
    } catch (e: unknown) {
      console.error('[AutoLayout] Layout execution failed, resetting:', e);
      onLayoutComplete();
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

  // Track removed node count so runLayout can decide whether full layout is needed
  const onNodeRemove: (evt: EventObject) => void = (evt) => {
    const target: CollectionReturnValue = evt.target as CollectionReturnValue;
    if (!target.data('isContextNode')) {
      pendingRemovedNodeCount++;
    }
    debouncedRunLayout();
  };

  // Listen to graph modification events
  cy.on('add', 'node', onNodeAdd);
  cy.on('remove', 'node', onNodeRemove);
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

  // Register cola layout trigger for manual "tidy up" button (full ultimate layout: R-tree pack → Cola → fit)
  colaLayoutTriggers.set(cy, () => {
    if (layoutRunning) { layoutQueued = true; return; }
    if (cy.nodes().length === 0) return;
    layoutRunning = true;
    layoutSafetyTimeout = setTimeout(() => {
      if (layoutRunning) {
        console.error(`[AutoLayout] ⚠️ Safety timeout (${LAYOUT_SAFETY_TIMEOUT_MS}ms) — tidy callback never fired, force-resetting.`);
        onLayoutComplete();
      }
    }, LAYOUT_SAFETY_TIMEOUT_MS);
    runFullUltimateLayout();
  });

  //console.log('[AutoLayout] Auto-layout enabled');

  // Return cleanup function
  return () => {
    cy.off('add', 'node', onNodeAdd);
    cy.off('remove', 'node', onNodeRemove);
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
    if (layoutSafetyTimeout) {
      clearTimeout(layoutSafetyTimeout);
    }

    //console.log('[AutoLayout] Auto-layout disabled');
  };
}
