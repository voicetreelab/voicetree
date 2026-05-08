/**
 * Watcher rebuild on folder-visibility and view-switch events.
 *
 * Decision 4: close + re-watch on every state-affecting change. No coalescing.
 */

import * as O from 'fp-ts/lib/Option.js'
import type { FilePath } from '@vt/graph-model/graph'
import { getWatcher, setWatcher, getProjectRootWatchedDirectory } from '../state/watch-folder-store'
import { onViewSwitched } from '../views/viewsStore'
import { getWatchRootsForActiveView } from './folder-visibility-active-view'
import { getWritePath } from './vault-allowlist'
import { setupWatcher } from './file-watcher-setup'
import { createWatcherOptions, DEFAULT_WATCHER_OPTIONS } from './watcher-options.shared'
import { broadcastVaultState } from './broadcast-vault-state'
import type { WatcherOptions } from './file-watcher-setup'
import type { FSWatcher } from 'chokidar'

type GraphStateModule = { onFolderStateChanged: (listener: () => void) => () => void }

let unsubFolderState: (() => void) | null = null
let unsubViewSwitched: (() => void) | null = null

async function resolveWatcherOptions(): Promise<WatcherOptions> {
    const maybeProcess: { env?: Record<string, string | undefined> } | undefined =
        (globalThis as typeof globalThis & {
            process?: { env?: Record<string, string | undefined> }
        }).process
    if (!maybeProcess?.env) return DEFAULT_WATCHER_OPTIONS
    return createWatcherOptions(
        maybeProcess.env.HEADLESS_TEST === '1' || maybeProcess.env.NODE_ENV === 'test'
    )
}

async function getVaultPathsForRebuild(vaultPath: FilePath): Promise<readonly string[]> {
    const watchRoots = await getWatchRootsForActiveView(vaultPath)
    let writePathStr: string | null = null
    try {
        const writePath = await getWritePath()
        writePathStr = O.isSome(writePath) ? writePath.value : null
    } catch {
        // getWritePath may throw when GraphModel config is not initialized (e.g. in tests)
    }
    const paths: string[] = []
    if (writePathStr) paths.push(writePathStr)
    for (const root of watchRoots) {
        if (root !== writePathStr) paths.push(root)
    }
    return paths
}

async function rebuildWatcherForCurrentVault(): Promise<void> {
    const vaultPath: FilePath | null = getProjectRootWatchedDirectory()
    if (!vaultPath) return

    const [vaultPaths, watcherOptions] = await Promise.all([
        getVaultPathsForRebuild(vaultPath),
        resolveWatcherOptions(),
    ])

    const oldWatcher: FSWatcher | null = getWatcher()
    if (oldWatcher) {
        await oldWatcher.close()
        setWatcher(null)
    }

    if (vaultPaths.length > 0) {
        await setupWatcher(vaultPaths, vaultPath, watcherOptions)
    }

    void broadcastVaultState()
}

export async function setupStateChangeSubscriptions(vaultPath: FilePath): Promise<void> {
    unsubFolderState?.()
    unsubViewSwitched?.()

    const graphState = await import('@vt/graph-state') as unknown as GraphStateModule

    unsubFolderState = graphState.onFolderStateChanged(() => {
        void rebuildWatcherForCurrentVault()
    })

    unsubViewSwitched = onViewSwitched(() => {
        void rebuildWatcherForCurrentVault()
    })
}

export function cleanupStateChangeSubscriptions(): void {
    unsubFolderState?.()
    unsubViewSwitched?.()
    unsubFolderState = null
    unsubViewSwitched = null
}
