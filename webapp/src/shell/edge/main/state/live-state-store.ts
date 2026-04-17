/**
 * BF-161/BF-162 · live State store (main process).
 *
 * Holds the mutable parts of `@vt/graph-state` State (collapseSet, selection,
 * revision) on the main side, so MCP tools `vt_get_live_state` +
 * `vt_dispatch_live_command` can serve a coherent view without an IPC roundtrip.
 *
 * Graph itself is pulled from `@vt/graph-model` graph-store (already main-owned).
 * Renderer state (cytoscape collapsed/selected) is pushed separately via
 * `uiAPI.applyLiveCommand` as a best-effort sync — L2 cleanup collapses stores.
 */
import type {
    Command,
    Delta,
    State,
} from '@vt/graph-state'
import { applyCommandWithDelta, applyCommandAsyncWithDelta } from '@vt/graph-state'
import { getGraph } from '@vt/graph-model'
import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph'

type FolderId = string

interface MutableLiveParts {
    collapseSet: Set<FolderId>
    selection: Set<NodeIdAndFilePath>
    revision: number
}

const liveParts: MutableLiveParts = {
    collapseSet: new Set<FolderId>(),
    selection: new Set<NodeIdAndFilePath>(),
    revision: 0,
}

export function getCurrentLiveState(): State {
    return {
        graph: getGraph(),
        roots: {
            loaded: new Set(),
            folderTree: [],
        },
        collapseSet: new Set(liveParts.collapseSet),
        selection: new Set(liveParts.selection),
        layout: { positions: new Map() },
        meta: {
            schemaVersion: 1,
            revision: liveParts.revision,
        },
    }
}

/**
 * Apply a command to the main-side store and return the resulting Delta.
 *
 * Delegates to `applyCommandWithDelta` (graph-state) for each command. Only
 * commands currently implemented there (Collapse as of BF-144) mutate the
 * store; the others fall through the default branch and return a no-op delta.
 *
 * BF-162: we top-up Expand/Select/Deselect ourselves so the live loop is
 * usable before BF-145/146/147 land. When those merge, applyCommandWithDelta
 * becomes the sole source of truth and the local branches are dead code.
 */
export function applyLiveCommand(cmd: Command): Delta {
    const before: State = getCurrentLiveState()

    // Try the canonical impl first. It throws for commands whose case hasn't
    // been added yet — the local branches below are the fallback for the 3
    // commands (Expand/Select/Deselect) that BF-145/146/147 haven't merged.
    let afterPure: State | null = null
    let deltaPure: Delta | null = null
    try {
        const result: { state: State; delta: Delta } = applyCommandWithDelta(before, cmd)
        afterPure = result.state
        deltaPure = result.delta
    } catch {
        afterPure = null
    }

    if (afterPure && deltaPure && afterPure !== before) {
        liveParts.collapseSet = new Set(afterPure.collapseSet)
        liveParts.selection = new Set(afterPure.selection)
        liveParts.revision = afterPure.meta.revision
        return deltaPure
    }

    switch (cmd.type) {
        case 'Expand': {
            const existed: boolean = liveParts.collapseSet.delete(cmd.folder)
            liveParts.revision += 1
            return {
                revision: liveParts.revision,
                cause: cmd,
                collapseRemoved: existed ? [cmd.folder] : [],
            }
        }
        case 'Select': {
            const additive: boolean = cmd.additive === true
            const nextSelection: Set<NodeIdAndFilePath> = additive
                ? new Set(liveParts.selection)
                : new Set()
            const added: NodeIdAndFilePath[] = []
            const removed: NodeIdAndFilePath[] = additive
                ? []
                : [...liveParts.selection].filter((id) => !cmd.ids.includes(id))
            for (const id of cmd.ids) {
                if (!nextSelection.has(id)) {
                    nextSelection.add(id)
                    added.push(id)
                }
            }
            liveParts.selection = nextSelection
            liveParts.revision += 1
            return {
                revision: liveParts.revision,
                cause: cmd,
                ...(added.length > 0 ? { selectionAdded: added } : {}),
                ...(removed.length > 0 ? { selectionRemoved: removed } : {}),
            }
        }
        case 'Deselect': {
            const removed: NodeIdAndFilePath[] = []
            for (const id of cmd.ids) {
                if (liveParts.selection.delete(id)) {
                    removed.push(id)
                }
            }
            liveParts.revision += 1
            return {
                revision: liveParts.revision,
                cause: cmd,
                ...(removed.length > 0 ? { selectionRemoved: removed } : {}),
            }
        }
        default:
            return deltaPure ?? {
                revision: liveParts.revision,
                cause: cmd,
            }
    }
}

/**
 * L3-BF-186: async dispatcher for commands that require disk I/O (LoadRoot).
 * All other command types go through the sync `applyLiveCommand`.
 */
export async function applyLiveCommandAsync(cmd: Command): Promise<Delta> {
    if (cmd.type !== 'LoadRoot') {
        return applyLiveCommand(cmd)
    }
    const before: State = getCurrentLiveState()
    const { state, delta } = await applyCommandAsyncWithDelta(before, cmd)
    liveParts.collapseSet = new Set(state.collapseSet)
    liveParts.selection = new Set(state.selection)
    liveParts.revision = state.meta.revision
    return delta
}

/** Test-only: reset the store between test cases. */
export function __resetLiveStoreForTests(): void {
    liveParts.collapseSet = new Set()
    liveParts.selection = new Set()
    liveParts.revision = 0
}
