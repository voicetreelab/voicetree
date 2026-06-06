// Scorecard data shapes + the pure jank-from-frames reduction shared by the
// layout-quality harness. Geometry/perf are EXTRACTED in-page by the spec
// (coupled to Playwright + Cytoscape); everything pure lives here.

import type {
  LayoutEdge,
  LayoutNode,
  LayoutQualityScore,
} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/quality/layoutQualityScore';

export type GraphGeometry = {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
};

// A single renderer-CPU hotspot (self-time) from the layout-window .cpuprofile —
// the actionable "where is this engine spending time" signal.
export type LayoutHotspot = {
  readonly name: string;
  readonly selfPercent: number;
  readonly source: string;
  readonly isAppCode: boolean;
};

// Performance is reported SEPARATELY from the composite quality score (so speed
// vs quality can be traded off later), per the layout-quality openspec.
//
// Derived from a CDP trace + renderer CPU profile captured strictly around the
// layout window ("Tidy layout" click → positions quiesced), reusing the same
// machinery as the 500-node CDP perf suite (cdpTrace + Profiler domain). This
// is renderer-process truth — Blink layout/paint/GC, GPU compositor frames, and
// per-function self-time — not the coarse rAF sampling it replaces.
export type LayoutPerformance = {
  // Wall-clock from triggering "Tidy layout" until positions quiesced
  // (waitForLayoutStable returns) — includes any post-layout finisher settling.
  readonly timeToStableMs: number;
  // CDP-trace span covering the layout window (max−min event ts).
  readonly traceDurationMs: number;
  // Renderer time breakdown over the layout window (from the CDP trace).
  readonly jsExecutionMs: number;
  readonly blinkLayoutMs: number;
  readonly paintMs: number;
  readonly gcMs: number;
  readonly longestTaskMs: number;
  // GPU / compositor over the layout window.
  readonly frameCount: number;
  readonly estimatedFps: number;
  readonly rasterTotalMs: number;
  readonly compositorDrawCount: number;
  readonly longestCompositorFrameMs: number;
  // Top renderer-CPU self-time hotspots (from the .cpuprofile) — where to optimise.
  readonly topHotspots: readonly LayoutHotspot[];
  // Saved artifact paths (chrome://tracing / DevTools / speedscope).
  readonly tracePath: string;
  readonly rendererProfilePath: string;
};

export type EngineScorecard = {
  readonly engine: string;
  // The exact layoutConfig object applied before this run (engine + any
  // SCORECARD_LAYOUT_CONFIG overrides) — identifies the scored (engine, config).
  readonly layoutConfig: Record<string, unknown>;
  readonly vaultPath: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly quality: LayoutQualityScore;
  readonly performance: LayoutPerformance;
  readonly screenshotPath: string;
  readonly capturedAtIso: string;
};
