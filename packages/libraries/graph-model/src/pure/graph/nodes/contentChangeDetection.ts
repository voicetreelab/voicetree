/**
 * Pure functions for detecting actual content changes vs link-only changes
 *
 * Used by:
 * - recentNodeHistoryV2 (for tab display)
 * - applyGraphDeltaToUI (for blue breathing animation trigger)
 */

/**
 * Strip wikilinks [[...]] and regular links [...] including the brackets.
 */
export function stripBracketedContent(content: string): string {
    const withoutWikilinks: string = content.replace(/\[\[[^\]]*\]\]/g, '')
    const withoutLinks: string = withoutWikilinks.replace(/\[[^\]]*\]/g, '')
    return withoutLinks
}

/**
 * Check if actual content changed, ignoring changes only within square brackets.
 * Returns true if non-bracket content differs.
 */
export function hasActualContentChanged(prev: string, next: string): boolean {
    return stripBracketedContent(prev) !== stripBracketedContent(next)
}

/**
 * Check if newContent is just prevContent with something appended.
 * Used to detect link-only additions that can be merged with unsaved editor changes.
 */
export function isAppendOnly(prev: string, next: string): boolean {
    return next.startsWith(prev) && next.length > prev.length
}

/**
 * Get the appended suffix when isAppendOnly returns true.
 */
export function getAppendedSuffix(prev: string, next: string): string {
    return next.slice(prev.length)
}
