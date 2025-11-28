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
 */

import type { GraphDelta } from '@/pure/graph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'

const MAX_RECENT_NODES = 5

export interface RecentNodeEntry {
    readonly nodeId: string
    readonly label: string
    readonly timestamp: number
}

export type RecentNodeHistory = readonly RecentNodeEntry[]

/**
 * Extract recently added/modified node entries from a GraphDelta
 *
 * Filters for UpsertNode actions and converts them to RecentNodeEntry format.
 * Returns entries in the same order as they appear in the delta.
 */
export function extractRecentNodesFromDelta(delta: GraphDelta): readonly RecentNodeEntry[] {
    const timestamp = Date.now()
    return delta
        .filter(action => action.type === 'UpsertNode')
        .map(action => {
            if (action.type !== 'UpsertNode') throw new Error('Unexpected action type')
            return {
                nodeId: action.nodeToUpsert.relativeFilePathIsID,
                label: getNodeTitle(action.nodeToUpsert),
                timestamp
            }
        })
}

/**
 * Add new entries to history, maintaining max size and removing duplicates
 *
 * New entries are added to the front. If a node already exists in history,
 * it's moved to the front with updated label/timestamp.
 *
 * @param history - Current history state
 * @param newEntries - New entries to add (will be added in order, last entry ends up at front)
 * @returns New history with entries added
 */
export function addEntriesToHistory(
    history: RecentNodeHistory,
    newEntries: readonly RecentNodeEntry[]
): RecentNodeHistory {
    // Process entries in order, each one gets added to front
    let result = history

    for (const entry of newEntries) {
        // Remove existing entry with same nodeId (to move to front)
        const filtered = result.filter(e => e.nodeId !== entry.nodeId)
        // Add to front
        result = [entry, ...filtered]
    }

    // Trim to max size
    if (result.length > MAX_RECENT_NODES) {
        result = result.slice(0, MAX_RECENT_NODES)
    }

    return result
}

/**
 * Remove a node from history (e.g., when node is deleted)
 */
export function removeNodeFromHistory(
    history: RecentNodeHistory,
    nodeId: string
): RecentNodeHistory {
    return history.filter(e => e.nodeId !== nodeId)
}

/**
 * Update history from a GraphDelta - combines extraction and addition
 *
 * Also handles deletion: removes any nodes from history that were deleted in the delta.
 */
export function updateHistoryFromDelta(
    history: RecentNodeHistory,
    delta: GraphDelta
): RecentNodeHistory {
    // First, remove any deleted nodes from history
    const deletedNodeIds = delta
        .filter(action => action.type === 'DeleteNode')
        .map(action => {
            if (action.type !== 'DeleteNode') throw new Error('Unexpected action type')
            return action.nodeId
        })

    let updatedHistory = history
    for (const nodeId of deletedNodeIds) {
        updatedHistory = removeNodeFromHistory(updatedHistory, nodeId)
    }

    // Then, add upserted nodes
    const newEntries = extractRecentNodesFromDelta(delta)
    return addEntriesToHistory(updatedHistory, newEntries)
}

/**
 * Create empty history
 */
export function createEmptyHistory(): RecentNodeHistory {
    return []
}
