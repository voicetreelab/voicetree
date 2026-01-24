/**
 * Cytoscape Floating Window Extension - V2
 *
 * Rewritten to use types.ts with flat types and derived IDs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';
import {getWindowTransform, graphToScreenPosition,} from '@/pure/floatingWindowScaling';
import {
    type EditorId,
    type FloatingWindowData,
    getEditorId,
    getFloatingWindowId,
    getImageViewerId,
    getShadowNodeId,
    getTerminalId,
    isEditorData,
    isImageViewerData,
    type ImageViewerId,
    type ShadowNodeId,
    type TerminalId,
} from '@/shell/edge/UI-edge/floating-windows/types';
import {removeTerminal} from "@/shell/edge/UI-edge/state/TerminalStore";
import {removeEditor} from "@/shell/edge/UI-edge/state/EditorStore";
import {removeImageViewer} from "@/shell/edge/UI-edge/state/ImageViewerStore";
import {updateWindowFromZoom} from "@/shell/edge/UI-edge/floating-windows/update-window-from-zoom";
import {suppressInactivityDuringZoom} from "@/shell/UI/views/AgentTabsBar";

/**
 * Get current zoom level from cytoscape instance
 * Used by terminals to get initial zoom on mount
 */
let cachedZoom: number = 1;
export function getCachedZoom(): number {
    return cachedZoom;
}

// =============================================================================
// Zoom State Tracking
// =============================================================================

let zoomActiveUntil: number = 0;
const ZOOM_ACTIVE_MS: number = 250; // slightly longer than 200ms debounce

/**
 * Check if zoom is currently active (within the debounce window)
 * Used to determine if CSS transform scaling should be applied to terminals
 */
export function isZoomActive(): boolean {
    return Date.now() < zoomActiveUntil;
}

/**
 * Mark zoom as active, extending the active window
 * Called by syncTransform on each zoom event
 */
export function markZoomActive(): void {
    zoomActiveUntil = Date.now() + ZOOM_ACTIVE_MS;
}

// =============================================================================
// Node Selection (shared logic for focus stealing and manual clicks)
// =============================================================================

// =============================================================================
// Cleanup Registry (WeakMap keyed by windowElement)
// =============================================================================

type CleanupFunctions = {
    dragMouseMove: (e: MouseEvent) => void;
    dragMouseUp: () => void;
    resizeObserver?: ResizeObserver;
    parentPositionHandler?: () => void;
};

/**
 * WeakMap to store cleanup functions for each floating window.
 * Keyed by windowElement - when element is GC'd, entry is auto-removed.
 * disposeFloatingWindow looks up and runs these before removing DOM.
 */
export const cleanupRegistry: WeakMap<HTMLElement, CleanupFunctions> = new WeakMap();

// =============================================================================
// Floating Window Registry (Map for O(1) iteration during zoom/pan)
// =============================================================================

/**
 * Map of floating window IDs to their HTMLElements.
 * Maintained on window create/destroy to avoid O(W) DOM queries per frame.
 * Use registerFloatingWindow() after appending to overlay.
 */
const floatingWindowsMap: Map<string, HTMLElement> = new Map();

/**
 * Register a floating window for efficient zoom/pan updates.
 * Call after appending windowElement to overlay.
 */
export function registerFloatingWindow(windowId: string, windowElement: HTMLElement): void {
    floatingWindowsMap.set(windowId, windowElement);
}

/**
 * Unregister a floating window. Called by disposeFloatingWindow and closeSettingsEditor.
 */
export function unregisterFloatingWindow(windowId: string): void {
    floatingWindowsMap.delete(windowId);
}

// =============================================================================
// Overlay Management (unchanged from v1)
// =============================================================================

/**
 * Get or create the shared overlay container for all floating windows
 *
 * NOTE: We no longer use CSS transform: scale(zoom) because xterm.js has a known bug
 * where getBoundingClientRect() returns post-transform coords but terminal internal
 * coords are pre-transform, causing text selection offset issues.
 * Instead, we scale window positions and dimensions explicitly.
 */
