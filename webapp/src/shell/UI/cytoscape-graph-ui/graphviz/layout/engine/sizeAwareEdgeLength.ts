// Size-aware per-edge rest length for the WebCoLA backend.
//
// The layout defect this fixes (see fa2-structural-mismatch-diagnosis): a single
// global edge length is size-blind. VoiceTree graphs mix tiny degree-scaled
// circles with wide title labels and large editor/terminal cards, so one rest
// length can't give small nodes short edges AND large nodes edges that clear
// their boxes. WebCoLA can encode a *per-edge* ideal length, so we compute one
// from the endpoint geometry: the distance each endpoint box reaches toward the
// other along the edge axis, plus a breathing gap proportional to the endpoints'
// size. Small boxes → short edges; large boxes → long edges — continuously.
//
// Pure geometry (`boxHalfExtentAlong`, `idealEdgeLength`) is separated from the
// Cytoscape adapter (`sizeAwareEdgeLength`) so the geometry is black-box testable
// without a live graph.

import type { EdgeSingular, NodeSingular } from 'cytoscape';

/** Endpoint geometry the rest-length computation needs: box center + half-extents. */
export type EdgeEndpointBox = {
  readonly centerX: number;
  readonly centerY: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
};

/**
 * Breathing gap as a multiple of the endpoints' mean radius. The gap is the
 * empty span the edge should add beyond where the two boxes reach toward each
 * other; making it proportional to node size keeps spacing visually balanced
 * (small nodes pack tight, large nodes get proportional room) instead of a
 * single absolute gap that looks cramped around large cards and sparse around
 * small circles. Tuned against the layout-quality scorecard.
 */
export const EDGE_GAP_FACTOR: number = 1.6;

/**
 * Exact distance from a centered axis-aligned box's center to its boundary along
 * the unit direction (ux, uy) — the ray/box intersection length. Reduces to
 * halfWidth along the x-axis and halfHeight along the y-axis; for a diagonal
 * direction it is whichever side the ray exits first.
 */
export function boxHalfExtentAlong(halfWidth: number, halfHeight: number, ux: number, uy: number): number {
  const ax: number = Math.abs(ux);
  const ay: number = Math.abs(uy);
  const reachX: number = ax > 1e-9 ? halfWidth / ax : Infinity;
  const reachY: number = ay > 1e-9 ? halfHeight / ay : Infinity;
  return Math.min(reachX, reachY);
}

/**
 * Size-aware ideal edge length (center-to-center): each endpoint box's reach
 * toward the other along the edge axis, plus a size-proportional breathing gap.
 * Direction is taken from the current centers; when the centers coincide it
 * falls back to the horizontal axis so the result stays finite.
 */
export function idealEdgeLength(src: EdgeEndpointBox, tgt: EdgeEndpointBox, gapFactor: number): number {
  const dx: number = tgt.centerX - src.centerX;
  const dy: number = tgt.centerY - src.centerY;
  const dist: number = Math.hypot(dx, dy);
  const ux: number = dist > 1e-9 ? dx / dist : 1;
  const uy: number = dist > 1e-9 ? dy / dist : 0;
  const srcReach: number = boxHalfExtentAlong(src.halfWidth, src.halfHeight, ux, uy);
  const tgtReach: number = boxHalfExtentAlong(tgt.halfWidth, tgt.halfHeight, ux, uy);
  const meanRadius: number = 0.25 * (src.halfWidth + src.halfHeight) + 0.25 * (tgt.halfWidth + tgt.halfHeight);
  return srcReach + tgtReach + gapFactor * meanRadius;
}

const endpointBox = (node: NodeSingular): EdgeEndpointBox => {
  const bb = node.boundingBox({ includeLabels: true, includeOverlays: false, includeEdges: false });
  return {
    centerX: (bb.x1 + bb.x2) / 2,
    centerY: (bb.y1 + bb.y2) / 2,
    halfWidth: Math.max(0.5, bb.w / 2),
    halfHeight: Math.max(0.5, bb.h / 2),
  };
};

/**
 * Per-edge rest length for WebCoLA, read from the live label-inclusive boxes of
 * the edge's endpoints. Pass directly as the cola `edgeLength` option (cola calls
 * it once per edge at setup, via getOptVal).
 */
export const sizeAwareEdgeLength = (edge: EdgeSingular): number =>
  idealEdgeLength(endpointBox(edge.source()), endpointBox(edge.target()), EDGE_GAP_FACTOR);
