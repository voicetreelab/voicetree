/**
 * RecentlyVisitedStore - Tracks recently visited/selected nodes for command palette ordering
 *
 * In-memory only, resets on app restart.
 * Nodes are stored in MRU (most recently used) order - most recent first.
 */

const MAX_RECENT_NODES: number = 12;

let recentlyVisited: string[] = [];

/**
 * Add a node to the recently visited list.
 * Moves to front if already present, caps at MAX_RECENT_NODES.
 */
export function addRecentlyVisited(nodeId: string): void {
    // Remove if already exists (to move to front)
    recentlyVisited = recentlyVisited.filter((id: string) => id !== nodeId);
    // Add to front
    recentlyVisited.unshift(nodeId);
    // Cap at max
    if (recentlyVisited.length > MAX_RECENT_NODES) {
        recentlyVisited = recentlyVisited.slice(0, MAX_RECENT_NODES);
    }
}

/**
 * Get the list of recently visited node IDs, most recent first.
 */
export function getRecentlyVisited(): string[] {
    return [...recentlyVisited];
}

/**
 * Clear the recently visited list (for testing or reset)
 * @internal
 */
export function clearRecentlyVisited(): void {
    recentlyVisited = [];
}
