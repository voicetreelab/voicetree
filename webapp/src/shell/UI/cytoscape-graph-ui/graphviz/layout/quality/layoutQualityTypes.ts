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
  readonly whitespace: number;
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
  // Whitespace density goldilocks band: ink area / graph bbox area.
  readonly whitespaceDensityBand: readonly [number, number];
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
  readonly whitespace: number;
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

// Overlap/legibility constraints (nodeOverlap+edgeCrossing+titleLegibility=0.60)
// are weighted heavily as near-hard constraints; the goldilocks/aesthetic
// pillars (edgeLength+whitespace+componentSeparation+bboxArea=0.40) shape the
// rest. Justified in the openspec design.md.
export const DEFAULT_WEIGHTS: PillarWeights = {
  nodeOverlap: 0.30,
  edgeCrossing: 0.10,
  titleLegibility: 0.20,
  edgeLength: 0.15,
  whitespace: 0.10,
  componentSeparation: 0.05,
  bboxArea: 0.10,
};

export const DEFAULT_CONFIG: LayoutScoringConfig = {
  edgeWidthPx: 2,
  edgeGapMinFactor: 0.5,
  edgeGapMaxFactor: 4,
  whitespaceDensityBand: [0.08, 0.30],
  componentGapBandFactors: [1, 5],
  bboxTargetPacking: 0.20,
  weights: DEFAULT_WEIGHTS,
};
