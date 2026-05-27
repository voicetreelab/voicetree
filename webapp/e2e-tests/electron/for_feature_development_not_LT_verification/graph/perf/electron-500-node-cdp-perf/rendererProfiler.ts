import type { CDPSession } from '@playwright/test';
import * as fs from 'fs/promises';

export interface RendererProfiler {
  start: () => Promise<void>;
  stop: (options?: { suppressErrors?: boolean }) => Promise<{ profile?: unknown } | undefined>;
}

export function createRendererProfiler(cdp: CDPSession): RendererProfiler {
  let active = false;

  const start = async (): Promise<void> => {
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    active = true;
  };

  const stop = async (
    options?: { suppressErrors?: boolean }
  ): Promise<{ profile?: unknown } | undefined> => {
    if (!active) return undefined;
    active = false;
    try {
      return await cdp.send('Profiler.stop') as { profile?: unknown };
    } catch (error) {
      if (options?.suppressErrors) return undefined;
      throw error;
    }
  };

  return { start, stop };
}

export async function saveJsonProfile(filepath: string, profile: unknown): Promise<{ json: string; sizeKB: string }> {
  const json = JSON.stringify(profile, null, 2);
  await fs.writeFile(filepath, json, 'utf8');
  return {
    json,
    sizeKB: (Buffer.byteLength(json) / 1024).toFixed(0),
  };
}
