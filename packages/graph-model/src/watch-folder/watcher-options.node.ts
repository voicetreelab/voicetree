import type { WatcherOptions } from './file-watcher-setup';
import { createWatcherOptions } from './watcher-options.shared';

export function resolveNodeWatcherOptions(env: NodeJS.ProcessEnv = process.env): WatcherOptions {
    return createWatcherOptions(env.HEADLESS_TEST === '1' || env.NODE_ENV === 'test');
}
