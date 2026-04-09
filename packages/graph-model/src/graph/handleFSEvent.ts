import {access} from 'node:fs/promises'
import path from 'node:path'
import type {FSEvent, GraphDelta, Graph} from '../pure/graph';
import {mapFSEventsToGraphDelta} from '../pure/graph';
import {markdownToTitle} from '../pure/graph/markdown-parsing/markdown-to-title'
import {deleteNode, upsertNode} from '../search/index-backend'
import {getGraph} from "../state/graph-store";
import {getCallbacks} from "../types";
import {getVaultPaths} from '../watch-folder/vault-allowlist'
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "./applyGraphDelta";
import {isOurRecentDelta} from "../state/recent-deltas-store";

const SEARCH_INDEX_PATH_SEGMENTS = ['.vt-search', 'kg.db'] as const

function isMarkdownSearchCandidate(filePath: string): boolean {
    return filePath.endsWith('.md')
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
    const relativePath: string = path.relative(directoryPath, candidatePath)
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

async function resolveOwningVaultPath(filePath: string): Promise<string | undefined> {
    const vaultPaths: readonly string[] = await getVaultPaths()
    const matchingVaultPaths: readonly string[] = vaultPaths
        .filter((vaultPath: string) => isPathInsideDirectory(filePath, vaultPath))
        .sort((left: string, right: string) => right.length - left.length)

    return matchingVaultPaths[0]
}

async function searchIndexExists(vaultPath: string): Promise<boolean> {
    const indexPath: string = path.join(vaultPath, ...SEARCH_INDEX_PATH_SEGMENTS)

    try {
        await access(indexPath)
        return true
    } catch {
        return false
    }
}

async function updateSearchIndexForFSEvent(fsEvent: FSEvent): Promise<void> {
    if (!isMarkdownSearchCandidate(fsEvent.absolutePath)) {
        return
    }

    const vaultPath: string | undefined = await resolveOwningVaultPath(fsEvent.absolutePath)
    if (!vaultPath || !(await searchIndexExists(vaultPath))) {
        return
    }

    if ('type' in fsEvent && fsEvent.type === 'Delete') {
        await deleteNode(vaultPath, fsEvent.absolutePath)
        return
    }

    const title: string = markdownToTitle(fsEvent.content, fsEvent.absolutePath)
    await upsertNode(vaultPath, fsEvent.absolutePath, fsEvent.content, title)
}

/**
 * Handle filesystem events by:
 * 1. Checking if this is our own recent write (skip if so)
 * 2. Computing the GraphDelta from the filesystem event
 * 3. Applying delta to graph state (includes lazy wikilink resolution)
 * 4. Broadcasting to UI (graph UI + floating editors)
 *
 * FS Event Path: FS → MEM + GraphUI + Editors
 *
 * Note: Bulk loads (e.g., adding a new vault path) use loadVaultPathAdditively
 * instead of this function, so no time-based guard is needed here.
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param _watchedDirectory - Unused (node IDs are now absolute paths)
 */
export function handleFSEventWithStateAndUISides(
    fsEvent: FSEvent,
    _watchedDirectory: string,
): void {
    //console.log("[handleFSEvent] external write from: ", fsEvent.absolutePath)

    // 2. Get current graph state to resolve wikilinks
    const currentGraph: Graph = getGraph()

    // 3. Map filesystem event to graph delta (pure) - node IDs are absolute paths
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

    //  Check if this is our own recent write - skip if so
    if (isOurRecentDelta(delta)) {
        //console.log("[handleFSEvent] Skipping our own recent write: ", fsEvent.absolutePath)
        return
    }

    // 4. Apply delta to memory state and resolve any new wikilinks
    // Uses void since this is fire-and-forget from FS event handler
    void applyAndBroadcast(delta, fsEvent)
}

/**
 * Apply delta to memory, broadcast to UI, and handle editor updates.
 * Extracted to allow async/await while keeping the main handler sync.
 */
async function applyAndBroadcast(delta: GraphDelta, fsEvent: FSEvent): Promise<void> {
    const searchIndexUpdate: Promise<void> = updateSearchIndexForFSEvent(fsEvent).catch((error: unknown) => {
        console.error('[handleFSEvent] Failed to update search index:', fsEvent.absolutePath, error)
    })

    // Apply to memory and resolve any new wikilinks (returns merged delta)
    const mergedDelta: GraphDelta = await applyGraphDeltaToMemState(delta)
    await searchIndexUpdate

    // Broadcast merged delta (includes resolved links) to UI
    broadcastGraphDeltaToUI(mergedDelta)

    // Broadcast to floating editor state via callback
    getCallbacks().onFloatingEditorUpdate?.(mergedDelta)
}
