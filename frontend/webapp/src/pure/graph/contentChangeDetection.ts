/**
 * Pure functions for detecting actual content changes vs link-only changes
 *
 * Used by:
 * - recentNodeHistoryV2 (for tab display)
 * - applyGraphDeltaToUI (for blue breathing animation trigger)
 */

/**
 * Strip all content within square brackets (including the brackets).
 * Removes links like [path.md], [text]*, [[wikilinks]], etc.
 */
export function stripBracketedContent(content: string): string {
    return content.replace(/\[[^\]]*\]/g, '')
}

/**
 * Check if actual content changed, ignoring changes only within square brackets.
 * Returns true if non-bracket content differs.
 */
export function hasActualContentChanged(prev: string, next: string): boolean {
    return stripBracketedContent(prev) !== stripBracketedContent(next)
}
