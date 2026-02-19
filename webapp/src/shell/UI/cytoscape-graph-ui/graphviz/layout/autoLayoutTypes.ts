import type { EdgeSingular } from 'cytoscape';
import { getEdgeDistance } from './cytoscape-graph-constants';

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

export const DEFAULT_OPTIONS: AutoLayoutOptions = {
  animate: true,
  maxSimulationTime: 2000,
  avoidOverlap: true,
  nodeSpacing: 70,
  handleDisconnected: true, // handles disconnected components
  convergenceThreshold: 0.4,
  unconstrIter: 15, // TODO SOMETHINIG ABOUT THIS IS VERY IMPORTANT LAYOUT BREAK WITHOUT
  userConstIter: 15,
  allConstIter: 25,
  edgeLength: (edge: EdgeSingular) => {
    return getEdgeDistance(edge.target().data('windowType'));
  },
  // edgeSymDiffLength: undefined,
  // edgeJaccardLength: undefined
};

export const DEFAULT_FCOSE_OPTIONS: FcoseLayoutOptions = {
  quality: 'default',
  animate: true,
  fit: false,
  incremental: true,
  animationDuration: 1000,
  numIter: 2500,
  initialEnergyOnIncremental: 0.15,
  gravity: 0.02,
  gravityRange: 1.5,
  gravityCompound: 1.0,
  gravityRangeCompound: 1.5,
  nestingFactor: 0.1,
  tile: true,
  tilingPaddingVertical: 10,
  tilingPaddingHorizontal: 10,
  nodeRepulsion: 25000,
  idealEdgeLength: 250,
  edgeElasticity: 0.45,
  nodeSpacing: 70,
  uniformNodeDimensions: false,
  packComponents: true,
  coolingFactor: 0.3,
};

export const VALID_ENGINES: readonly LayoutEngine[] = ['cola', 'fcose'] as const;

export const COLA_ANIMATE_DURATION: number = 400;
export const COLA_FAST_ANIMATE_DURATION: number = 200;
