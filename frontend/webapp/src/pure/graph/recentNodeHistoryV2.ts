/**
 * RecentNodeHistoryV2 - Pure functions for tracking recently added/modified nodes
 *
 * Unlike V1 which tracked "visited" nodes (user navigation), V2 tracks
 * nodes that were recently added or modified in the graph (from GraphDelta).
 *
 * Design:
 * - Pure functions only, no side effects
 * - No localStorage persistence (session-only)
 * - State management happens at the shell edge
 * - Stores UpsertNodeDelta directly (FIFO queue, array order = recency)
 */

import type { GraphDelta, UpsertNodeDelta, DeleteNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import { pipe } from 'fp-ts/lib/function.js'

const MAX_RECENT_NODES: number = 5

export type RecentNodeHistory = readonly UpsertNodeDelta[]

/**
 * Extract recently added/modified node entries from a GraphDelta
 *
 * Filters for UpsertNode actions that represent meaningful changes:
 * - New nodes (previousNode is None)
 * - Content-modified nodes (content actually changed significantly)
 *
 * Edge-only changes (same content, different edges) are filtered out
 * to avoid cluttering the recent tabs with non-meaningful updates.
 */
export function extractRecentNodesFromDelta(delta: GraphDelta): readonly UpsertNodeDelta[] {
    return delta.filter((action): action is UpsertNodeDelta => {
        if (action.type !== 'UpsertNode') return false
        // New node: always show
        if (O.isNone(action.previousNode)) return true
        // Update: only show if content changed significantly (150 chars)
        return pipe(
            action.previousNode,
            O.map(prev => prev.contentWithoutYamlOrLinks.length + 75 < action.nodeToUpsert.contentWithoutYamlOrLinks.length),
            O.getOrElse(() => false)
        )
    })
}

/**
 * Add new entries to history, maintaining max size and removing duplicates
 *
 * New entries are added to the front. If a node already exists in history,
 * it's moved to the front with updated data.
 *
 * @param history - Current history state
 * @param newEntries - New entries to add (will be added in order, last entry ends up at front)
 * @returns New history with entries added
 */
export function addEntriesToHistory(
    history: RecentNodeHistory,
    newEntries: readonly UpsertNodeDelta[]
): RecentNodeHistory {
    const result: RecentNodeHistory = newEntries.reduce(
        (acc: RecentNodeHistory, entry: UpsertNodeDelta) => {
            const filtered: RecentNodeHistory = acc.filter(
                e => e.nodeToUpsert.relativeFilePathIsID !== entry.nodeToUpsert.relativeFilePathIsID
            )
            return [entry, ...filtered]
        },
        history
    )

    return result.length > MAX_RECENT_NODES
        ? result.slice(0, MAX_RECENT_NODES)
        : result
}

/**
 * Remove a node from history (e.g., when node is deleted)
 */
export function removeNodeFromHistory(
    history: RecentNodeHistory,
    nodeId: string
): RecentNodeHistory {
    return history.filter(e => e.nodeToUpsert.relativeFilePathIsID !== nodeId)
}

/**
 * Update history from a GraphDelta - combines extraction and addition
 *
 * Also handles deletion: removes any nodes from history that were deleted in the delta.
 */
// todo use the state of deltas
export function updateHistoryFromDelta(
    history: RecentNodeHistory,
    delta: GraphDelta
): RecentNodeHistory {
    // First, remove any deleted nodes from history
    const deletedNodeIds: readonly string[] = delta
        .filter((action): action is DeleteNode => action.type === 'DeleteNode')
        .map(action => action.nodeId)

    const historyWithDeletions: RecentNodeHistory = deletedNodeIds.reduce(
        (acc: RecentNodeHistory, nodeId: string) => removeNodeFromHistory(acc, nodeId),
        history
    )

    // Then, add new nodes
    const newEntries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)
    return addEntriesToHistory(historyWithDeletions, newEntries)
}

/**
 * Create empty history
 */
export function createEmptyHistory(): RecentNodeHistory {
    return []
}
