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
import { cyFitIntoVisibleViewport, getResponsivePadding, restoreViewportDirectly } from '@/utils/responsivePadding';
import { getVisibleViewportMetrics, getCyViewportState, type VisibleViewportMetrics } from '@/utils/visibleViewport';
import { getLayout, dispatchSetZoom, dispatchSetPan, flushLayout } from '@vt/graph-state/state/layoutStore';
import { MIN_ZOOM } from '@/shell/UI/cytoscape-graph-ui/constants';

// Per-window state for fullscreen zoom restoration — keyed by ShadowNodeId (stable across remounts)
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
 * Compute the zoom level that would result from fitting a node into the visible viewport.
 * Extracted so both the "is already fullscreened?" check and the zoom-in path can share it,
 * and so the zoom-in path can pre-dispatch the value to the layoutStore (cyFitIntoVisibleViewport
 * writes directly to cy, bypassing the store — without this dispatch the store would hold the
 * pre-fullscreen zoom, causing isAlreadyFullscreenedOnNode to mis-classify the next click).
 */
function computeFitZoom(cy: Core, shadowNode: CollectionReturnValue): number {
    const bb: BoundingBox12 = shadowNode.boundingBox();
    const nodeWidth: number = Math.max(bb.x2 - bb.x1, 1);
    const nodeHeight: number = Math.max(bb.y2 - bb.y1, 1);
    const viewport: VisibleViewportMetrics = getVisibleViewportMetrics(cy);
    const padding: number = getResponsivePadding(cy, 3);
    const fitZoomX: number = (viewport.width - 2 * padding) / nodeWidth;
    const fitZoomY: number = (viewport.height - 2 * padding) / nodeHeight;
    return Math.max(MIN_ZOOM, Math.min(fitZoomX, fitZoomY));
}

/**
 * Check if the current viewport is already zoomed in close to a given node.
 * Returns true if fitting to this node would not significantly change the zoom.
 */
function isAlreadyFullscreenedOnNode(cy: Core, shadowNode: CollectionReturnValue): boolean {
    // [L2-seam-residual] cy fallback: layoutStore.zoom is uninitialized until the first user
    // gesture dispatches to it; getCyViewportState reads actual cy zoom as authoritative source.
    const currentZoom: number = getLayout().zoom ?? getCyViewportState(cy).zoom;
    const fitZoom: number = computeFitZoom(cy, shadowNode);
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
 * @param shadowNodeId - Stable per-window ID used as state map key (survives remounts)
 * @param getShadowNode - Lazy getter for the shadow node element (caller provides cy.getElementById)
 * @param enableEscapeKey - Whether to enable ESC key to exit (false for editors/vim)
 */
export function attachFullscreenZoom(
    cy: Core,
    fullscreenButton: HTMLButtonElement,
    shadowNodeId: ShadowNodeId,
    getShadowNode: () => CollectionReturnValue,
    enableEscapeKey: boolean
): void {
    fullscreenButton.addEventListener('click', () => {
        const shadowNode: CollectionReturnValue = getShadowNode();
        if (shadowNode.length === 0) return;

        // Primary decision: are we already zoomed in on this window?
        if (isAlreadyFullscreenedOnNode(cy, shadowNode)) {
            // Already zoomed in → zoom out (restore if we have state, otherwise 2x)
            const storedViewport: PreviousViewport | undefined = windowViewportStates.get(shadowNodeId);
            if (storedViewport) {
                // [L2-seam-residual] restoreViewportDirectly: layoutProjection not yet wired so
                // dispatchSetZoom/Pan alone don't drive cy; direct cy write is needed until
                // mountLayoutProjection is called at app startup (BF-167 follow-on work).
                restoreViewportDirectly(cy, storedViewport.zoom, storedViewport.pan);
                // Also dispatch to keep layoutStore in sync with the restored viewport.
                dispatchSetZoom(storedViewport.zoom);
                dispatchSetPan(storedViewport.pan);
                cleanupWindowState(shadowNodeId);
            } else {
                // No stored state, zoom out 2x
                const newZoom: number = Math.max(MIN_ZOOM, (getLayout().zoom ?? getCyViewportState(cy).zoom) / 2);
                restoreViewportDirectly(cy, newZoom, getCyViewportState(cy).pan);
                dispatchSetZoom(newZoom);
            }
        } else {
            // Not zoomed in → capture current viewport state and zoom in to window.
            // [L2-seam-residual] cy fallback: layoutStore.zoom/pan uninitialized until first gesture;
            // getCyViewportState reads actual cy values as the authoritative pre-fullscreen state.
            const layout = getLayout();
            const savedZoom: number = layout.zoom ?? getCyViewportState(cy).zoom;
            const savedPan: { x: number; y: number } = layout.pan ?? getCyViewportState(cy).pan;
            windowViewportStates.set(shadowNodeId, { zoom: savedZoom, pan: { ...savedPan } });

            // Pre-dispatch fit zoom so layoutStore stays in sync with cy after the fit.
            // cyFitIntoVisibleViewport writes cy directly (bypasses store), so without this
            // the store retains the old zoom and the next click's isAlreadyFullscreenedOnNode
            // check sees a stale value and mis-fires.
            // flushLayout() forces synchronous store update — dispatchSetZoom alone defers
            // via RAF, so getLayout().zoom would still be stale before RAF fires.
            dispatchSetZoom(computeFitZoom(cy, shadowNode));
            flushLayout();

            cyFitIntoVisibleViewport(cy, shadowNode, getResponsivePadding(cy, 3));

            // Add ESC handler only if enabled (terminals yes, editors no due to vim)
            if (enableEscapeKey) {
                const escHandler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        const viewport: PreviousViewport | undefined = windowViewportStates.get(shadowNodeId);
                        if (viewport) {
                            restoreViewportDirectly(cy, viewport.zoom, viewport.pan);
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
