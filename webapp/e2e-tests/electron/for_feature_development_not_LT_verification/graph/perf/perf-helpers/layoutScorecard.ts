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

// Performance is reported SEPARATELY from the composite quality score (so speed
// vs quality can be traded off later), per the layout-quality openspec.
export type LayoutPerformance = {
  // Engine compute span: first `layoutstart` → last `layoutstop` (perf.now()).
  // Null when no layout events were observed for this engine.
  readonly layoutWallClockMs: number | null;
  // Wall-clock from triggering "Tidy layout" until positions quiesced
  // (waitForLayoutStable returns) — includes any post-layout finisher settling.
  readonly timeToStableMs: number;
  // Frames longer than the jank threshold during the layout window.
  readonly longFrameCount: number;
  readonly avgFps: number;
  readonly sampledFrameCount: number;
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

// A frame longer than this during the layout window counts as jank.
export const LONG_FRAME_MS = 50;

export function framesToJank(frameTimestamps: readonly number[]): {
  longFrameCount: number; avgFps: number; sampledFrameCount: number;
} {
  if (frameTimestamps.length < 2) {
    return { longFrameCount: 0, avgFps: 0, sampledFrameCount: frameTimestamps.length };
  }
  let longFrameCount = 0;
  for (let i = 1; i < frameTimestamps.length; i += 1) {
    if (frameTimestamps[i] - frameTimestamps[i - 1] > LONG_FRAME_MS) longFrameCount += 1;
  }
  const spanMs = frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0];
  const avgFps = spanMs > 0 ? ((frameTimestamps.length - 1) * 1000) / spanMs : 0;
  return { longFrameCount, avgFps, sampledFrameCount: frameTimestamps.length };
}
