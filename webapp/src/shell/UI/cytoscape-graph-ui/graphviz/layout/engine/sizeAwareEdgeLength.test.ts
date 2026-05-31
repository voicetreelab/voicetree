import { describe, it, expect } from 'vitest';
import {
  boxHalfExtentAlong,
  idealEdgeLength,
  EDGE_GAP_FACTOR,
  type EdgeEndpointBox,
} from './sizeAwareEdgeLength';

describe('boxHalfExtentAlong', () => {
  it('returns half-width along the x-axis', () => {
    expect(boxHalfExtentAlong(100, 25, 1, 0)).toBe(100);
  });

  it('returns half-height along the y-axis', () => {
    expect(boxHalfExtentAlong(100, 25, 0, 1)).toBe(25);
  });

  it('is sign-independent (rays in opposite directions reach the same boundary)', () => {
    expect(boxHalfExtentAlong(100, 25, -1, 0)).toBe(100);
    expect(boxHalfExtentAlong(100, 25, 0, -1)).toBe(25);
  });

  it('exits the nearer side on a diagonal — a wide-flat box exits top/bottom first', () => {
    // 45° direction: reachX = 100/0.707 = 141, reachY = 25/0.707 = 35 → exits via height
    const r = Math.SQRT1_2;
    expect(boxHalfExtentAlong(100, 25, r, r)).toBeCloseTo(25 / r, 6);
  });

  it('is exactly the radius along any direction for a square box', () => {
    const r = Math.SQRT1_2;
    expect(boxHalfExtentAlong(50, 50, r, r)).toBeCloseTo(50 / r, 6); // 70.7 — corner reach
    expect(boxHalfExtentAlong(50, 50, 1, 0)).toBe(50);
  });
});

describe('idealEdgeLength', () => {
  const box = (cx: number, cy: number, w: number, h: number): EdgeEndpointBox => ({
    centerX: cx,
    centerY: cy,
    halfWidth: w / 2,
    halfHeight: h / 2,
  });

  it('is the sum of both reaches plus the proportional gap for a horizontal edge', () => {
    // Two identical 200x40 boxes side by side. Horizontal axis → reach = halfWidth = 100 each.
    // meanRadius = 0.25*(100+20) + 0.25*(100+20) = 60. gap = 2 * 60 = 120.
    const length = idealEdgeLength(box(0, 0, 200, 40), box(400, 0, 200, 40), 2);
    expect(length).toBeCloseTo(100 + 100 + 120, 6);
  });

  it('gives a SHORTER edge for small endpoints than for large ones (size-aware)', () => {
    const small = idealEdgeLength(box(0, 0, 40, 40), box(100, 0, 40, 40), EDGE_GAP_FACTOR);
    const large = idealEdgeLength(box(0, 0, 600, 250), box(1000, 0, 600, 250), EDGE_GAP_FACTOR);
    expect(small).toBeLessThan(large);
    // The small-circle edge is on the order of tens of px; the big-card edge hundreds.
    expect(small).toBeLessThan(150);
    expect(large).toBeGreaterThan(400);
  });

  it('uses the reach along the actual edge axis — vertical edges use box height', () => {
    // Wide-flat boxes stacked vertically: vertical reach = halfHeight = 20 each.
    const vertical = idealEdgeLength(box(0, 0, 200, 40), box(0, 300, 200, 40), 0);
    expect(vertical).toBeCloseTo(20 + 20, 6); // gapFactor 0 isolates the reaches
    // Same boxes horizontally: reach = halfWidth = 100 each → much longer.
    const horizontal = idealEdgeLength(box(0, 0, 200, 40), box(300, 0, 200, 40), 0);
    expect(horizontal).toBeCloseTo(100 + 100, 6);
    expect(horizontal).toBeGreaterThan(vertical);
  });

  it('stays finite when both endpoints share a position', () => {
    const length = idealEdgeLength(box(50, 50, 80, 80), box(50, 50, 80, 80), EDGE_GAP_FACTOR);
    expect(Number.isFinite(length)).toBe(true);
    expect(length).toBeGreaterThan(0);
  });

  it('grows monotonically with the gap factor', () => {
    const a = idealEdgeLength(box(0, 0, 100, 100), box(200, 0, 100, 100), 0.5);
    const b = idealEdgeLength(box(0, 0, 100, 100), box(200, 0, 100, 100), 2);
    expect(b).toBeGreaterThan(a);
  });
});
