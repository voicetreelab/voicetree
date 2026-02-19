import cytoscape from 'cytoscape';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - cytoscape-fcose has no bundled types; ambient declaration in utils/types/cytoscape-fcose.d.ts
import fcose from 'cytoscape-fcose';
import type { LayoutEngine, LayoutConfig, AutoLayoutOptions, FcoseLayoutOptions } from './autoLayoutTypes';
import { DEFAULT_OPTIONS, DEFAULT_FCOSE_OPTIONS, VALID_ENGINES } from './autoLayoutTypes';

// Register layout extensions once
let fcoseRegistered: boolean = false;
export function registerFcose(): void {
  if (!fcoseRegistered) {
    cytoscape.use(fcose);
    fcoseRegistered = true;
  }
}

/**
 * Parse layoutConfig JSON string into typed layout options.
 * Falls back to cola defaults on any parse error.
 */
export function parseLayoutConfig(json: string | undefined): LayoutConfig {
  const defaults: LayoutConfig = { engine: 'cola', cola: DEFAULT_OPTIONS, fcose: DEFAULT_FCOSE_OPTIONS };
  if (!json) {
    return defaults;
  }

  try {
    const parsed: Record<string, unknown> = JSON.parse(json) as Record<string, unknown>;
    const engine: LayoutEngine = VALID_ENGINES.includes(parsed.engine as LayoutEngine) ? (parsed.engine as LayoutEngine) : 'cola';

    const cola: AutoLayoutOptions = {
      ...DEFAULT_OPTIONS,
      nodeSpacing: typeof parsed.nodeSpacing === 'number' ? parsed.nodeSpacing : DEFAULT_OPTIONS.nodeSpacing,
      convergenceThreshold: typeof parsed.convergenceThreshold === 'number' ? parsed.convergenceThreshold : DEFAULT_OPTIONS.convergenceThreshold,
      unconstrIter: typeof parsed.unconstrIter === 'number' ? parsed.unconstrIter : DEFAULT_OPTIONS.unconstrIter,
      allConstIter: typeof parsed.allConstIter === 'number' ? parsed.allConstIter : DEFAULT_OPTIONS.allConstIter,
      handleDisconnected: typeof parsed.handleDisconnected === 'boolean' ? parsed.handleDisconnected : DEFAULT_OPTIONS.handleDisconnected,
      edgeLength: typeof parsed.edgeLength === 'number'
        ? parsed.edgeLength
        : DEFAULT_OPTIONS.edgeLength,
    };

    const fcoseOpts: FcoseLayoutOptions = {
      quality: parsed.quality === 'default' || parsed.quality === 'proof' ? parsed.quality : DEFAULT_FCOSE_OPTIONS.quality,
      animate: typeof parsed.animate === 'boolean' ? parsed.animate : DEFAULT_FCOSE_OPTIONS.animate,
      fit: typeof parsed.fit === 'boolean' ? parsed.fit : DEFAULT_FCOSE_OPTIONS.fit,
      incremental: typeof parsed.incremental === 'boolean' ? parsed.incremental : DEFAULT_FCOSE_OPTIONS.incremental,
      animationDuration: typeof parsed.animationDuration === 'number' ? parsed.animationDuration : DEFAULT_FCOSE_OPTIONS.animationDuration,
      numIter: typeof parsed.numIter === 'number' ? parsed.numIter : DEFAULT_FCOSE_OPTIONS.numIter,
      initialEnergyOnIncremental: typeof parsed.initialEnergyOnIncremental === 'number' ? parsed.initialEnergyOnIncremental : DEFAULT_FCOSE_OPTIONS.initialEnergyOnIncremental,
      gravity: typeof parsed.gravity === 'number' ? parsed.gravity : DEFAULT_FCOSE_OPTIONS.gravity,
      gravityRange: typeof parsed.gravityRange === 'number' ? parsed.gravityRange : DEFAULT_FCOSE_OPTIONS.gravityRange,
      gravityCompound: typeof parsed.gravityCompound === 'number' ? parsed.gravityCompound : DEFAULT_FCOSE_OPTIONS.gravityCompound,
      gravityRangeCompound: typeof parsed.gravityRangeCompound === 'number' ? parsed.gravityRangeCompound : DEFAULT_FCOSE_OPTIONS.gravityRangeCompound,
      nestingFactor: typeof parsed.nestingFactor === 'number' ? parsed.nestingFactor : DEFAULT_FCOSE_OPTIONS.nestingFactor,
      tile: typeof parsed.tile === 'boolean' ? parsed.tile : DEFAULT_FCOSE_OPTIONS.tile,
      tilingPaddingVertical: typeof parsed.tilingPaddingVertical === 'number' ? parsed.tilingPaddingVertical : DEFAULT_FCOSE_OPTIONS.tilingPaddingVertical,
      tilingPaddingHorizontal: typeof parsed.tilingPaddingHorizontal === 'number' ? parsed.tilingPaddingHorizontal : DEFAULT_FCOSE_OPTIONS.tilingPaddingHorizontal,
      nodeRepulsion: typeof parsed.nodeRepulsion === 'number' ? parsed.nodeRepulsion : DEFAULT_FCOSE_OPTIONS.nodeRepulsion,
      idealEdgeLength: typeof parsed.idealEdgeLength === 'number' ? parsed.idealEdgeLength : DEFAULT_FCOSE_OPTIONS.idealEdgeLength,
      edgeElasticity: typeof parsed.edgeElasticity === 'number' ? parsed.edgeElasticity : DEFAULT_FCOSE_OPTIONS.edgeElasticity,
      nodeSpacing: typeof parsed.nodeSpacing === 'number' ? parsed.nodeSpacing : DEFAULT_FCOSE_OPTIONS.nodeSpacing,
      uniformNodeDimensions: typeof parsed.uniformNodeDimensions === 'boolean' ? parsed.uniformNodeDimensions : DEFAULT_FCOSE_OPTIONS.uniformNodeDimensions,
      packComponents: typeof parsed.packComponents === 'boolean' ? parsed.packComponents : DEFAULT_FCOSE_OPTIONS.packComponents,
      coolingFactor: typeof parsed.coolingFactor === 'number' ? parsed.coolingFactor : DEFAULT_FCOSE_OPTIONS.coolingFactor,
    };

    return { engine, cola, fcose: fcoseOpts };
  } catch {
    return defaults;
  }
}
