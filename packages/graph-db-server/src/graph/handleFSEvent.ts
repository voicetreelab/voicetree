import {access} from 'node:fs/promises'
import path from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import type {FSEvent, GraphDelta, Graph, NodeDelta} from '@vt/graph-model/pure/graph';
import {mapFSEventsToGraphDelta} from '@vt/graph-model/pure/graph';
import {markdownToTitle} from '@vt/graph-model/pure/graph/markdown-parsing/markdown-to-title'
import {getNodeTitle} from '@vt/graph-model/pure/graph/markdown-parsing'
import {getGraph} from "../state/graph-store";
import {getCallbacks} from "@vt/graph-model";
import {getVaultPaths} from '../watch-folder/vault-allowlist'
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "./applyGraphDelta";
import {isOurRecentDelta} from "../state/recent-deltas-store";
import {publish} from "../events/deltaEventBus";

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
        const { deleteNode } = await import('../search/index-backend')
        await deleteNode(vaultPath, fsEvent.absolutePath)
        return
    }

    if (!('content' in fsEvent)) {
        return
    }

    const { upsertNode } = await import('../search/index-backend')
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

    // Publish to SSE event bus for daemon clients
    publish({ delta: mergedDelta, source: 'fs:external' })

    // Broadcast to floating editor state via callback
    getCallbacks().onFloatingEditorUpdate?.(mergedDelta)

    // Register filesystem-written nodes that have agent_name frontmatter,
    // so wait_for_agents recognises them as agent progress.
    notifyAgentNodesFromDelta(mergedDelta)
}

function notifyAgentNodesFromDelta(delta: GraphDelta): void {
    const callback = getCallbacks().onFSNodeWithAgentName
    if (!callback) return

    for (const d of delta) {
        if (d.type !== 'UpsertNode' || O.isSome(d.previousNode)) continue
        const agentName: string | undefined = d.nodeToUpsert.nodeUIMetadata.additionalYAMLProps.get('agent_name')
        if (!agentName) continue
        const title: string = getNodeTitle(d.nodeToUpsert)
        callback(agentName, d.nodeToUpsert.absoluteFilePathIsID, title)
    }
}
