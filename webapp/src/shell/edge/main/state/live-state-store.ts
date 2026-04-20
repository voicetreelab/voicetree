/**
 * BF-161/BF-L5-205 · live State store (main process).
 *
 * Holds only the main-owned mutable parts of `@vt/graph-state` State:
 * revision, roots, and layout. Renderer-owned `collapseSet` + `selection`
 * are read and mutated through the renderer live-state proxy.
 */
import type {
    Command,
    Delta,
    State,
    StateLayout,
    StateRoots,
} from '@vt/graph-state'
import { applyCommandWithDelta, applyCommandAsyncWithDelta } from '@vt/graph-state'
import { getGraph, getProjectRootWatchedDirectory, getReadPaths, getVaultPaths } from '@vt/graph-model'

import {
    applyRendererLiveCommand,
    isRendererOwnedLiveCommand,
    readRendererLiveState,
} from './renderer-live-state-proxy'

interface MutableLiveParts {
    revision: number
    roots: StateRoots
    layout: StateLayout
}

const liveParts: MutableLiveParts = {
    revision: 0,
    roots: { loaded: new Set(), folderTree: [] },
    layout: { positions: new Map() },
}
let hasExplicitRootState = false

function sameLoadedRoots(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    if (left.size !== right.size) {
        return false
    }

    for (const root of left) {
        if (!right.has(root)) {
            return false
        }
    }

    return true
}

function commitMainOwnedState(state: State): void {
    liveParts.revision = state.meta.revision
    liveParts.roots = state.roots
    liveParts.layout = state.layout
}

async function bootstrapRootsFromProjectConfig(): Promise<void> {
    if (hasExplicitRootState || liveParts.roots.loaded.size > 0) {
        return
    }

    if (!getProjectRootWatchedDirectory()) {
        return
    }

    const loadedRoots = new Set<string>([
        ...(await getReadPaths()),
        ...(await getVaultPaths()),
    ])

    if (loadedRoots.size === 0) {
        return
    }

    liveParts.roots = {
        loaded: loadedRoots,
        folderTree: liveParts.roots.folderTree,
    }
}

export async function getCurrentLiveState(): Promise<State> {
    await bootstrapRootsFromProjectConfig()
    const rendererState: Awaited<ReturnType<typeof readRendererLiveState>> =
        await readRendererLiveState()

    return {
        graph: getGraph(),
        roots: liveParts.roots,
        collapseSet: new Set(rendererState.collapseSet),
        selection: new Set(rendererState.selection),
        layout: liveParts.layout,
        meta: {
            schemaVersion: 1,
            revision: liveParts.revision,
        },
    }
}

export function rootsWereExplicitlySet(): boolean {
    return hasExplicitRootState
}

export function syncWatchedProjectRoot(root: string | null): void {
    if (hasExplicitRootState) {
        return
    }

    const nextLoaded: ReadonlySet<string> = root ? new Set([root]) : new Set()
    if (sameLoadedRoots(liveParts.roots.loaded, nextLoaded)) {
        return
    }

    liveParts.revision += 1
    liveParts.roots = {
        loaded: nextLoaded,
        folderTree: [],
    }
}

export async function applyLiveCommand(cmd: Command): Promise<Delta> {
    const before: State = await getCurrentLiveState()
    const { state, delta }: { state: State; delta: Delta } =
        cmd.type === 'LoadRoot'
            ? await applyCommandAsyncWithDelta(before, cmd)
            : applyCommandWithDelta(before, cmd)

    if (isRendererOwnedLiveCommand(cmd)) {
        await applyRendererLiveCommand(cmd)
    }

    if (cmd.type === 'LoadRoot' || cmd.type === 'UnloadRoot') {
        hasExplicitRootState = true
    }

    commitMainOwnedState(state)
    return delta
}

/** Compatibility wrapper for existing tests/callers. */
export async function applyLiveCommandAsync(cmd: Command): Promise<Delta> {
    return applyLiveCommand(cmd)
}

/** Test-only: reset the store between test cases. */
export function __resetLiveStoreForTests(): void {
    hasExplicitRootState = false
    liveParts.revision = 0
    liveParts.roots = { loaded: new Set(), folderTree: [] }
    liveParts.layout = { positions: new Map() }
}
