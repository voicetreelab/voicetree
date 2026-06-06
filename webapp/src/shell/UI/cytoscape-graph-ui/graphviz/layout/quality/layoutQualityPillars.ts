// The seven pure pillar computations + component grouping.
//
// Each pillar takes already-derived geometry and returns its [0,1] score plus
// the raw numbers feeding it. Kept separate from the public `scoreLayout` deep
// function (layoutQualityScore.ts) and from the geometry primitives
// (layoutQualityGeometry.ts).

import type { LayoutBox, LayoutEdge, LayoutNode, LayoutScoringConfig } from './layoutQualityTypes';
import {
  type Point,
  bandScore,
  boxArea,
  boxGap,
  boxOverlapArea,
  clamp01,
  effRadius,
  giniCoefficient,
  segmentCrossesBox,
  segmentsCross,
} from './layoutQualityGeometry';

export type EdgeSeg = { readonly p1: Point; readonly p2: Point; readonly source: string; readonly target: string };

export function edgeSegments(edges: readonly LayoutEdge[], byId: Map<string, LayoutNode>): EdgeSeg[] {
  const segs: EdgeSeg[] = [];
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    segs.push({ p1: { x: s.x, y: s.y }, p2: { x: t.x, y: t.y }, source: e.source, target: e.target });
  }
  return segs;
}

// ── Pillar 1: node bbox overlap (hard constraint) ───────────────────────────

export function nodeOverlapPillar(boxes: readonly LayoutBox[]): {
  score: number; totalOverlapArea: number; totalNodeArea: number; overlappingPairCount: number;
} {
  let totalNodeArea = 0;
  for (const b of boxes) totalNodeArea += boxArea(b);
  let totalOverlapArea = 0;
  let overlappingPairCount = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const area = boxOverlapArea(boxes[i], boxes[j]);
      if (area > 0) { totalOverlapArea += area; overlappingPairCount += 1; }
    }
  }
  const score = totalNodeArea > 0 ? clamp01(1 - totalOverlapArea / totalNodeArea) : 1;
  return { score, totalOverlapArea, totalNodeArea, overlappingPairCount };
}

// ── Pillar 2: edge–edge crossing ────────────────────────────────────────────

export function edgeCrossingPillar(
  segs: readonly EdgeSeg[],
  edgeCount: number,
  config: LayoutScoringConfig,
): { score: number; crossings: number; rate: number } {
  let crossings = 0;
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const a = segs[i];
      const b = segs[j];
      // Edges meeting at a shared node legitimately touch — not a crossing.
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
      if (segmentsCross(a.p1, a.p2, b.p1, b.p2)) crossings += 1;
    }
  }
  const rate = crossings / Math.max(edgeCount, 1);
  // Steep penalty: with k≈4 a clean layout (rate ~0.02) scores ~0.92, while a
  // crossing-heavy one (rate ~0.2) drops to ~0.55. The previous 1/(1+rate)
  // barely moved (0.83 at rate 0.2), letting crossing-heavy layouts pass.
  return { score: 1 / (1 + config.edgeCrossingPenaltyK * rate), crossings, rate };
}

// ── Pillar 3: title/label legibility (hard constraint) ──────────────────────

export function titleLegibilityPillar(
  nodes: readonly LayoutNode[],
  boxes: readonly LayoutBox[],
  segs: readonly EdgeSeg[],
): { score: number | null; titleCount: number; occluded: number } {
  let titleCount = 0;
  let occluded = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const title = nodes[i].titleBox;
    if (!title) continue;
    titleCount += 1;
    const id = nodes[i].id;
    let isOccluded = false;
    // Crossed by a NON-incident edge segment (a node's own edges legitimately
    // emanate from it, so they are excluded).
    for (const seg of segs) {
      if (seg.source === id || seg.target === id) continue;
      if (segmentCrossesBox(seg.p1, seg.p2, title)) { isOccluded = true; break; }
    }
    // Or overlapping ANOTHER node's label-inclusive bbox.
    if (!isOccluded) {
      for (let j = 0; j < nodes.length; j += 1) {
        if (j === i) continue;
        if (boxOverlapArea(title, boxes[j]) > 0) { isOccluded = true; break; }
      }
    }
    if (isOccluded) occluded += 1;
  }
  if (titleCount === 0) return { score: null, titleCount: 0, occluded: 0 };
  return { score: clamp01(1 - occluded / titleCount), titleCount, occluded };
}

// ── Pillar 4: edge-length goldilocks ────────────────────────────────────────

export function edgeLengthPillar(
  edges: readonly LayoutEdge[],
  byId: Map<string, LayoutNode>,
  config: LayoutScoringConfig,
): { score: number | null; meanLength: number } {
  let sumScore = 0;
  let sumLength = 0;
  let count = 0;
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const rS = effRadius(s);
    const rT = effRadius(t);
    const meanEff = (rS + rT) / 2;
    const idealMin = rS + rT + config.edgeGapMinFactor * meanEff;
    const idealMax = rS + rT + config.edgeGapMaxFactor * meanEff;
    const d = Math.hypot(t.x - s.x, t.y - s.y);
    sumScore += bandScore(d, idealMin, idealMax);
    sumLength += d;
    count += 1;
  }
  if (count === 0) return { score: null, meanLength: 0 };
  return { score: sumScore / count, meanLength: sumLength / count };
}

