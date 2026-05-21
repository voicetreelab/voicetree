import type { LayoutEngine, LayoutConfig, AutoLayoutOptions } from './autoLayoutTypes';
import { DEFAULT_OPTIONS, VALID_ENGINES } from './autoLayoutTypes';

/**
 * Parse layoutConfig JSON string into typed layout options.
 * Falls back to cola defaults on any parse error.
 */
export function parseLayoutConfig(json: string | undefined): LayoutConfig {
  const defaults: LayoutConfig = { engine: 'cola', cola: DEFAULT_OPTIONS };
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

    return { engine, cola };
  } catch {
    return defaults;
  }
}
