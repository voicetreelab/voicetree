/**
 * Local Cola layout: incremental refinement on the neighborhood of newly added nodes.
 *
 * Extracted from autoLayout.ts to keep file sizes manageable.
 * Run set: 10-hop BFS capped at 50 (free to move).
 * Pin set: spatial R-tree boundary (locked anchors).
 * Uses Cola (25/25/25 iterations) — packing handles disconnected components.
 * Post-Cola overlap resolution pushes run-set nodes away from non-subgraph nodes.
 * On completion, unlocks pins and chains to onComplete.
 */

import type { Core, NodeSingular, EdgeSingular, CollectionReturnValue } from 'cytoscape';
import { computeColaAndAnimate } from './computeColaAndAnimate';
import { refreshSpatialIndex, getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { findObstacles } from '@/pure/graph/spatial';
import type { SpatialIndex, SpatialNodeEntry, SpatialEdgeEntry } from '@/pure/graph/spatial';
import type { AutoLayoutOptions } from './autoLayoutTypes';
import { DEFAULT_OPTIONS, COLA_FAST_ANIMATE_DURATION } from './autoLayoutTypes';
import { getLocalNeighborhood } from './autoLayoutNeighborhood';
import { componentsOverlap, separateOverlappingComponents } from '@/pure/graph/positioning/packComponents';
import type { ComponentSubgraph } from '@/pure/graph/positioning/packComponents';

/**
 * Run Cola on the local neighborhood of newly added nodes.
 *
 * @param cy - Cytoscape instance
 * @param newNodeIds - Set of newly added node IDs to center the local layout on
 * @param colaConfig - Current Cola layout options (from settings)
 * @param onComplete - Called when local Cola finishes
 */
export function runLocalCola(
  cy: Core,
  newNodeIds: Set<string>,
  colaConfig: AutoLayoutOptions,
  onComplete: () => void,
): void {
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

  // Capped topology + spatial-only neighborhood selection
  const { runNodes, pinNodes } = getLocalNeighborhood(cy, newNodes, getCurrentIndex(cy));
  pinNodes.lock();
  const allNodes: CollectionReturnValue = runNodes.union(pinNodes);

  // Collect edges where both endpoints are in the subgraph, excluding indicator edges
  const subgraphEdges: CollectionReturnValue = allNodes.connectedEdges().filter(
    edge => !edge.data('isIndicatorEdge')
      && allNodes.contains(edge.source()) && allNodes.contains(edge.target())
  );

  // Cola (25/25/25 iterations) with 1000ms animation
  // Higher iterations for better convergence of the overlap constraint solver
  computeColaAndAnimate({
    cy: cy,
    eles: allNodes.union(subgraphEdges),
    randomize: false,
    avoidOverlap: true,
    handleDisconnected: false,
    convergenceThreshold: 1.5,
    maxSimulationTime: 1000,
    unconstrIter: 25,
    userConstIter: 25,
    allConstIter: 25,
    nodeSpacing: 120,
    edgeLength: colaConfig.edgeLength ?? DEFAULT_OPTIONS.edgeLength,
    centerGraph: false,
    fit: false,
    nodeDimensionsIncludeLabels: true,
  }, runNodes, COLA_FAST_ANIMATE_DURATION, () => {
    pinNodes.unlock();
    refreshSpatialIndex(cy);

    // Coarse pass: separate overlapping disconnected components first.
    // This moves whole components cleanly before the fine-grained push loop,
    // so individual node pushes don't scatter nodes that should move together.
    const nonContextEles: CollectionReturnValue = cy.elements().filter(ele => {
      if (ele.isNode()) return !ele.data('isContextNode');
      return !ele.source().data('isContextNode') && !ele.target().data('isContextNode');
    });
    const components: CollectionReturnValue[] = nonContextEles.components();
    if (components.length > 1) {
      const subgraphs: ComponentSubgraph[] = components.map(
        (comp: CollectionReturnValue): ComponentSubgraph => ({
          nodes: comp.nodes().map((n: NodeSingular) => ({
            x: n.position('x'), y: n.position('y'),
            width: n.outerWidth(), height: n.outerHeight(),
          })),
          edges: comp.edges()
            .filter((e: EdgeSingular): boolean => e.sourceEndpoint() != null && e.targetEndpoint() != null)
            .map((e: EdgeSingular) => ({
              startX: e.sourceEndpoint().x, startY: e.sourceEndpoint().y,
              endX: e.targetEndpoint().x, endY: e.targetEndpoint().y,
            })),
        })
      );
      if (componentsOverlap(subgraphs)) {
        const { shifts } = separateOverlappingComponents(subgraphs);
        components.forEach((comp: CollectionReturnValue, i: number): void => {
          const shift: { readonly dx: number; readonly dy: number } | undefined = shifts[i];
          if (shift && (shift.dx !== 0 || shift.dy !== 0)) {
            comp.nodes().shift({ x: shift.dx, y: shift.dy });
          }
        });
        refreshSpatialIndex(cy);
      }
    }

    // Post-Cola overlap resolution: multi-pass (max 3 iterations).
    // Cola only avoids overlaps within its subgraph. Run-set nodes may overlap
    // non-subgraph nodes. Pushing node A away from B may cause overlap with C.
    const MAX_OVERLAP_PASSES: number = 3;
    for (let pass: number = 0; pass < MAX_OVERLAP_PASSES; pass++) {
      const postIndex: SpatialIndex | undefined = getCurrentIndex(cy);
      if (!postIndex) break;
      let didResolve: boolean = false;
      runNodes.forEach((node: NodeSingular) => {
        const bb: { x1: number; y1: number; x2: number; y2: number; w: number; h: number } = node.boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
        const searchRect: { minX: number; minY: number; maxX: number; maxY: number } = { minX: bb.x1, minY: bb.y1, maxX: bb.x2, maxY: bb.y2 };
        const { nodes: nearbyNodes, edges: nearbyEdges }: { readonly nodes: readonly SpatialNodeEntry[]; readonly edges: readonly SpatialEdgeEntry[] } = findObstacles(postIndex, searchRect);
        let pushed: boolean = false;

        // 1. Check node-node overlaps (higher priority)
        for (const entry of nearbyNodes) {
          if (entry.nodeId === node.id()) continue;
          const other: CollectionReturnValue = cy.getElementById(entry.nodeId);
          if (other.length === 0 || allNodes.contains(other) || other.data('isContextNode')) continue;
          // Overlap with a non-subgraph node — push the run node away
          const nodeCx: number = (bb.x1 + bb.x2) / 2;
          const nodeCy: number = (bb.y1 + bb.y2) / 2;
          const otherCx: number = (entry.minX + entry.maxX) / 2;
          const otherCy: number = (entry.minY + entry.maxY) / 2;
          let dx: number = nodeCx - otherCx;
          let dy: number = nodeCy - otherCy;
          const dist: number = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.01) { dx = 1; dy = 0; }
          else { dx /= dist; dy /= dist; }
          const overlapW: number = Math.min(bb.x2, entry.maxX) - Math.max(bb.x1, entry.minX);
          const overlapH: number = Math.min(bb.y2, entry.maxY) - Math.max(bb.y1, entry.minY);
          const pushDist: number = Math.max(overlapW, overlapH) + 20;
          node.shift({ x: dx * pushDist, y: dy * pushDist });
          pushed = true;
          didResolve = true;
          break; // one push per node per pass
        }

        // 2. Check node-on-edge overlaps (only if no node overlap resolved)
        if (!pushed) {
          for (const edgeEntry of nearbyEdges) {
            const cyEdge: CollectionReturnValue = cy.getElementById(edgeEntry.edgeId);
            if (cyEdge.length === 0) continue;
            if (cyEdge.data('isIndicatorEdge')) continue;
            // Skip edges fully within the Cola subgraph (Cola handled those)
            const srcId: string = cyEdge.data('source') as string;
            const tgtId: string = cyEdge.data('target') as string;
            if (allNodes.getElementById(srcId).length > 0 && allNodes.getElementById(tgtId).length > 0) continue;
            // Push perpendicular to the edge segment
            const nodeCx: number = (bb.x1 + bb.x2) / 2;
            const nodeCy: number = (bb.y1 + bb.y2) / 2;
            const segDx: number = edgeEntry.x2 - edgeEntry.x1;
            const segDy: number = edgeEntry.y2 - edgeEntry.y1;
            const segLenSq: number = segDx * segDx + segDy * segDy;
            let t: number = 0;
            if (segLenSq > 0.0001) {
              t = Math.max(0, Math.min(1, ((nodeCx - edgeEntry.x1) * segDx + (nodeCy - edgeEntry.y1) * segDy) / segLenSq));
            }
            const closestX: number = edgeEntry.x1 + t * segDx;
            const closestY: number = edgeEntry.y1 + t * segDy;
            let dx: number = nodeCx - closestX;
            let dy: number = nodeCy - closestY;
            const dist: number = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.01) {
              // Node center is on the edge — push perpendicular
              dx = -segDy; dy = segDx;
              const perpLen: number = Math.sqrt(dx * dx + dy * dy);
              if (perpLen > 0.01) { dx /= perpLen; dy /= perpLen; }
              else { dx = 1; dy = 0; }
            } else {
              dx /= dist; dy /= dist;
            }
            const pushDist: number = Math.max(bb.w, bb.h) / 2 + 20;
            node.shift({ x: dx * pushDist, y: dy * pushDist });
            didResolve = true;
            break; // one push per node per pass
          }
        }
      });
      if (!didResolve) break;
      refreshSpatialIndex(cy);
    }

    onComplete();
  });
}
