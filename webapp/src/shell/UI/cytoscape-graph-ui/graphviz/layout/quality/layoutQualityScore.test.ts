import { describe, expect, it } from 'vitest';

import { scoreLayout, bandScore, DEFAULT_WEIGHTS } from './layoutQualityScore';
import type { LayoutQualityEdge, LayoutQualityNode, Pillars, PillarWeights } from './layoutQualityScore';

// Black-box tests: real geometry in, asserted scores out. No internal mocking —
// every assertion is on the observable output of the pure `scoreLayout` for a
// hand-built layout whose expected score is derivable from the rubric.

// A square node of side `s` centered at (x,y); width/height are label-inclusive.
function sq(id: string, x: number, y: number, s = 40, extra: Partial<LayoutQualityNode> = {}): LayoutQualityNode {
  return { id, x, y, width: s, height: s, ...extra };
}

// Recompute the composite from returned pillars+weights to assert the
// renormalization-over-present-pillars invariant as a black-box property.
function expectedComposite(pillars: Pillars, weights: PillarWeights): number {
  const entries: ReadonlyArray<readonly [number | null, number]> = [
    [pillars.nodeOverlap, weights.nodeOverlap],
    [pillars.edgeCrossing, weights.edgeCrossing],
    [pillars.titleLegibility, weights.titleLegibility],
    [pillars.edgeLength, weights.edgeLength],
    [pillars.whitespace, weights.whitespace],
    [pillars.componentSeparation, weights.componentSeparation],
    [pillars.bboxArea, weights.bboxArea],
  ];
  let w = 0; let acc = 0;
  for (const [s, weight] of entries) { if (s === null) continue; acc += s * weight; w += weight; }
  return w > 0 ? acc / w : 0;
}

describe('bandScore', () => {
  it('is 1 inside the band and decays as a ratio outside it', () => {
    expect(bandScore(50, 40, 200)).toBe(1);
    expect(bandScore(40, 40, 200)).toBe(1);
    expect(bandScore(200, 40, 200)).toBe(1);
    expect(bandScore(20, 40, 200)).toBeCloseTo(0.5, 6); // 20/40
    expect(bandScore(400, 40, 200)).toBeCloseTo(0.5, 6); // 200/400
    expect(bandScore(0, 40, 200)).toBe(0);
  });
});

describe('pillar 1 — node bbox overlap', () => {
  it('scores 1.0 when no boxes overlap', () => {
    const r = scoreLayout([sq('a', 0, 0), sq('b', 120, 0)], []);
    expect(r.pillars.nodeOverlap).toBe(1);
    expect(r.rawMetrics.overlappingPairCount).toBe(0);
    expect(r.rawMetrics.totalOverlapArea).toBe(0);
  });

  it('scores by overlap area normalized by total node area', () => {
    // Two identical 40x40 boxes fully coincident: overlap 1600, totalArea 3200.
    const r = scoreLayout([sq('a', 0, 0), sq('b', 0, 0)], []);
    expect(r.pillars.nodeOverlap).toBeCloseTo(0.5, 6);
    expect(r.rawMetrics.overlappingPairCount).toBe(1);
    expect(r.rawMetrics.totalOverlapArea).toBeCloseTo(1600, 6);
  });
});

describe('pillar 2 — edge crossing', () => {
  it('scores 1.0 for non-crossing edges', () => {
    // A-B and C-D are parallel, far apart: no crossing.
    const nodes = [sq('a', 0, 0), sq('b', 200, 0), sq('c', 0, 300), sq('d', 200, 300)];
    const edges: LayoutQualityEdge[] = [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }];
    const r = scoreLayout(nodes, edges);
    expect(r.rawMetrics.edgeCrossingCount).toBe(0);
    expect(r.pillars.edgeCrossing).toBe(1);
  });

  it('counts a proper crossing and normalizes by edge count', () => {
    // Diagonals of a square cross at the center; endpoints share no node.
    const nodes = [sq('a', 0, 0), sq('c', 300, 300), sq('b', 0, 300), sq('d', 300, 0)];
    const edges: LayoutQualityEdge[] = [{ source: 'a', target: 'c' }, { source: 'b', target: 'd' }];
    const r = scoreLayout(nodes, edges);
    expect(r.rawMetrics.edgeCrossingCount).toBe(1);
    expect(r.rawMetrics.edgeCrossingRate).toBeCloseTo(0.5, 6); // 1 / 2 edges
    expect(r.pillars.edgeCrossing).toBeCloseTo(1 / 1.5, 6);
  });

  it('does not count edges that merely share a node', () => {
    // A-B and A-C meet at A — legitimate, not a crossing.
    const nodes = [sq('a', 0, 0), sq('b', 200, 50), sq('c', 200, -50)];
    const edges: LayoutQualityEdge[] = [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }];
    const r = scoreLayout(nodes, edges);
    expect(r.rawMetrics.edgeCrossingCount).toBe(0);
  });
});

