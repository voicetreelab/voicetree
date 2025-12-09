/**
 * Factory for creating recent action stores with TTL-based deduplication.
 *
 * Used by:
 * - Main process (recent-writes-store): filters FS events from our own writes
 * - Renderer process (EditorStore): filters editor onChange from setValue calls
 *
 * Both solve the same problem: preventing feedback loops when one layer's
 * change propagates back to it through another layer.
 *
 * Content comparison uses normalization (strip brackets + whitespace) to handle
 * cases where link content may resolve slightly differently between write/read paths.
 */

import { stripBracketedContent } from '@/pure/graph/contentChangeDetection'

export type RecentActionEntry = {
    readonly timestamp: number
    readonly content: string
}

export type RecentActionStore = {
    /**
     * Mark a key as recently actioned with the given content.
     * Call this before/after the action that will trigger events.
     */
    readonly mark: (key: string, content: string) => void

    /**
     * Check if a key+content pair is recent (within TTL window).
     * Uses normalization to compare content (strips brackets + whitespace).
     * @param key - The key (file path or node ID)
     * @param content - The content to check
     * @returns true if this is our recent action (should be skipped)
     */
    readonly isRecent: (key: string, content: string) => boolean

    /**
     * Delete all entries for a specific key.
     */
    readonly deleteKey: (key: string) => void

    /**
     * Clear all entries (for testing).
     */
    readonly clear: () => void

    /**
     * Get count of tracked keys (for debugging).
     */
    readonly getCount: () => number

    /**
     * Get all entries for a key (for debugging).
     */
    readonly getEntriesForKey: (key: string) => readonly RecentActionEntry[] | undefined
}

/**
 * Default TTL window: 300ms
 * - Long enough: FSEvents duplicates typically arrive within 100ms
 * - Short enough: Minimizes race condition window for external edits
 */
const DEFAULT_TTL_MS: number = 300

/**
 * Normalize content for comparison by stripping brackets and whitespace.
 * This handles cases where links/edges may resolve differently between
 * write and read paths.
 */
const normalizeContent: (content: string) => string = (content) =>
    stripBracketedContent(content).replace(/\s+/g, '')

/**
 * Create a new recent action store instance.
 *
 * @param ttlMs - Time window for acknowledging recent actions (default: 300ms)
 * @returns Store with mark, isRecent, and clear functions
 */
export function createRecentActionStore(ttlMs: number = DEFAULT_TTL_MS): RecentActionStore {
    // Array per key handles multiple events for single action (e.g., macOS FSEvents)
    const state: Map<string, RecentActionEntry[]> = new Map()

    const mark: (key: string, content: string) => void = (key, content) => {
        const now: number = Date.now()
        const existing: RecentActionEntry[] = state.get(key) ?? []
        // Keep only non-expired entries + add new one
        const valid: RecentActionEntry[] = existing.filter(e => now - e.timestamp <= ttlMs)
        valid.push({ timestamp: now, content })
        state.set(key, valid)
    }

    const isRecent: (key: string, content: string) => boolean = (key, content) => {
        const entries: RecentActionEntry[] | undefined = state.get(key)
        if (!entries || entries.length === 0) return false

        const now: number = Date.now()

        // Filter to only valid (non-expired) entries
        const validEntries: RecentActionEntry[] = entries.filter(e => now - e.timestamp <= ttlMs)

        // Lazy cleanup
        if (validEntries.length === 0) {
            state.delete(key)
            return false
        }
        if (validEntries.length !== entries.length) {
            state.set(key, validEntries)
        }

        // Check if ANY valid entry matches (using normalization)
        const normalizedContent: string = normalizeContent(content)
        return validEntries.some(e => normalizeContent(e.content) === normalizedContent)
        // NOTE: We do NOT delete on match - let TTL expire entries
        // This handles macOS FSEvents firing multiple events per write
    }

    const deleteKey: (key: string) => void = (key) => {
        state.delete(key)
    }

    const clear: () => void = () => {
        state.clear()
    }

    const getCount: () => number = () => state.size

    const getEntriesForKey: (key: string) => readonly RecentActionEntry[] | undefined = (key) =>
        state.get(key)

    return {
        mark,
        isRecent,
        deleteKey,
        clear,
        getCount,
        getEntriesForKey,
    }
}
