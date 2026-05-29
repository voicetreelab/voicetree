/**
 * Watcher rebuild on folder-visibility and view-switch events.
 *
 * Decision 4: close + re-watch on every state-affecting change. No coalescing.
 *
 * Subscription handles for folder-state and view-switch events live as
 * dedicated fields on the ProjectState singleton; this replaces the two
 * `let unsub*: (() => void) | null` module-mutables that used to live here.
 */

import * as O from 'fp-ts/lib/Option.js'
import type { FilePath } from '@vt/graph-model/graph'
import { getWatcher, setWatcher, getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import {
    getProject,
    mutateProject,
    type ProjectState,
} from '@vt/graph-db-server/application/workflows/state/projectState'
import { onViewSwitched } from './viewsStore'
import { getWatchRootsForActiveView } from '../watch-folder/folder-visibility-active-view'
import { getWriteFolderPath } from '@vt/graph-db-server/state/vaultAllowlist'
import { setupWatcher } from '../watch-folder/watching/file-watcher-setup'
import { createWatcherOptions, DEFAULT_WATCHER_OPTIONS } from '../watch-folder/watching/watcher-options.shared'
import { broadcastVaultState } from '../watch-folder/broadcast/broadcast-vault-state'
import type { WatcherOptions } from '../watch-folder/watching/file-watcher-setup'
import type { FSWatcher } from 'chokidar'

type GraphStateModule = { onFolderStateChanged: (listener: () => void) => () => void }

async function resolveWatcherOptions(): Promise<WatcherOptions> {
    const maybeProcess: { env?: Record<string, string | undefined> } | undefined =
        (globalThis as typeof globalThis & {
            process?: { env?: Record<string, string | undefined> }
        }).process
    if (!maybeProcess?.env) return DEFAULT_WATCHER_OPTIONS
    return createWatcherOptions(
        maybeProcess.env.HEADLESS_TEST === '1' ||
        maybeProcess.env.NODE_ENV === 'test' ||
        maybeProcess.env.NODE_ENV === 'development'
    )
}

async function getVaultPathsForRebuild(projectRoot: FilePath): Promise<readonly string[]> {
    const watchRoots = await getWatchRootsForActiveView(projectRoot)
    let writeFolderPathStr: string | null = null
    try {
        const writeFolderPath = await getWriteFolderPath()
        writeFolderPathStr = O.isSome(writeFolderPath) ? writeFolderPath.value : null
    } catch {
        // getWriteFolderPath may throw when GraphModel config is not initialized (e.g. in tests)
    }
    const paths: string[] = []
    if (writeFolderPathStr) paths.push(writeFolderPathStr)
    for (const root of watchRoots) {
        if (root !== writeFolderPathStr) paths.push(root)
    }
    return paths
}

async function rebuildWatcherForCurrentVault(): Promise<void> {
    const projectRoot: FilePath | null = getProjectRoot()
    if (!projectRoot) return

    const [vaultPaths, watcherOptions] = await Promise.all([
        getVaultPathsForRebuild(projectRoot),
        resolveWatcherOptions(),
    ])

    const oldWatcher: FSWatcher | null = getWatcher()
    if (oldWatcher) {
        await oldWatcher.close()
        setWatcher(null)
    }

    if (vaultPaths.length > 0) {
        await setupWatcher(vaultPaths, projectRoot, watcherOptions)
    }

    void broadcastVaultState()
}

function runUnsubscribes(): void {
    const project = getProject()
    if (project === null) return
    project.folderStateUnsubscribe?.()
    project.viewSwitchedUnsubscribe?.()
    mutateProject((prev: ProjectState): ProjectState => ({
        ...prev,
        folderStateUnsubscribe: null,
        viewSwitchedUnsubscribe: null,
    }))
}

export async function setupStateChangeSubscriptions(_projectRoot: FilePath): Promise<void> {
    runUnsubscribes()

    const graphState = await import('@vt/graph-state') as unknown as GraphStateModule

    const folderStateUnsubscribe = graphState.onFolderStateChanged(() => {
        void rebuildWatcherForCurrentVault()
    })
    const viewSwitchedUnsubscribe = onViewSwitched(() => {
        void rebuildWatcherForCurrentVault()
    })

    mutateProject((prev: ProjectState): ProjectState => ({
        ...prev,
        folderStateUnsubscribe,
        viewSwitchedUnsubscribe,
    }))
}

export function cleanupStateChangeSubscriptions(): void {
    runUnsubscribes()
}
