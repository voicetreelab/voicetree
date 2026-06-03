// Pure geometry + scoring primitives for the layout-quality scorer.
//
// Segment-intersection and segment-vs-rect tests are REUSED from graph-model's
// battle-tested `spatial` geometry (no duplication); this module adds the
// box-area / box-gap / band-score / median helpers the pillars need.

import type { EdgeSegment } from '@vt/graph-model/spatial';
import { segmentsIntersect, rectIntersectsSegment } from '@vt/graph-model/spatial';

import type { LayoutBox, LayoutNode } from './layoutQualityTypes';

export type Point = { readonly x: number; readonly y: number };

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Smooth ratio-based goldilocks score: 1 inside [lo,hi], decaying as a ratio
// toward 0 on both sides. Penalises "too small" and "too large" symmetrically
// in ratio space, so it is scale-free.
export function bandScore(v: number, lo: number, hi: number): number {
  if (!(v > 0) || !(lo > 0) || !(hi >= lo)) {
    // Degenerate band (zero-size nodes, lo>=hi): only a value inside counts.
    return v > 0 && v >= lo && v <= hi ? 1 : 0;
  }
  if (v < lo) return v / lo;
  if (v > hi) return hi / v;
  return 1;
}

// Gini coefficient of a list of non-negative values: 0 = perfectly even, → 1 as
// all mass concentrates in one entry. Used to grade how evenly nodes spread
// across the layout's bounding box (voids and clumps both raise it). Standard
// sorted-rank formula, O(n log n).
export function giniCoefficient(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  if (!(total > 0)) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let cumulative = 0;
  for (let i = 0; i < n; i += 1) cumulative += (i + 1) * sorted[i];
  return clamp01((2 * cumulative) / (n * total) - (n + 1) / n);
}

export function nodeBox(node: LayoutNode): LayoutBox {
  const hw = node.width / 2;
  const hh = node.height / 2;
  return { x1: node.x - hw, y1: node.y - hh, x2: node.x + hw, y2: node.y + hh };
}

export function boxArea(b: LayoutBox): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
}

export function boxOverlapArea(a: LayoutBox, b: LayoutBox): number {
  const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

// Euclidean gap between two axis-aligned boxes (0 when they overlap on both
// axes), i.e. the straight-line empty distance separating them.
export function boxGap(a: LayoutBox, b: LayoutBox): number {
  const dx = Math.max(0, a.x1 - b.x2, b.x1 - a.x2);
  const dy = Math.max(0, a.y1 - b.y2, b.y1 - a.y2);
  return Math.hypot(dx, dy);
}

// Effective radius: a size-agnostic half-extent (mean of the four half-sides)
// used to set per-edge length bands relative to the endpoint node sizes.
export function effRadius(node: LayoutNode): number {
  return 0.25 * (node.width + node.height);
}

export function toSegment(p1: Point, p2: Point): EdgeSegment {
  return { p1, p2 };
}

// True when segments p1p2 and q1q2 cross. Wraps graph-model's `segmentsIntersect`
// (which excludes shared-endpoint touches by coordinate equality).
export function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  return segmentsIntersect({ p1, p2 }, { p1: q1, p2: q2 });
}

// True when segment p1p2 enters or crosses box `b`. Wraps graph-model's
// `rectIntersectsSegment` (box shape {x1,x2,y1,y2} is compatible).
export function segmentCrossesBox(p1: Point, p2: Point, b: LayoutBox): boolean {
  return rectIntersectsSegment(b, { p1, p2 });
}
