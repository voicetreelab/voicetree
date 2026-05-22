/**
 * AgentTabsStore - Global UI state for agent tabs bar
 *
 * Manages state that doesn't belong to individual terminals:
 * - activeTerminalId: which terminal is currently selected
 * - displayOrder: user's custom tab ordering
 * - zoomSuppressionUntil: timing state for zoom handling
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
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
