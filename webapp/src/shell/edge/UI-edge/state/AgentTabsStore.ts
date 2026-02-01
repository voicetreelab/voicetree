/**
 * AgentTabsStore - Global UI state for agent tabs bar
 *
 * Manages state that doesn't belong to individual terminals:
 * - activeTerminalId: which terminal is currently selected
 * - displayOrder: user's custom tab ordering
 * - zoomSuppressionUntil: timing state for zoom handling
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

// =============================================================================
// Module-level state
// =============================================================================

let displayOrder: TerminalId[] = [];
let zoomSuppressionUntil: number = 0;

// Duration to suppress terminal data events after zoom (to ignore resize-triggered redraws)
const ZOOM_SUPPRESSION_MS: number = 800;

// =============================================================================
// Display Order
// =============================================================================

export function getDisplayOrder(): TerminalId[] {
    return displayOrder;
}

/**
 * Get display order filtered to only pinned terminals (for keyboard navigation)
 */
export function getPinnedDisplayOrder(terminals: TerminalData[]): TerminalId[] {
    const pinnedIds: Set<TerminalId> = new Set(
        terminals.filter(t => t.isPinned).map(t => getTerminalId(t))
    );
    return displayOrder.filter(id => pinnedIds.has(id));
}

/**
 * Sync displayOrder with actual terminals (handle add/remove)
 * Preserves existing order, removes stale IDs, appends new terminals at end
 */
export function syncDisplayOrder(terminals: TerminalData[]): TerminalId[] {
    const terminalIds: Set<TerminalId> = new Set(terminals.map(t => getTerminalId(t)));

    // Remove stale IDs (terminals that no longer exist)
    const filtered: TerminalId[] = displayOrder.filter(id => terminalIds.has(id));

    // Append new terminals at end
    for (const t of terminals) {
        const id: TerminalId = getTerminalId(t);
        if (!filtered.includes(id)) {
            filtered.push(id);
        }
    }

    displayOrder = filtered;
    return displayOrder;
}

/**
 * Reorder a terminal within the pinned section
 */
export function reorderInDisplayOrder(
    terminals: TerminalData[],
    fromIndex: number,
    toIndex: number
): TerminalId[] {
    const pinnedIds: TerminalId[] = getPinnedDisplayOrder(terminals);

    if (fromIndex < 0 || fromIndex >= pinnedIds.length || toIndex < 0 || toIndex > pinnedIds.length) {
        return displayOrder;
    }

    const [moved] = pinnedIds.splice(fromIndex, 1);
    pinnedIds.splice(toIndex, 0, moved);

    // Rebuild displayOrder: pinned first in new order, then unpinned
    const unpinnedIds: TerminalId[] = displayOrder.filter(id => !pinnedIds.includes(id));
    displayOrder = [...pinnedIds, ...unpinnedIds];

    return displayOrder;
}

// =============================================================================
// Zoom Suppression
// =============================================================================

export function isZoomSuppressed(): boolean {
    return Date.now() < zoomSuppressionUntil;
}

export function suppressInactivityDuringZoom(): void {
    zoomSuppressionUntil = Date.now() + ZOOM_SUPPRESSION_MS;
}

// =============================================================================
// Cleanup
// =============================================================================

export function resetAgentTabsStore(): void {
    displayOrder = [];
    zoomSuppressionUntil = 0;
}
