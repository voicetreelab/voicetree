/**
 * Tracks recent GraphDeltas we wrote to filesystem.
 *
 * Purpose: When we write to filesystem, chokidar fires FS events back at us.
 * We need to ignore these "echo" events to prevent feedback loops.
 *
 * Architecture: Simple module-level state with pure functions.
 * Stores only the NodeDelta objects. Comparison uses delta.nodeToUpsert.contentWithoutYamlOrLinks.
 *
 * TTL: Entries auto-expire after 300ms (macOS FSEvents typically arrive within 100ms).
 */

import type { NodeDelta, GraphDelta, NodeIdAndFilePath } from '@/pure/graph'
import { stripBracketedContent } from '@/pure/graph/contentChangeDetection'

const DEFAULT_TTL_MS: number = 300

interface RecentDeltaEntry {
    readonly delta: NodeDelta
    readonly timestamp: number
}

// Module-level state - array per nodeId to handle multiple rapid writes
const recentDeltas: Map<NodeIdAndFilePath, RecentDeltaEntry[]> = new Map()

/**
 * Normalize content for comparison by stripping brackets and whitespace.
 * Handles cases where links may resolve differently between write and read paths.
 */
function normalizeContent(content: string): string {
    return stripBracketedContent(content).replace(/\s+/g, '')
}

/**
 * Get nodeId from a NodeDelta.
 */
function getNodeIdFromDelta(delta: NodeDelta): NodeIdAndFilePath {
    return delta.type === 'UpsertNode'
        ? delta.nodeToUpsert.relativeFilePathIsID
        : delta.nodeId
}

/**
 * Mark a delta as recently written.
 * Call this BEFORE writing to filesystem to prevent race conditions.
 */
export function markRecentDelta(delta: NodeDelta): void {
    const nodeId: NodeIdAndFilePath = getNodeIdFromDelta(delta)
    const now: number = Date.now()

    // Clean up all expired entries across all nodeIds
    for (const [key, entries] of recentDeltas) {
        const valid: RecentDeltaEntry[] = entries.filter(e => now - e.timestamp <= DEFAULT_TTL_MS)
        if (valid.length === 0) {
            recentDeltas.delete(key)
        } else if (valid.length !== entries.length) {
            recentDeltas.set(key, valid)
        }
    }

    // Add new entry for this nodeId
    const existing: RecentDeltaEntry[] = recentDeltas.get(nodeId) ?? []
    existing.push({ delta, timestamp: now })
    recentDeltas.set(nodeId, existing)
}

/**
 * Check if an incoming GraphDelta matches our own recent write.
 *
 * For upserts: Compares normalized contentWithoutYamlOrLinks (strips brackets + whitespace).
 * For deletes: Checks if we have a recent DeleteNode delta for this path.
 *
 * Does NOT consume entries on match - allows multiple FSEvents to match same write
 * (macOS fires 2 events per write: content + mtime).
 *
 * Pure query - does not mutate state. Cleanup happens on write path.
 */
export function isOurRecentDelta(incomingDelta: GraphDelta): boolean {
    const now: number = Date.now()

    // Check each NodeDelta in the incoming GraphDelta
    for (const nodeDelta of incomingDelta) {
        const nodeId: NodeIdAndFilePath = getNodeIdFromDelta(nodeDelta)
        const entries: RecentDeltaEntry[] | undefined = recentDeltas.get(nodeId)

        if (!entries || entries.length === 0) {
            // No recent delta for this node - this is an external change
            return false
        }

        // Filter to only valid (non-expired) entries
        const validEntries: RecentDeltaEntry[] = entries.filter(e => now - e.timestamp <= DEFAULT_TTL_MS)
        if (validEntries.length === 0) return false

        if (nodeDelta.type === 'DeleteNode') {
            // For delete, check if ANY valid entry is a DeleteNode for this nodeId
            const hasMatchingDelete: boolean = validEntries.some(e => e.delta.type === 'DeleteNode')
            if (!hasMatchingDelete) return false
        } else {
            // For upsert, compare normalized contentWithoutYamlOrLinks
            const incomingContent: string = normalizeContent(nodeDelta.nodeToUpsert.contentWithoutYamlOrLinks)

            const hasMatchingUpsert: boolean = validEntries.some(e => {
                if (e.delta.type !== 'UpsertNode') return false
                const storedContent: string = normalizeContent(e.delta.nodeToUpsert.contentWithoutYamlOrLinks)
                return storedContent === incomingContent
            })
            if (!hasMatchingUpsert) return false
        }
    }

    // All deltas in incoming GraphDelta matched our recent writes
    return true
}

/**
 * Clear all entries (for testing).
 */
export function clearRecentDeltas(): void {
    recentDeltas.clear()
}

/**
 * Get count of tracked nodeIds (for debugging).
 */
export function getRecentDeltasCount(): number {
    return recentDeltas.size
}

/**
 * Get all entries for a nodeId (for debugging/testing).
 */
export function getRecentDeltasForNodeId(nodeId: NodeIdAndFilePath): readonly RecentDeltaEntry[] | undefined {
    return recentDeltas.get(nodeId)
}
