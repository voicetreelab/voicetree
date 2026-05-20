/**
 * Tracks recent GraphDeltas we wrote to filesystem.
 *
 * Purpose: When we write to filesystem, chokidar fires FS events back at us.
 * We need to ignore these "echo" events to prevent feedback loops.
 *
 * Architecture: Simple module-level state with pure functions.
 * Stores only the NodeDelta objects. Comparison uses exact normalized content match.
 *
 * TTL: Entries auto-expire after 10s (generous window to avoid race conditions).
 */

import type { NodeDelta, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { stripBracketedContent } from '@vt/graph-model/graph'

const DEFAULT_TTL_MS: number = 10000

interface RecentDeltaEntry {
    readonly delta: NodeDelta
    readonly timestamp: number
}

type RecentDeltaOptions = {
    readonly now?: number
    readonly ttlMs?: number
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
 * Check if two normalized contents match exactly.
 *
 * O(n) comparison on already-normalized strings — fast enough to run on every
 * FS event. Length-only heuristics false-positive on same-length but totally
 * different content, silently dropping external edits (e.g. an agent's fs
 * write of the same size as the app's last autosave).
 */
function isNormalizedContentMatch(normalizedA: string, normalizedB: string): boolean {
    return normalizedA === normalizedB
}

/**
 * Get nodeId from a NodeDelta.
 */
function getNodeIdFromDelta(delta: NodeDelta): NodeIdAndFilePath {
    return delta.type === 'UpsertNode'
        ? delta.nodeToUpsert.absoluteFilePathIsID
        : delta.nodeId
}

function getTimestamp(options: RecentDeltaOptions | undefined): number {
    return options?.now ?? Date.now()
}

function getTtlMs(options: RecentDeltaOptions | undefined): number {
    return options?.ttlMs ?? DEFAULT_TTL_MS
}

function isEntryWithinTtl(entry: RecentDeltaEntry, now: number, ttlMs: number): boolean {
    return now - entry.timestamp <= ttlMs
}

function filterValidEntries(
    entries: readonly RecentDeltaEntry[],
    now: number,
    ttlMs: number,
): RecentDeltaEntry[] {
    return entries.filter((entry) => isEntryWithinTtl(entry, now, ttlMs))
}

function hasMatchingDelete(entries: readonly RecentDeltaEntry[]): boolean {
    return entries.some((entry) => entry.delta.type === 'DeleteNode')
}

function hasMatchingUpsert(
    entries: readonly RecentDeltaEntry[],
    incomingContent: string,
): boolean {
    const incomingNormalized: string = normalizeContent(incomingContent)

    return entries.some((entry) => {
        if (entry.delta.type !== 'UpsertNode') return false
        const storedNormalized: string = normalizeContent(entry.delta.nodeToUpsert.contentWithoutYamlOrLinks)
        return isNormalizedContentMatch(storedNormalized, incomingNormalized)
    })
}

/**
 * Mark a delta as recently written.
 * Call this only after the filesystem write and in-memory apply both succeed.
 */
export function markRecentDelta(delta: NodeDelta, options?: RecentDeltaOptions): void {
    const nodeId: NodeIdAndFilePath = getNodeIdFromDelta(delta)
    const now: number = getTimestamp(options)
    const ttlMs: number = getTtlMs(options)

    // Clean up all expired entries across all nodeIds
    for (const [key, entries] of recentDeltas) {
        const valid: RecentDeltaEntry[] = filterValidEntries(entries, now, ttlMs)
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
export function isOurRecentDelta(incomingDelta: GraphDelta, options?: RecentDeltaOptions): boolean {
    const now: number = getTimestamp(options)
    const ttlMs: number = getTtlMs(options)

    // Check each NodeDelta in the incoming GraphDelta
    for (const nodeDelta of incomingDelta) {
        const nodeId: NodeIdAndFilePath = getNodeIdFromDelta(nodeDelta)
        const entries: RecentDeltaEntry[] | undefined = recentDeltas.get(nodeId)

        if (!entries || entries.length === 0) {
            // No recent delta for this node - this is an external change
            return false
        }

        // Filter to only valid (non-expired) entries
        const validEntries: RecentDeltaEntry[] = filterValidEntries(entries, now, ttlMs)
        if (validEntries.length === 0) return false

        if (nodeDelta.type === 'DeleteNode') {
            // For delete, check if ANY valid entry is a DeleteNode for this nodeId
            if (!hasMatchingDelete(validEntries)) return false
        } else {
            // For ALL upserts (context nodes and regular): compare normalized content.
            // This ensures external writes with different content are never suppressed,
            // even for context nodes (fixes agent-edit-dropped bug).
            if (!hasMatchingUpsert(validEntries, nodeDelta.nodeToUpsert.contentWithoutYamlOrLinks)) return false
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
