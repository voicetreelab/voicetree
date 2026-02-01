/**
 * Trackpad gesture state - DEPRECATED
 *
 * This module is kept as a stub for backwards compatibility with main.ts gesture detection.
 * The gesture detection is unreliable (fires for mouse wheel too) so NavigationGestureService
 * now uses heuristic-based trackpad detection instead.
 *
 * These functions are no-ops - they're called by main.ts but the values are no longer used.
 */

/**
 * @deprecated No longer used - heuristic detection replaced this
 */
export function getIsTrackpadScrolling(): boolean {
    return false;
}

/**
 * @deprecated No longer used - main.ts still calls this but it's a no-op
 */
export function setIsTrackpadScrolling(_value: boolean): void {
    // No-op: gesture detection is unreliable, using heuristics instead
}
