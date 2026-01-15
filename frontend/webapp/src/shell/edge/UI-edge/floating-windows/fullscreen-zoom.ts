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
import { getResponsivePadding } from '@/utils/responsivePadding';

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
    const currentZoom: number = cy.zoom();

    // Calculate what zoom would be if we fit to this node
    const bb: BoundingBox12 = shadowNode.boundingBox();
    const nodeWidth: number = bb.x2 - bb.x1;
    const nodeHeight: number = bb.y2 - bb.y1;
    const containerWidth: number = cy.width();
    const containerHeight: number = cy.height();
    const padding: number = getResponsivePadding(cy, 2);

    const fitZoomX: number = (containerWidth - 2 * padding) / nodeWidth;
    const fitZoomY: number = (containerHeight - 2 * padding) / nodeHeight;
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
                cy.animate({
                    zoom: storedViewport.zoom,
                    pan: storedViewport.pan,
                    duration: 300
                });
                cleanupWindowState(shadowNodeId);
            } else {
                // No stored state, zoom out 2x
                const newZoom: number = Math.max(cy.minZoom(), cy.zoom() / 2);
                cy.animate({
                    zoom: newZoom,
                    duration: 300
                });
            }
        } else {
            // Not zoomed in → capture state and zoom in to window
            windowViewportStates.set(shadowNodeId, { zoom: cy.zoom(), pan: cy.pan() });
            cy.fit(shadowNode, getResponsivePadding(cy, 2));

            // Add ESC handler only if enabled (terminals yes, editors no due to vim)
            if (enableEscapeKey) {
                const escHandler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        const viewport: PreviousViewport | undefined = windowViewportStates.get(shadowNodeId);
                        if (viewport) {
                            cy.animate({
                                zoom: viewport.zoom,
                                pan: viewport.pan,
                                duration: 300
                            });
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
