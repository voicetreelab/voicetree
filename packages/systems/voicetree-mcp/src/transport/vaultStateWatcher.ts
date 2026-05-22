// Chokidar watcher dedicated to publishing vault-state events on the
// daemon's subscription hub. Owned by the HTTP daemon — separate from
// graph-db-server's internal watcher, which mutates the graph and (in
// Electron mode) lives in a different process anyway.
//
// Coalescing follows graph-db-server's `daemonWatcher.ts` so file-event
// semantics are aligned (file-added/file-changed/file-removed map cleanly
// from add/change/unlink). The hub takes ownership of fan-out and ordering;
// this module is just the OS-event-to-topic adapter.

import chokidar, {type FSWatcher} from 'chokidar'

import type {EventSubscriptionHub} from './eventSubscriptionHub.ts'

export interface VaultStateWatcherHandle {
    readonly stop: () => Promise<void>
}

export interface StartVaultStateWatcherOptions {
    readonly vaultPath: string
    readonly hub: EventSubscriptionHub
    readonly usePolling?: boolean
}

function isMarkdown(path: string): boolean {
    return path.endsWith('.md')
}

export function startVaultStateWatcher(options: StartVaultStateWatcherOptions): VaultStateWatcherHandle {
    const usePolling: boolean = options.usePolling
        ?? (process.env.HEADLESS_TEST === '1' || process.env.NODE_ENV === 'test')

    const watcher: FSWatcher = chokidar.watch(options.vaultPath, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 99,
        ignored: (filePath: string): boolean => {
            // Only publish vault-state for markdown files; the renderer's
            // graph model doesn't care about anything else and Step 9e will
            // tighten this further if needed.
            return filePath !== options.vaultPath && !isMarkdown(filePath) && !filePath.endsWith('/')
        },
        awaitWriteFinish: {stabilityThreshold: 100, pollInterval: 50},
        usePolling,
        interval: usePolling ? 100 : undefined,
    })

    watcher.on('add', (path: string): void => {
        options.hub.publish('vault-state', 'file-added', {path})
    })
    watcher.on('change', (path: string): void => {
        options.hub.publish('vault-state', 'file-changed', {path})
    })
    watcher.on('unlink', (path: string): void => {
        options.hub.publish('vault-state', 'file-removed', {path})
    })

    return {
        stop: async (): Promise<void> => { await watcher.close() },
    }
}
