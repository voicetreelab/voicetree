/**
 * Fullscreen Zoom - Shared fullscreen zoom logic for floating windows
 *
 * Provides a common implementation of viewport zoom-to-fit behavior for both
 * terminals and editors. Toggle zooms to shadow node with padding, or restores
 * previous viewport position.
 */

import type { Core, CollectionReturnValue } from 'cytoscape';
import type { ShadowNodeId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getResponsivePadding } from '@/utils/responsivePadding';

// Module-level state for fullscreen zoom restoration (only one window focused at a time)
let previousViewport: { zoom: number; pan: { x: number; y: number } } | null = null;
let fullscreenEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

function cleanupFullscreenState(): void {
    if (fullscreenEscapeHandler) {
        document.removeEventListener('keydown', fullscreenEscapeHandler);
        fullscreenEscapeHandler = null;
    }
    previousViewport = null;
}

/**
 * Attach fullscreen toggle behavior to a floating window's fullscreen button.
 * - Click button: Toggle zoom to fit shadow node with ~10% padding
 * - ESC key: Exit fullscreen (only for terminals, not editors due to vim conflicts)
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

        if (previousViewport) {
            // Restore previous viewport (toggle off)
            cy.animate({
                zoom: previousViewport.zoom,
                pan: previousViewport.pan,
                duration: 300
            });
            cleanupFullscreenState();
        } else {
            // Store current viewport and fit to window
            previousViewport = { zoom: cy.zoom(), pan: cy.pan() };
            cy.fit(shadowNode, getResponsivePadding(cy, 2));

            // Add ESC handler only if enabled (terminals yes, editors no due to vim)
            if (enableEscapeKey) {
                fullscreenEscapeHandler = (e: KeyboardEvent): void => {
                    if (e.key === 'Escape' && previousViewport) {
                        e.preventDefault();
                        e.stopPropagation();
                        cy.animate({
                            zoom: previousViewport.zoom,
                            pan: previousViewport.pan,
                            duration: 300
                        });
                        cleanupFullscreenState();
                    }
                };
                document.addEventListener('keydown', fullscreenEscapeHandler);
            }
        }
    });
}
