// Types + tunable defaults for the pure layout-quality scorer.
//
// Rubric contract: openspec change `layout-quality-verification-driver`.
// See layoutQualityScore.ts for the deep public API.

// Axis-aligned box in absolute layout coordinates (x1<=x2, y1<=y2). Named
// `LayoutBox` rather than `Rect` to stay distinct from graph-model's spatial
// `Rect` ({minX,maxX,...}) — different shape, different domain.
export type LayoutBox = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

export type LayoutNode = {
  readonly id: string;
  // Center coordinates (Cytoscape `node.position()`).
  readonly x: number;
  readonly y: number;
  // Label-INCLUSIVE bounding box extent (Cytoscape
  // `node.boundingBox({ includeLabels: true })` width/height).
  readonly width: number;
  readonly height: number;
  // Absolute title-text rectangle, when known. Drives pillar 3 (legibility).
  readonly titleBox?: LayoutBox;
  // Precomputed connected-component grouping. When omitted for every node the
  // scorer derives components via union-find over the edge list.
  readonly componentId?: string | number;
};

export type LayoutEdge = {
  readonly source: string;
  readonly target: string;
};

export type PillarWeights = {
  readonly nodeOverlap: number;
  readonly edgeCrossing: number;
  readonly titleLegibility: number;
  readonly edgeLength: number;
  readonly spatialDistribution: number;
  readonly componentSeparation: number;
  readonly bboxArea: number;
};

export type LayoutScoringConfig = {
  // Nominal edge stroke width (px) used to estimate edge "ink" area.
  readonly edgeWidthPx: number;
  // Edge-length goldilocks band, as multiples of the mean endpoint
  // effective-radius, ADDED to the sum of endpoint effective-radii.
  readonly edgeGapMinFactor: number;
  readonly edgeGapMaxFactor: number;
  // Edge-crossing penalty steepness: score = 1 / (1 + k · crossingRate).
  readonly edgeCrossingPenaltyK: number;
  // Spatial-distribution grid: target node count per cell, and the [min,max]
  // clamp on the total cell count the bbox is divided into.
  readonly distributionNodesPerCell: number;
  readonly distributionCellRange: readonly [number, number];
  // Component-separation band, as multiples of the median node extent.
  readonly componentGapBandFactors: readonly [number, number];
  // Ideal packing fraction (sum node area / graph bbox area) for compactness.
  readonly bboxTargetPacking: number;
  readonly weights: PillarWeights;
};

// A null pillar is "not applicable" for this graph (e.g. no edges, no title
// boxes, single component) and is dropped from the composite with its weight.
export type Pillars = {
  readonly nodeOverlap: number;
  readonly edgeCrossing: number;
  readonly titleLegibility: number | null;
  readonly edgeLength: number | null;
  readonly spatialDistribution: number;
  readonly componentSeparation: number | null;
  readonly bboxArea: number;
};

export type RawMetrics = {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly totalNodeArea: number;
  readonly totalOverlapArea: number;
  readonly overlappingPairCount: number;
  readonly edgeCrossingCount: number;
  readonly edgeCrossingRate: number;
  readonly titleCount: number;
  readonly occludedTitleCount: number;
  readonly meanEdgeLength: number;
  readonly inkArea: number;
  readonly graphBboxWidth: number;
  readonly graphBboxHeight: number;
  readonly graphBboxArea: number;
  readonly density: number;
  readonly distributionGiniCoefficient: number;
  readonly distributionGridCols: number;
  readonly distributionGridRows: number;
  readonly componentCount: number;
  readonly componentPairCount: number;
  readonly meanComponentGap: number;
  readonly medianNodeExtent: number;
  readonly idealBboxArea: number;
};

export type LayoutQualityScore = {
  readonly pillars: Pillars;
  readonly composite: number;
  readonly weights: PillarWeights;
  readonly rawMetrics: RawMetrics;
};

// Readability constraints (nodeOverlap+edgeCrossing+titleLegibility = 0.58) are
// weighted heavily as near-hard constraints; the aesthetic/spatial pillars
// (edgeLength+spatialDistribution+componentSeparation+bboxArea = 0.42) shape the
// rest. edgeCrossing (0.10→0.15) and spatialDistribution (0.10→0.12) carry more
// weight than the original rubric because they are the strongest visual quality
// signals — and the old whitespace pillar was saturated at 1.0, contributing
// nothing. Justified in the openspec design.md.
export const DEFAULT_WEIGHTS: PillarWeights = {
  nodeOverlap: 0.25,
  edgeCrossing: 0.15,
  titleLegibility: 0.18,
  edgeLength: 0.12,
  spatialDistribution: 0.12,
  componentSeparation: 0.05,
  bboxArea: 0.13,
};

export const DEFAULT_CONFIG: LayoutScoringConfig = {
  edgeWidthPx: 2,
  edgeGapMinFactor: 0.5,
  edgeGapMaxFactor: 4,
  edgeCrossingPenaltyK: 4,
  distributionNodesPerCell: 4,
  distributionCellRange: [16, 256],
  componentGapBandFactors: [1, 5],
  bboxTargetPacking: 0.20,
  weights: DEFAULT_WEIGHTS,
};
