/**
 * Tracks files we recently wrote for FS event acknowledgement.
 *
 * Uses the shared createRecentActionStore factory with:
 * - Built-in normalization (strips brackets + whitespace) for link healing
 * - Delete marker support for distinguishing deletes from upserts
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

import { createRecentActionStore, type RecentActionStore } from '@/pure/utils/recent-action-store'

const DELETED_MARKER: string = '__DELETED__'

// Create the store instance
const fsWriteStore: RecentActionStore = createRecentActionStore()

/**
 * Mark a file as recently written by us.
 * Call this after writing each file to disk.
 *
 * @param filePath - Absolute path to the file
 * @param content - The content that was written
 */
export const markFileWritten: (filePath: string, content: string) => void = (filePath, content) => {
    fsWriteStore.mark(filePath, content)
}

/**
 * Mark a file as recently deleted by us.
 * For deletes, we store a marker (no content to compare).
 *
 * @param filePath - Absolute path to the deleted file
 */
export const markFileDeleted: (filePath: string) => void = (filePath) => {
    fsWriteStore.mark(filePath, DELETED_MARKER)
}

/**
 * Check if an FS event corresponds to our own recent write.
 *
 * For upserts: Uses store's isRecent with built-in normalization.
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
        if (currentContent === undefined) {
            // Delete event - check for delete marker
            return fsWriteStore.isRecent(filePath, DELETED_MARKER)
        } else {
            // Upsert event - use built-in normalization
            // But first ensure we're not matching a delete marker
            const entries: readonly { timestamp: number; content: string }[] | undefined =
                fsWriteStore.getEntriesForKey(filePath)
            if (!entries) return false

            // If only delete markers exist, don't match content
            const now: number = Date.now()
            const hasNonDeleteEntry: boolean = entries.some(e =>
                now - e.timestamp <= 300 && e.content !== DELETED_MARKER
            )
            if (!hasNonDeleteEntry) return false

            return fsWriteStore.isRecent(filePath, currentContent)
        }
    }

/**
 * Clear all recent writes (for testing).
 */
export const clearRecentWrites: () => void = () => {
    fsWriteStore.clear()
}

/**
 * Get count of tracked files (for debugging).
 */
export const getRecentWritesCount: () => number = () => fsWriteStore.getCount()

/**
 * Get all entries for a file path (for debugging).
 */
export const getRecentWritesForPath: (filePath: string) => readonly { timestamp: number; content: string }[] | undefined =
    (filePath) => fsWriteStore.getEntriesForKey(filePath)