export function getOrCreateOverlay(cy: cytoscape.Core): HTMLElement {
    const container: HTMLElement = cy.container() as HTMLElement;
    const parent: HTMLElement | null = container.parentElement;

    if (!parent) {
        throw new Error('Cytoscape container has no parent element');
    }

    let overlay: HTMLElement = parent.querySelector('.cy-floating-overlay') as HTMLElement;

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'cy-floating-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '1000';
        overlay.style.transformOrigin = 'top left';

        parent.appendChild(overlay);

        const syncTransform: () => void = () => {
            const pan: cytoscape.Position = cy.pan();
            const zoom: number = cy.zoom();
            cachedZoom = zoom;

            // Suppress terminal inactivity detection during zoom (resize triggers shell redraws)
            suppressInactivityDuringZoom();

            // Mark zoom as active for CSS transform scaling decisions
            markZoomActive();

            // Only translate, no scale - windows handle their own sizing
            overlay.style.transform = `translate(${pan.x}px, ${pan.y}px)`;

            // Update all floating window positions and sizes (O(W) iteration, O(1) map access)
            floatingWindowsMap.forEach((windowEl: HTMLElement) => {
                updateWindowFromZoom(cy, windowEl, zoom);
            });

            // Update horizontal context menu position (uses CSS transform scaling)
            const menu: HTMLElement | null = overlay.querySelector('.cy-horizontal-context-menu');
            if (menu && menu.dataset.graphX && menu.dataset.graphY) {
                const menuGraphX: number = parseFloat(menu.dataset.graphX);
                const menuGraphY: number = parseFloat(menu.dataset.graphY);
                const menuScreenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({ x: menuGraphX, y: menuGraphY }, zoom);
                menu.style.left = `${menuScreenPos.x}px`;
                menu.style.top = `${menuScreenPos.y}px`;
                menu.style.transform = getWindowTransform('css-transform', zoom, 'center');
            }
        };

        syncTransform();

        // RAF coalescing: ensures at most 1 update per frame even with multiple events
        let rafPending: boolean = false;
        cy.on('pan zoom resize', () => {
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                syncTransform();
            });
        });
    }

    return overlay;
}

// Re-export for backward compatibility (TerminalVanilla imports this)
export { TERMINAL_CSS_TRANSFORM_THRESHOLD } from '@/pure/floatingWindowScaling';


/**
 * Dispose a floating window - remove from DOM and Cytoscape
 * Runs cleanup for event listeners and ResizeObserver before removing
 */
export function disposeFloatingWindow(
    cy: cytoscape.Core,
    fw: FloatingWindowData
): void {
    const fwId: EditorId | TerminalId | ImageViewerId = getFloatingWindowId(fw);
    const shadowNodeId: ShadowNodeId = getShadowNodeId(fwId);

    //console.log('[disposeFloatingWindow-v2] Disposing:', fwId);

    // Remove from floating windows registry (for zoom/pan sync)
    unregisterFloatingWindow(fwId);

    // Run cleanup for event listeners and observers
    if (fw.ui) {
        const cleanup: CleanupFunctions | undefined = cleanupRegistry.get(fw.ui.windowElement);
        if (cleanup) {
            // Remove document-level drag listeners
            document.removeEventListener('mousemove', cleanup.dragMouseMove);
            document.removeEventListener('mouseup', cleanup.dragMouseUp);
            // Disconnect ResizeObserver
            if (cleanup.resizeObserver) {
                cleanup.resizeObserver.disconnect();
            }
            // Remove parent position listener
            if (cleanup.parentPositionHandler) {
                const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
                if (shadowNode.length > 0) {
                    const parentNodeId: string = shadowNode.data('parentNodeId');
                    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
                    if (parentNode.length > 0) {
                        parentNode.off('position', undefined, cleanup.parentPositionHandler);
                    }
                }
            }
            cleanupRegistry.delete(fw.ui.windowElement);
        }
    }

    // Remove shadow node from Cytoscape (this also removes connected edges and position listeners)
    const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
    if (shadowNode.length > 0) {
        shadowNode.remove();
    }

    // Remove DOM elements
    if (fw.ui) {
        fw.ui.windowElement.remove();
    }

    // Remove from state based on type
    if (isEditorData(fw)) {
        removeEditor(getEditorId(fw));
    } else if (isImageViewerData(fw)) {
        removeImageViewer(getImageViewerId(fw));
    } else {
        removeTerminal(getTerminalId(fw));
    }
}

/**
 * Attach close button handler to a floating window
 *
 * Phase 1 refactor: No-op - close button removed from title bar.
 * Traffic lights (including close) will be added to horizontal menu in Phase 2A/3.
 * Keeping function signature for callers; will be reimplemented when traffic lights move to menu.
 */
export function attachCloseHandler(
    _cy: cytoscape.Core,
    fw: FloatingWindowData,
    _additionalCleanup?: () => void
): void {
    if (!fw.ui) {
        throw new Error('FloatingWindowData.ui must be populated before attaching close handler');
    }

    // Phase 1: No close button in UI - traffic lights will be in horizontal menu (Phase 2A/3)
    // This function will be reimplemented when traffic lights are added to the horizontal menu
}
