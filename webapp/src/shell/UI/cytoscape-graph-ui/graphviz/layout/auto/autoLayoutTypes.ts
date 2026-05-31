import type { EdgeSingular } from 'cytoscape';
import { getEdgeDistance } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/viewport/cytoscape-graph-constants';
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings';

export interface AutoLayoutOptions {
  animate?: boolean;
  maxSimulationTime?: number;
  avoidOverlap?: boolean;
  nodeSpacing?: number;
  handleDisconnected?: boolean;
  convergenceThreshold?: number;
  unconstrIter?: number;
  userConstIter?: number;
  allConstIter?: number;
  // Edge length options - different methods of specifying edge length
  edgeLength?: number | ((edge: EdgeSingular) => number);
  edgeSymDiffLength?: number | ((edge: EdgeSingular) => number);
  edgeJaccardLength?: number | ((edge: EdgeSingular) => number);
}

export type LayoutEngine = 'forceatlas2' | 'combocombined' | 'mindmap' | 'webcola';

/**
 * Tuning knobs for the ForceAtlas2 engine, read from the layoutConfig JSON.
 *
 * FA2 lays out dimensionless points: its repulsion `kr` sets the equilibrium
 * edge length as `d ≈ sqrt(kr·(deg_i+1)(deg_j+1))`, so spread grows with the
 * square root of `kr` — reaching an edge length of L needs `kr ≈ L²/(deg+1)²`.
 * `spacing` is the hard minimum gap the post-layout VPSC finisher enforces
 * between node bounding boxes (the only size-aware step in the pipeline).
 */
export interface ForceAtlas2Options {
  /** Repulsion coefficient. Final edge length grows as sqrt(kr). */
  kr: number;
  /** Gravity coefficient pulling nodes toward the layout center; higher = tighter cluster. */
  kg: number;
  /** Per-iteration speed (step-size) multiplier. */
  ks: number;
  /** Iteration cap. 0 = auto by node count (120 below 100 nodes, 250 at or above). */
  maxIteration: number;
  /** Minimum gap (px) between node bounding boxes enforced by the VPSC overlap finisher. */
  spacing: number;
  /**
   * Target median edge length (px). After the simulation settles, the whole
   * point cloud is uniformly scaled about its centroid so the median edge
   * reaches this length — bridging FA2's dimensionless ~`sqrt(kr)`px scale up
   * to the card-relative scale the cards actually occupy. `0` disables scaling
   * (raw FA2 output). Only applied to a fully-free full layout, never to a
   * pinned incremental (local) layout.
   */
  edgeLength: number;
}

export const DEFAULT_FORCEATLAS2_OPTIONS: ForceAtlas2Options = {
  kr: 5,
  kg: 1,
  ks: 0.1,
  maxIteration: 0,
  spacing: 20,
  edgeLength: 0,
};

export interface LayoutConfig {
  engine: LayoutEngine;
  cola: AutoLayoutOptions;
  forceatlas2: ForceAtlas2Options;
}

/**
 * Single source of truth: DEFAULT_SETTINGS.layoutConfig JSON.
 * Parsed once at module load. All layout defaults derive from here.
 */
// layoutConfig is always defined in DEFAULT_SETTINGS — the `?` in VTSettings is for user overrides only
const S: Record<string, unknown> = JSON.parse(DEFAULT_SETTINGS.layoutConfig!) as Record<string, unknown>;

export const DEFAULT_OPTIONS: AutoLayoutOptions = {
  // Runtime-only (not in settings JSON)
  animate: true,
  maxSimulationTime: 1200,
  avoidOverlap: true,
  userConstIter: 15,
  // Derived from settings JSON (source of truth)
  nodeSpacing: S.nodeSpacing as number,
  handleDisconnected: S.handleDisconnected as boolean,
  convergenceThreshold: S.convergenceThreshold as number,
  unconstrIter: S.unconstrIter as number, // TODO SOMETHINIG ABOUT THIS IS VERY IMPORTANT LAYOUT BREAK WITHOUT
  allConstIter: S.allConstIter as number,
  // Per-edge function: 350 for content nodes, 125 for editors.
  // If user sets a static edgeLength number in settings JSON, parseLayoutConfig() uses that instead.
  edgeLength: (edge: EdgeSingular) => getEdgeDistance(edge.target().data('windowType')),
};

export const COLA_FAST_ANIMATE_DURATION: number = 1000;
