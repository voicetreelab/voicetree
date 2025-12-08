/**
 * Tracks files we recently wrote for FS event acknowledgement.
 *
 * Addresses:
 * 1. Granularity mismatch: Write path batches N ops into one delta, read path
 *    gets N separate FS events. Now tracked per-file.
 * 2. FSEvents duplicates: macOS fires 2 events per write (content + mtime).
 *    Array structure + TTL handles this (no consume on match).
 * 3. Edge healing timing: Read path computed different edges than write path.
 *    Content comparison uses normalization to handle this.
 * 4. Self-cleaning: TTL-based expiration prevents stale accumulation.
 */

import { stripBracketedContent } from '@/pure/graph/contentChangeDetection'

type RecentWriteEntry = {
    readonly timestamp: number
    readonly content: string // Full content for debugging, normalized for comparison
}

// Array per path to handle multiple FSEvents for single write
const recentWrites: Map<string, RecentWriteEntry[]> = new Map()

/**
 * Time window for acknowledging FS events as our own writes.
 * 300ms balances:
 * - Long enough: FSEvents duplicates typically arrive within 100ms
 * - Short enough: Minimizes race condition window for external edits
 */
const ACK_WINDOW_MS: number = 300

/**
 * Strip whitespace (spaces, newlines, tabs) from a string.
 */
const stripWhitespace: (str: string) => string = (str) => str.replace(/\s+/g, '')

/**
 * Normalize content for comparison by stripping brackets and whitespace.
 * This handles cases where links/edges may resolve differently between
 * write and read paths.
 */
const normalizeForCompare: (content: string) => string = (content) =>
    stripWhitespace(stripBracketedContent(content))

const DELETED_MARKER: string = '__DELETED__'

/**
 * Mark a file as recently written by us.
 * Call this after writing each file to disk.
 *
 * @param filePath - Absolute path to the file
 * @param content - The content that was written
 */
export const markFileWritten: (filePath: string, content: string) => void = (filePath, content) => {
    const now: number = Date.now()
    const existing: RecentWriteEntry[] = recentWrites.get(filePath) ?? []
    // Keep only non-expired entries + add new one
    const valid: RecentWriteEntry[] = existing.filter(e => now - e.timestamp <= ACK_WINDOW_MS)
    valid.push({ timestamp: now, content })
    recentWrites.set(filePath, valid)
}

/**
 * Mark a file as recently deleted by us.
 * For deletes, we store a marker (no content to compare).
 *
 * @param filePath - Absolute path to the deleted file
 */
export const markFileDeleted: (filePath: string) => void = (filePath) => {
    const now: number = Date.now()
    const existing: RecentWriteEntry[] = recentWrites.get(filePath) ?? []
    const valid: RecentWriteEntry[] = existing.filter(e => now - e.timestamp <= ACK_WINDOW_MS)
    valid.push({ timestamp: now, content: DELETED_MARKER })
    recentWrites.set(filePath, valid)
}

/**
 * Check if an FS event corresponds to our own recent write.
 *
 * For upserts: Checks if ANY entry within time window has matching content.
 * For deletes: Checks if ANY entry within time window is a delete marker.
 *
 * Does NOT consume entries on match - allows multiple FSEvents to match same write.
 *
 * @param filePath - Absolute path from FS event
 * @param currentContent - Content from FS event (undefined for deletes)
 * @returns true if this is our own write and should be skipped
 */
export const isOurRecentWrite: (filePath: string, currentContent: string | undefined) => boolean =
    (filePath, currentContent) => {
        const entries: RecentWriteEntry[] | undefined = recentWrites.get(filePath)
        if (!entries || entries.length === 0) return false

        const now: number = Date.now()

        // Filter to only valid (non-expired) entries
        const validEntries: RecentWriteEntry[] = entries.filter(e => now - e.timestamp <= ACK_WINDOW_MS)

        // Update map with only valid entries (lazy cleanup)
        if (validEntries.length === 0) {
            recentWrites.delete(filePath)
            return false
        }
        if (validEntries.length !== entries.length) {
            recentWrites.set(filePath, validEntries)
        }

        // Check if ANY valid entry matches
        if (currentContent === undefined) {
            // Delete event - check if any entry is a delete marker
            return validEntries.some(e => e.content === DELETED_MARKER)
        } else {
            // Upsert event - check if any entry's normalized content matches
            const normalizedCurrent: string = normalizeForCompare(currentContent)
            return validEntries.some(e =>
                e.content !== DELETED_MARKER &&
                normalizeForCompare(e.content) === normalizedCurrent
            )
        }
        // NOTE: We do NOT delete on match - let TTL expire entries
        // This handles macOS FSEvents firing 2 events per write
    }

/**
 * Clear all recent writes (for testing).
 */
export const clearRecentWrites: () => void = () => {
    recentWrites.clear()
}

/**
 * Get count of tracked files (for debugging).
 */
export const getRecentWritesCount: () => number = () => recentWrites.size

/**
 * Get all entries for a file path (for debugging).
 */
export const getRecentWritesForPath: (filePath: string) => RecentWriteEntry[] | undefined =
    (filePath) => recentWrites.get(filePath)
