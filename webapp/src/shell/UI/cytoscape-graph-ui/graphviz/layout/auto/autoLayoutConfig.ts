import type { LayoutEngine, LayoutConfig, AutoLayoutOptions } from './autoLayoutTypes';
import { DEFAULT_OPTIONS } from './autoLayoutTypes';

const VALID_ENGINES: readonly LayoutEngine[] = ['forceatlas2', 'webcola'] as const;

/**
 * Parse layoutConfig JSON string into typed layout options.
 * Falls back to cola defaults on any parse error.
 */
export function parseLayoutConfig(json: string | undefined): LayoutConfig {
  const defaults: LayoutConfig = { engine: 'forceatlas2', cola: DEFAULT_OPTIONS };
  if (!json) {
    return defaults;
  }

  try {
    const parsed: Record<string, unknown> = JSON.parse(json) as Record<string, unknown>;
    const parsedEngine: unknown = parsed.engine === 'cola' ? 'webcola' : parsed.engine;
    const engine: LayoutEngine = VALID_ENGINES.includes(parsedEngine as LayoutEngine)
      ? (parsedEngine as LayoutEngine)
      : defaults.engine;

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
