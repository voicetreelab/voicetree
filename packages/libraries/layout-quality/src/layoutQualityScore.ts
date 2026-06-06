// Pure, deterministic layout-quality scorer — the crown jewel of the
// layout-quality verification driver.
//
// Grades a single laid-out graph (node positions/sizes + edges) against seven
// quality pillars, each normalised to [0,1] (1 = ideal), and a weighted
// composite. No DOM, no Cytoscape, no I/O: positions/sizes in, scores out. The
// Electron harness extracts real geometry from `window.cytoscapeInstance` and
// feeds it here; unit tests feed hand-built fixtures. Same inputs => same
// outputs.
//
// Rubric contract: openspec change `layout-quality-verification-driver`.

import {
  type LayoutBox,
  type LayoutEdge,
  type LayoutNode,
  type LayoutQualityScore,
  type LayoutScoringConfig,
  type PillarWeights,
  type Pillars,
  type RawMetrics,
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
} from './layoutQualityTypes';
import { nodeBox } from './layoutQualityGeometry';
import {
  bboxAreaPillar,
  componentSeparationPillar,
  componentsOf,
  edgeCrossingPillar,
  edgeLengthPillar,
  edgeSegments,
  nodeOverlapPillar,
  spatialDistributionPillar,
  titleLegibilityPillar,
} from './layoutQualityPillars';

export type {
  LayoutBox,
  LayoutEdge,
  LayoutNode,
  LayoutQualityScore,
  LayoutScoringConfig,
  PillarWeights,
  Pillars,
  RawMetrics,
};
export { DEFAULT_CONFIG, DEFAULT_WEIGHTS } from './layoutQualityTypes';
export { bandScore } from './layoutQualityGeometry';

// Median of a numeric list (private; used only for the median node extent).
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function compositeOf(pillars: Pillars, weights: PillarWeights): number {
  const entries: ReadonlyArray<readonly [number | null, number]> = [
    [pillars.nodeOverlap, weights.nodeOverlap],
    [pillars.edgeCrossing, weights.edgeCrossing],
    [pillars.titleLegibility, weights.titleLegibility],
    [pillars.edgeLength, weights.edgeLength],
    [pillars.spatialDistribution, weights.spatialDistribution],
    [pillars.componentSeparation, weights.componentSeparation],
    [pillars.bboxArea, weights.bboxArea],
  ];
  let weighted = 0;
  let weightSum = 0;
  for (const [score, weight] of entries) {
    if (score === null) continue;
    weighted += score * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? weighted / weightSum : 0;
}

/**
 * Score a laid-out graph against the seven layout-quality pillars.
 *
 * Pure and deterministic: identical inputs yield identical outputs. Node
 * coordinates are centers; width/height are label-inclusive extents. `config`
 * partially overrides {@link DEFAULT_CONFIG}.
 */
export function scoreLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  config?: Partial<LayoutScoringConfig>,
): LayoutQualityScore {
  const cfg: LayoutScoringConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    weights: { ...DEFAULT_WEIGHTS, ...(config?.weights ?? {}) },
  };

  const byId = new Map<string, LayoutNode>();
  const boxById = new Map<string, LayoutBox>();
  const boxes: LayoutBox[] = [];
  for (const n of nodes) {
    const box = nodeBox(n);
    byId.set(n.id, n);
    boxById.set(n.id, box);
    boxes.push(box);
  }
  const segs = edgeSegments(edges, byId);
  const medianExtent = medianOf(nodes.map((n) => (n.width + n.height) / 2));

  const overlap = nodeOverlapPillar(boxes);
  const crossing = edgeCrossingPillar(segs, edges.length, cfg);
  const title = titleLegibilityPillar(nodes, boxes, segs);
  const length = edgeLengthPillar(edges, byId, cfg);
  const distribution = spatialDistributionPillar(boxes, segs, cfg);
  const separation = componentSeparationPillar(componentsOf(nodes, edges), boxById, medianExtent, cfg);
  const bbox = bboxAreaPillar(overlap.totalNodeArea, distribution.bboxArea, cfg);

  const pillars: Pillars = {
    nodeOverlap: overlap.score,
    edgeCrossing: crossing.score,
    titleLegibility: title.score,
    edgeLength: length.score,
    spatialDistribution: distribution.score,
    componentSeparation: separation.score,
    bboxArea: bbox.score,
  };

  const rawMetrics: RawMetrics = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    totalNodeArea: overlap.totalNodeArea,
    totalOverlapArea: overlap.totalOverlapArea,
    overlappingPairCount: overlap.overlappingPairCount,
    overlappingNodeCount: overlap.overlappingNodeCount,
    edgeCrossingCount: crossing.crossings,
    edgeCrossingRate: crossing.rate,
    titleCount: title.titleCount,
    occludedTitleCount: title.occluded,
    meanEdgeLength: length.meanLength,
    inkArea: distribution.inkArea,
    graphBboxWidth: Math.max(0, distribution.bbox.x2 - distribution.bbox.x1),
    graphBboxHeight: Math.max(0, distribution.bbox.y2 - distribution.bbox.y1),
    graphBboxArea: distribution.bboxArea,
    density: distribution.density,
    distributionGiniCoefficient: distribution.gini,
    distributionGridCols: distribution.gridCols,
    distributionGridRows: distribution.gridRows,
    componentCount: separation.componentCount,
    componentPairCount: separation.pairCount,
    meanComponentGap: separation.meanGap,
    medianNodeExtent: medianExtent,
    idealBboxArea: bbox.idealBboxArea,
  };

  return {
    pillars,
    composite: compositeOf(pillars, cfg.weights),
    weights: cfg.weights,
    rawMetrics,
  };
}
