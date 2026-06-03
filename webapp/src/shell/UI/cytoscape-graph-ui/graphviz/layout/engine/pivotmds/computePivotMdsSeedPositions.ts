import { runPivotMdsWasmProjection } from '@wasm/pivotmds/pivotmds_wasm';

export type PivotMdsAdapterNode = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly fixed: boolean;
};

export type PivotMdsAdapterEdge = {
  readonly source: string;
  readonly target: string;
};

export type PivotMdsAdapterInput = {
  readonly nodes: readonly PivotMdsAdapterNode[];
  readonly edges: readonly PivotMdsAdapterEdge[];
  readonly pivotCount: number;
  readonly edgeLength: number;
};

export type PivotMdsSeedPosition = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
};

/**
 * Computes a deterministic PivotMDS draft layout suitable as a warm-start seed
 * for slower stress solvers. The Rust wasm layer is pure: it only transforms a
 * graph snapshot into positions, leaving Cytoscape mutation to the adapter.
 */
export const computePivotMdsSeedPositions = async (
  input: PivotMdsAdapterInput,
): Promise<readonly PivotMdsSeedPosition[]> => {
  return runPivotMdsWasmProjection(input) as readonly PivotMdsSeedPosition[];
};
