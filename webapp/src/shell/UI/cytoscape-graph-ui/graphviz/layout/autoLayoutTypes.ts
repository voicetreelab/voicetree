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

export interface FcoseLayoutOptions {
  quality: 'default' | 'proof';
  animate: boolean;
  fit: boolean;
  incremental: boolean;
  animationDuration: number;
  numIter: number;
  initialEnergyOnIncremental: number;
  gravity: number;
  gravityRange: number;
  gravityCompound: number;
  gravityRangeCompound: number;
  nestingFactor: number;
  tile: boolean;
  tilingPaddingVertical: number;
  tilingPaddingHorizontal: number;
  nodeRepulsion: number;
  idealEdgeLength: number;
  edgeElasticity: number;
  nodeSpacing: number;
  uniformNodeDimensions: boolean;
  packComponents: boolean;
  coolingFactor: number;
}

export type LayoutEngine = 'cola' | 'fcose';

export interface LayoutConfig {
  engine: LayoutEngine;
  cola: AutoLayoutOptions;
  fcose: FcoseLayoutOptions;
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
  maxSimulationTime: 2000,
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

export const DEFAULT_FCOSE_OPTIONS: FcoseLayoutOptions = {
  quality: (S.quality as 'default' | 'proof') ?? 'default',
  animate: (S.animate as boolean) ?? true,
  fit: (S.fit as boolean) ?? false,
  incremental: (S.incremental as boolean) ?? true,
  animationDuration: (S.animationDuration as number) ?? 1000,
  numIter: (S.numIter as number) ?? 2500,
  initialEnergyOnIncremental: (S.initialEnergyOnIncremental as number) ?? 0.15,
  gravity: (S.gravity as number) ?? 0.02,
  gravityRange: (S.gravityRange as number) ?? 1.5,
  gravityCompound: (S.gravityCompound as number) ?? 1.0,
  gravityRangeCompound: (S.gravityRangeCompound as number) ?? 1.5,
  nestingFactor: (S.nestingFactor as number) ?? 0.1,
  tile: (S.tile as boolean) ?? true,
  tilingPaddingVertical: (S.tilingPaddingVertical as number) ?? 10,
  tilingPaddingHorizontal: (S.tilingPaddingHorizontal as number) ?? 10,
  nodeRepulsion: (S.nodeRepulsion as number) ?? 25000,
  idealEdgeLength: (S.idealEdgeLength as number) ?? 350,
  edgeElasticity: (S.edgeElasticity as number) ?? 0.45,
  nodeSpacing: (S.nodeSpacing as number) ?? 120,
  uniformNodeDimensions: (S.uniformNodeDimensions as boolean) ?? false,
  packComponents: (S.packComponents as boolean) ?? true,
  coolingFactor: (S.coolingFactor as number) ?? 0.3,
};

export const VALID_ENGINES: readonly LayoutEngine[] = ['cola', 'fcose'] as const;

export const COLA_ANIMATE_DURATION: number = 400;
export const COLA_FAST_ANIMATE_DURATION: number = 200;
