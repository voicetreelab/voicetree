/**
 * Fullscreen Zoom - Shared fullscreen zoom logic for floating windows
 *
 * Provides a common implementation of viewport zoom-to-fit behavior for both
 * terminals and editors. Toggle zooms to shadow node with padding, or restores
 * previous viewport position.
 *
 * Uses per-window state to avoid cross-window bugs: each window tracks its own
 * previous viewport independently.
 */

import type { Core, CollectionReturnValue, BoundingBox12 } from 'cytoscape';
import type { ShadowNodeId } from '@/shell/edge/UI-edge/floating-windows/types';
import { cyFitIntoVisibleViewport, getResponsivePadding } from '@/utils/responsivePadding';
import { getVisibleViewportMetrics, type VisibleViewportMetrics } from '@/utils/visibleViewport';
import { getLayout, dispatchSetZoom, dispatchSetPan } from '@vt/graph-state/state/layoutStore';
import type { StateLayout } from '@vt/graph-state';

// Per-window state for fullscreen zoom restoration
type PreviousViewport = { zoom: number; pan: { x: number; y: number } };
const windowViewportStates: Map<ShadowNodeId, PreviousViewport> = new Map();

// ESC key handlers per window (only for terminals, not editors)
const escapeHandlers: Map<ShadowNodeId, (e: KeyboardEvent) => void> = new Map();

// Threshold for detecting if user is already "zoomed in" on a window (±5%)
// If current zoom is within 5% of fit-zoom, user is considered already fullscreened
const ALREADY_FULLSCREENED_THRESHOLD: number = 1.05;

function cleanupWindowState(shadowNodeId: ShadowNodeId): void {
    const escHandler: ((e: KeyboardEvent) => void) | undefined = escapeHandlers.get(shadowNodeId);
    if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escapeHandlers.delete(shadowNodeId);
    }
    windowViewportStates.delete(shadowNodeId);
}

/**
 * Check if the current viewport is already zoomed in close to a given node.
 * Returns true if fitting to this node would not significantly change the zoom.
 */
function isAlreadyFullscreenedOnNode(cy: Core, shadowNode: CollectionReturnValue): boolean {
    const currentZoom: number = getLayout().zoom ?? 1;

    // Calculate what zoom would be if we fit to this node
    const bb: BoundingBox12 = shadowNode.boundingBox();
    const nodeWidth: number = bb.x2 - bb.x1;
    const nodeHeight: number = bb.y2 - bb.y1;
    const viewport: VisibleViewportMetrics = getVisibleViewportMetrics(cy);
    const padding: number = getResponsivePadding(cy, 3);

    const fitZoomX: number = (viewport.width - 2 * padding) / nodeWidth;
    const fitZoomY: number = (viewport.height - 2 * padding) / nodeHeight;
    const fitZoom: number = Math.min(fitZoomX, fitZoomY);

    // If current zoom is within threshold of fit zoom, we're already fullscreened
    const zoomRatio: number = currentZoom / fitZoom;
    return zoomRatio > (1 / ALREADY_FULLSCREENED_THRESHOLD) && zoomRatio < ALREADY_FULLSCREENED_THRESHOLD;
}

/**
 * Attach fullscreen toggle behavior to a floating window's fullscreen button.
 * - Click button: Toggle zoom to fit shadow node with ~10% padding
 * - ESC key: Exit fullscreen (only for terminals, not editors due to vim conflicts)
 *
 * Per-window state ensures clicking fullscreen on different windows works correctly
 * even if user panned away from a previous fullscreen view.
 *
 * @param cy - Cytoscape instance
 * @param fullscreenButton - The fullscreen button element
 * @param shadowNodeId - The shadow node ID to zoom to
 * @param enableEscapeKey - Whether to enable ESC key to exit (false for editors/vim)
 */
export function attachFullscreenZoom(
    cy: Core,
    fullscreenButton: HTMLButtonElement,
    shadowNodeId: ShadowNodeId,
    enableEscapeKey: boolean
): void {
    fullscreenButton.addEventListener('click', () => {
        const shadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (shadowNode.length === 0) return;

        // Primary decision: are we already zoomed in on this window?
        if (isAlreadyFullscreenedOnNode(cy, shadowNode)) {
            // Already zoomed in → zoom out (restore if we have state, otherwise 2x)
            const storedViewport: PreviousViewport | undefined = windowViewportStates.get(shadowNodeId);
            if (storedViewport) {
                // Set zoom and pan atomically — cy.animate({ zoom, pan }) doesn't
                // correctly restore pan when zoom also changes (zoom around center
                // shifts pan during interpolation).
                dispatchSetZoom(storedViewport.zoom);
                dispatchSetPan(storedViewport.pan);
                cleanupWindowState(shadowNodeId);
            } else {
                // No stored state, zoom out 2x
                // [L2-seam-residual] cy-only: min-zoom bound
                const newZoom: number = Math.max(cy.minZoom(), (getLayout().zoom ?? 1) / 2);
                cy.animate({
                    zoom: newZoom,
                    duration: 300
                });
            }
        } else {
            // Not zoomed in → capture state and zoom in to window
            // Clone pan — getLayout().pan is immutable but spread defensively
            const layout: StateLayout = getLayout();
            windowViewportStates.set(shadowNodeId, { zoom: layout.zoom ?? 1, pan: { ...(layout.pan ?? { x: 0, y: 0 }) } });
            cyFitIntoVisibleViewport(cy, shadowNode, getResponsivePadding(cy, 3));

            // Add ESC handler only if enabled (terminals yes, editors no due to vim)
            if (enableEscapeKey) {
                const escHandler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        const viewport: PreviousViewport | undefined = windowViewportStates.get(shadowNodeId);
                        if (viewport) {
                            dispatchSetZoom(viewport.zoom);
                            dispatchSetPan(viewport.pan);
                        }
                        cleanupWindowState(shadowNodeId);
                    }
                };
                escapeHandlers.set(shadowNodeId, escHandler);
                document.addEventListener('keydown', escHandler);
            }
        }
    });
}
