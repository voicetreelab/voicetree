import type { WatcherOptions } from './file-watcher-setup';

export const DEFAULT_WATCHER_OPTIONS: WatcherOptions = Object.freeze({
    usePolling: false,
});

export function createWatcherOptions(usePolling: boolean): WatcherOptions {
    return usePolling ? { usePolling: true } : DEFAULT_WATCHER_OPTIONS;
}
