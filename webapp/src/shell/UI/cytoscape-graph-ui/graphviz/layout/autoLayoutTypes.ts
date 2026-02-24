import type { EdgeSingular } from 'cytoscape';
import { getEdgeDistance } from './cytoscape-graph-constants';
import { DEFAULT_SETTINGS } from '@/pure/settings';

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

export type LayoutEngine = 'cola';

export interface LayoutConfig {
  engine: LayoutEngine;
  cola: AutoLayoutOptions;
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

export const VALID_ENGINES: readonly LayoutEngine[] = ['cola'] as const;

export const COLA_ANIMATE_DURATION: number = 400;
export const COLA_FAST_ANIMATE_DURATION: number = 200;
