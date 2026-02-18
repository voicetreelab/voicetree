/**
 * Pure functions for agent tabs UI logic
 * No side effects, no DOM, no state
 */

import { formatShortcut } from '@/pure/utils/keyboardShortcutDisplay';

// =============================================================================
// Constants
// =============================================================================

export const TAB_WIDTH_PINNED: number = 90;
export const TAB_WIDTH_UNPINNED: number = 16;
export const INACTIVITY_THRESHOLD_MS: number = 5000;
export const CHECK_INTERVAL_MS: number = 2400;

// =============================================================================
// Shortcut Hint Calculation
// =============================================================================

/**
 * Calculate which shortcut key to show for reaching a tab from the active terminal.
 * Returns '⌘[' if the tab is to the left, '⌘]' if to the right, or null if it's the active tab.
 */
export function getShortcutHintForTab(
    tabIndex: number,
    activeIndex: number,
    totalTabs: number
): string | null {
    if (tabIndex === activeIndex || totalTabs <= 1) {
        return null; // No hint for active tab or single tab
    }

    // Calculate shortest path direction (accounting for wrap-around)
    const leftDistance: number = (activeIndex - tabIndex + totalTabs) % totalTabs;
    const rightDistance: number = (tabIndex - activeIndex + totalTabs) % totalTabs;

    // If distances are equal, prefer right (])
    return leftDistance <= rightDistance ? formatShortcut('[') : formatShortcut(']');
}

// =============================================================================
// Inactivity Calculation
// =============================================================================

/**
 * Check if a terminal should be considered inactive based on last output time
 */
export function isTerminalInactive(
    lastOutputTime: number,
    now: number,
    threshold: number = INACTIVITY_THRESHOLD_MS
): boolean {
    return (now - lastOutputTime) >= threshold;
}

/**
 * Truncate a title for display in a pinned tab
 */
export function truncateTabTitle(title: string, maxLength: number = 12): string {
    return title.length > maxLength ? title.slice(0, maxLength) + '…' : title;
}