// ── Pillar 5: spatial distribution / whitespace evenness (yields graph bbox) ──
//
// Grades how EVENLY nodes fill the bounding box. A global density-in-band check
// (the old pillar) saturated at 1.0 for every layout — it could not tell a tidy
// even spread from one with a dominating hub fan and a large empty band. Instead
// we grid the bbox into ~square cells, count node centers per cell, and take the
// Gini coefficient of those counts: 0 = perfectly even (score 1), high = mass
// clumped into a few cells with large voids elsewhere (low score).

export function spatialDistributionPillar(
  boxes: readonly LayoutBox[],
  segs: readonly EdgeSeg[],
  config: LayoutScoringConfig,
): {
  score: number; inkArea: number; density: number; bbox: LayoutBox; bboxArea: number;
  gini: number; gridCols: number; gridRows: number;
} {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  let nodeArea = 0;
  for (const b of boxes) {
    nodeArea += boxArea(b);
    x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1);
    x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2);
  }
  const bbox: LayoutBox = boxes.length > 0 ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 0, y2: 0 };
  const area = boxArea(bbox);
  let edgeInk = 0;
  for (const seg of segs) {
    edgeInk += Math.hypot(seg.p2.x - seg.p1.x, seg.p2.y - seg.p1.y) * config.edgeWidthPx;
  }
  const inkArea = nodeArea + edgeInk;
  const density = area > 0 ? inkArea / area : 0;

  const distribution = distributionScore(boxes, bbox, config);
  return { ...distribution, inkArea, density, bbox, bboxArea: area };
}

// Grid the bbox into ~square cells (target count ≈ nodeCount / nodesPerCell,
// clamped), tally node centers per cell, and score by 1 − Gini(cell counts).
function distributionScore(
  boxes: readonly LayoutBox[],
  bbox: LayoutBox,
  config: LayoutScoringConfig,
): { score: number; gini: number; gridCols: number; gridRows: number } {
  const n = boxes.length;
  const w = bbox.x2 - bbox.x1;
  const h = bbox.y2 - bbox.y1;
  if (n < 2 || !(w > 0) || !(h > 0)) return { score: 1, gini: 0, gridCols: 1, gridRows: 1 };

  const [minCells, maxCells] = config.distributionCellRange;
  const targetCells = Math.min(maxCells, Math.max(minCells, Math.round(n / config.distributionNodesPerCell)));
  const cellSize = Math.sqrt((w * h) / targetCells);
  const cols = Math.max(1, Math.round(w / cellSize));
  const rows = Math.max(1, Math.round(h / cellSize));

  const counts = new Array<number>(cols * rows).fill(0);
  for (const b of boxes) {
    const cx = (b.x1 + b.x2) / 2;
    const cy = (b.y1 + b.y2) / 2;
    const ci = Math.min(cols - 1, Math.max(0, Math.floor(((cx - bbox.x1) / w) * cols)));
    const ri = Math.min(rows - 1, Math.max(0, Math.floor(((cy - bbox.y1) / h) * rows)));
    counts[ri * cols + ci] += 1;
  }
  const gini = giniCoefficient(counts);
  return { score: clamp01(1 - gini), gini, gridCols: cols, gridRows: rows };
}

// ── Pillar 6: component separation goldilocks ───────────────────────────────

function boundingBoxOf(ids: readonly string[], boxById: Map<string, LayoutBox>): LayoutBox {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of ids) {
    const b = boxById.get(id);
    if (!b) continue;
    x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1);
    x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2);
  }
  return { x1, y1, x2, y2 };
}

export function componentSeparationPillar(
  groups: Map<string, string[]>,
  boxById: Map<string, LayoutBox>,
  medianExtent: number,
  config: LayoutScoringConfig,
): { score: number | null; componentCount: number; pairCount: number; meanGap: number } {
  const boxes = [...groups.values()].map((ids) => boundingBoxOf(ids, boxById));
  const componentCount = boxes.length;
  if (componentCount < 2) return { score: null, componentCount, pairCount: 0, meanGap: 0 };
  const [loF, hiF] = config.componentGapBandFactors;
  const lo = loF * medianExtent;
  const hi = hiF * medianExtent;
  let sumScore = 0;
  let sumGap = 0;
  let pairCount = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const gap = boxGap(boxes[i], boxes[j]);
      sumScore += bandScore(gap, lo, hi);
      sumGap += gap;
      pairCount += 1;
    }
  }
  return { score: sumScore / pairCount, componentCount, pairCount, meanGap: sumGap / pairCount };
}

// ── Pillar 7: overall graph bbox area (compactness) ─────────────────────────

export function bboxAreaPillar(totalNodeArea: number, graphBboxArea: number, config: LayoutScoringConfig): {
  score: number; idealBboxArea: number;
} {
  const idealBboxArea = config.bboxTargetPacking > 0 ? totalNodeArea / config.bboxTargetPacking : totalNodeArea;
  const score = graphBboxArea > 0 ? clamp01(idealBboxArea / graphBboxArea) : 1;
  return { score, idealBboxArea };
}

// ── Connected components (explicit componentId, else union-find over edges) ──

export function componentsOf(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const hasExplicit = nodes.length > 0 && nodes.every((n) => n.componentId !== undefined);
  if (hasExplicit) {
    for (const n of nodes) {
      const key = String(n.componentId);
      const bucket = groups.get(key);
      if (bucket) bucket.push(n.id); else groups.set(key, [n.id]);
    }
    return groups;
  }

  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = a;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    parent.set(find(e.source), find(e.target));
  }
  for (const n of nodes) {
    const root = find(n.id);
    const bucket = groups.get(root);
    if (bucket) bucket.push(n.id); else groups.set(root, [n.id]);
  }
  return groups;
}