describe('pillar 3 — title legibility', () => {
  it('is null when no node carries a title box', () => {
    const r = scoreLayout([sq('a', 0, 0), sq('b', 120, 0)], []);
    expect(r.pillars.titleLegibility).toBeNull();
    expect(r.rawMetrics.titleCount).toBe(0);
  });

  it('scores 1.0 for a clear title and penalizes an edge-crossed title', () => {
    const titleBox = { x1: 90, y1: -10, x2: 110, y2: 10 }; // around (100,0)
    // Clear: title at (100,0), other nodes far, no edge near it.
    const clear = scoreLayout(
      [sq('t', 100, 0, 40, { titleBox }), sq('x', 600, 600), sq('y', 800, 600)],
      [{ source: 'x', target: 'y' }],
    );
    expect(clear.pillars.titleLegibility).toBe(1);

    // Occluded: edge x->y runs along y=0 straight through the title box, and
    // neither x nor y is the titled node.
    const occluded = scoreLayout(
      [sq('t', 100, 0, 40, { titleBox }), sq('x', -200, 0), sq('y', 400, 0)],
      [{ source: 'x', target: 'y' }],
    );
    expect(occluded.pillars.titleLegibility).toBe(0);
    expect(occluded.rawMetrics.occludedTitleCount).toBe(1);
  });
});

describe('pillar 4 — edge-length goldilocks', () => {
  it('scores 1.0 at an ideal-band separation and penalizes cramped/stretched', () => {
    // 40x40 nodes: effR=20 each, idealMin=50, idealMax=120.
    const ideal = scoreLayout([sq('a', 0, 0), sq('b', 100, 0)], [{ source: 'a', target: 'b' }]);
    expect(ideal.pillars.edgeLength).toBe(1); // d=100 within [50,120]

    const cramped = scoreLayout([sq('a', 0, 0), sq('b', 30, 0)], [{ source: 'a', target: 'b' }]);
    expect(cramped.pillars.edgeLength).toBeCloseTo(30 / 50, 6);

    const stretched = scoreLayout([sq('a', 0, 0), sq('b', 600, 0)], [{ source: 'a', target: 'b' }]);
    expect(stretched.pillars.edgeLength).toBeCloseTo(120 / 600, 6);
  });

  it('is null when there are no edges', () => {
    const r = scoreLayout([sq('a', 0, 0), sq('b', 120, 0)], []);
    expect(r.pillars.edgeLength).toBeNull();
  });
});

describe('pillar 6 — component separation', () => {
  it('is null for a single connected component', () => {
    const r = scoreLayout([sq('a', 0, 0), sq('b', 100, 0)], [{ source: 'a', target: 'b' }]);
    expect(r.pillars.componentSeparation).toBeNull();
    expect(r.rawMetrics.componentCount).toBe(1);
  });

  it('scores two well-separated components in-band at 1.0', () => {
    // medianExtent=40 → band [40,200]. Comp1 bbox x:[-20,120], comp2 bbox
    // x:[280,420]; gap = 280-120 = 160, in band.
    const nodes = [sq('a', 0, 0), sq('b', 100, 0), sq('c', 300, 0), sq('d', 400, 0)];
    const edges: LayoutQualityEdge[] = [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }];
    const r = scoreLayout(nodes, edges);
    expect(r.rawMetrics.componentCount).toBe(2);
    expect(r.pillars.componentSeparation).toBe(1);
  });

  it('honors explicit componentId grouping', () => {
    const nodes = [
      sq('a', 0, 0, 40, { componentId: 1 }),
      sq('b', 300, 0, 40, { componentId: 2 }),
    ];
    const r = scoreLayout(nodes, []);
    expect(r.rawMetrics.componentCount).toBe(2);
  });
});

describe('composite', () => {
  it('renormalizes over present (non-null) pillars and stays in [0,1]', () => {
    const nodes = [sq('a', 0, 0), sq('b', 100, 0)];
    const edges: LayoutQualityEdge[] = [{ source: 'a', target: 'b' }];
    const r = scoreLayout(nodes, edges);
    // No titleBox, single component → those two pillars are null and dropped.
    expect(r.pillars.titleLegibility).toBeNull();
    expect(r.pillars.componentSeparation).toBeNull();
    expect(r.composite).toBeCloseTo(expectedComposite(r.pillars, r.weights), 9);
    expect(r.composite).toBeGreaterThanOrEqual(0);
    expect(r.composite).toBeLessThanOrEqual(1);
    expect(r.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('ranks a clean layout strictly above an overlapping, edge-crossed one', () => {
    // Clean: 4 nodes on a wide ring, tree edges, no overlap, no crossings.
    const clean = scoreLayout(
      [sq('a', 0, 0), sq('b', 200, 0), sq('c', 200, 200), sq('d', 0, 200)],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }],
    );
    // Bad: all nodes piled at the origin (full overlap) with crossing diagonals.
    const bad = scoreLayout(
      [sq('a', 0, 0), sq('b', 5, 0), sq('c', 5, 5), sq('d', 0, 5)],
      [{ source: 'a', target: 'c' }, { source: 'b', target: 'd' }],
    );
    expect(clean.composite).toBeGreaterThan(bad.composite);
    expect(clean.pillars.nodeOverlap).toBeGreaterThan(bad.pillars.nodeOverlap);
  });

  it('is deterministic — identical inputs yield identical output', () => {
    const nodes = [sq('a', 0, 0), sq('b', 130, 40), sq('c', 60, 220)];
    const edges: LayoutQualityEdge[] = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
    expect(scoreLayout(nodes, edges)).toEqual(scoreLayout(nodes, edges));
  });
});

describe('empty / degenerate input', () => {
  it('does not throw and returns a finite composite for an empty graph', () => {
    const r = scoreLayout([], []);
    expect(Number.isFinite(r.composite)).toBe(true);
    expect(r.rawMetrics.nodeCount).toBe(0);
  });
});
