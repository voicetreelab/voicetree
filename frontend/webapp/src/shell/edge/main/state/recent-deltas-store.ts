/**
 * Tracks recent GraphDeltas we wrote to filesystem.
 *
 * Purpose: When we write to filesystem, chokidar fires FS events back at us.
 * We need to ignore these "echo" events to prevent feedback loops.
 *
 * Architecture: Simple module-level state with pure functions.
 * Stores the actual NodeDelta objects (no separate content strings or magic markers).
 *
 * TTL: Entries auto-expire after 300ms (macOS FSEvents typically arrive within 100ms).
 */

import type { NodeDelta, FSEvent, NodeIdAndFilePath } from '@/pure/graph'
import { stripBracketedContent } from '@/pure/graph/contentChangeDetection'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import path from 'path'

const DEFAULT_TTL_MS: number = 300

interface RecentDeltaEntry {
    readonly delta: NodeDelta
    readonly markdownContent: string | null  // null for deletes, full markdown for upserts
    readonly timestamp: number
}

// Module-level state - array per nodeId to handle multiple rapid writes
const recentDeltas: Map<NodeIdAndFilePath, RecentDeltaEntry[]> = new Map()

/**
 * Normalize content for comparison by stripping brackets and whitespace.
 * Handles cases where links may resolve differently between write and read paths.
 */
function normalizeContentRemovingContentInsideWikilinks(content: string): string {
    return stripBracketedContent(content).replace(/\s+/g, '')
}

/**
 * Extract nodeId from an FSEvent's absolute path.
 */
function fsEventToNodeId(fsEvent: FSEvent, watchedDirectory: string): NodeIdAndFilePath {
    const relativePath: string = path.relative(watchedDirectory, fsEvent.absolutePath)
    // Remove .md extension to get nodeId
    return relativePath.replace(/\.md$/, '')
}

/**
 * Mark a delta as recently written.
 * Call this BEFORE writing to filesystem to prevent race conditions.
 */
export function markRecentDelta(delta: NodeDelta): void {
    const nodeId: NodeIdAndFilePath = delta.type === 'UpsertNode'
        ? delta.nodeToUpsert.relativeFilePathIsID
        : delta.nodeId

    // Compute markdown content for upserts (same as what gets written to disk)
    const markdownContent: string | null = delta.type === 'UpsertNode'
        ? fromNodeToMarkdownContent(delta.nodeToUpsert)
        : null

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
    existing.push({ delta, markdownContent, timestamp: now })
    recentDeltas.set(nodeId, existing)
}

/**
 * Check if an FS event corresponds to our own recent write.
 *
 * For upserts: Compares normalized content (strips brackets + whitespace).
 * For deletes: Checks if we have a recent DeleteNode delta for this path.
 *
 * Does NOT consume entries on match - allows multiple FSEvents to match same write
 * (macOS fires 2 events per write: content + mtime).
 *
 * Pure query - does not mutate state. Cleanup happens on write path.
 */
export function isOurRecentDelta(fsEvent: FSEvent, watchedDirectory: string): boolean {
    const nodeId: NodeIdAndFilePath = fsEventToNodeId(fsEvent, watchedDirectory)
    const entries: RecentDeltaEntry[] | undefined = recentDeltas.get(nodeId)

    if (!entries || entries.length === 0) return false

    const now: number = Date.now()

    // Filter to only valid (non-expired) entries
    const validEntries: RecentDeltaEntry[] = entries.filter(e => now - e.timestamp <= DEFAULT_TTL_MS)
    if (validEntries.length === 0) return false

    // Check if this is a delete event
    const isDeleteEvent: boolean = 'type' in fsEvent && fsEvent.type === 'Delete'

    if (isDeleteEvent) {
        // For delete events, check if ANY valid entry is a DeleteNode
        return validEntries.some(e => e.delta.type === 'DeleteNode')
    } else {
        // For upsert events, compare normalized content (full markdown)
        const fsContent: string = 'content' in fsEvent ? fsEvent.content : ''
        const normalizedFsContent: string = normalizeContentRemovingContentInsideWikilinks(fsContent)

        return validEntries.some(e => {
            if (e.delta.type !== 'UpsertNode' || e.markdownContent === null) return false
            // Compare the stored markdown content to the FS content
            return normalizeContentRemovingContentInsideWikilinks(e.markdownContent) === normalizedFsContent
        })
    }
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
