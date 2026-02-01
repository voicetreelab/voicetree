/**
 * Edge module for terminal zoom settle handling.
 *
 * Handles window chrome updates when transitioning from CSS-transform mode
 * (used during zoom) to dimension-scaling mode (used when zoom >= 0.5).
 *
 * Terminal fitting (fontSize + fit + scroll) is NOT handled here - the
 * dimension change triggers a ResizeObserver which handles terminal fitting.
 */

import { getCachedZoom, onZoomEnd } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import {
    getScalingStrategy,
    getScreenDimensions,
    getWindowTransform,
    type ScalingStrategy,
} from '@/pure/graph/floating-windows/floatingWindowScaling';

/**
 * Apply window chrome updates after zoom settles.
 *
 * Transitions window from CSS-transform mode to dimension-scaling mode.
 * Only updates window chrome (dimensions, transform, title bar).
 * Terminal fitting is handled by ResizeObserver (triggered by dimension change).
 */
export function applyWindowChromeUpdate(windowElement: HTMLElement): void {
    const zoom: number = getCachedZoom();
    const strategy: ScalingStrategy = getScalingStrategy('Terminal', zoom);

    // Only apply if we should be in dimension-scaling mode
    if (strategy !== 'dimension-scaling') return;

    // 1. Update window container dimensions (switch from CSS-transform to dimension-scaling)
    const baseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
    const baseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');
    const screenDimensions: { readonly width: number; readonly height: number } = getScreenDimensions(
        { width: baseWidth, height: baseHeight },
        zoom,
        strategy
    );
    windowElement.style.width = `${screenDimensions.width}px`;
    windowElement.style.height = `${screenDimensions.height}px`;
    windowElement.dataset.usingCssTransform = 'false';

    // 2. Update window transform (remove CSS scale, keep centering)
    windowElement.style.transform = getWindowTransform(strategy, zoom, 'center');

    // 3. Update title bar compensation for dimension-scaling mode
    updateTitleBarCompensation(windowElement, zoom);

    // Dimension change triggers ResizeObserver which handles terminal fitting
}

/**
 * Update title bar styling for dimension-scaling mode.
 * In dimension-scaling mode, the title bar needs CSS compensation
 * to appear at the correct size relative to the scaled window.
 */
function updateTitleBarCompensation(windowElement: HTMLElement, zoom: number): void {
    const titleBar: HTMLElement | null = windowElement.querySelector('.terminal-title-bar');
    if (!titleBar) return;

    const titleBarBaseHeight: number = 28;
    titleBar.style.width = `${100 / zoom}%`;
    titleBar.style.transform = `scale(${zoom})`;
    titleBar.style.transformOrigin = 'top left';
    titleBar.style.marginBottom = `${-titleBarBaseHeight * (1 - zoom)}px`;
}

// /** Delay for second zoom settle update (100ms + 450ms = 550ms total after zoom ends) */
// const SECOND_SETTLE_DELAY_MS: number = 450;

/**
 * Set up zoom settle handling for a terminal window.
 *
 * Subscribes to zoom-end events and applies window chrome updates
 * when the terminal has a pending update flag.
 *
 * Update is applied once, 100ms after zoom ends.
 * (Second 450ms timer removed - font size is now always base 8px so rounding drift no longer occurs)
 *
 * @param container - The terminal container element
 * @returns Unsubscribe function for cleanup
 */
export function setupTerminalZoomSettleHandler(container: HTMLElement): () => void {
    // let secondSettleTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = onZoomEnd(() => {
        const windowElement: HTMLElement | null = container.closest('.cy-floating-window') as HTMLElement | null;
        if (!windowElement || windowElement.dataset.pendingDimensionUpdate !== 'true') return;

        // Clear the pending flag
        delete windowElement.dataset.pendingDimensionUpdate;

        // Apply window chrome update (100ms after zoom ends)
        applyWindowChromeUpdate(windowElement);

        // // Cancel any pending second update
        // if (secondSettleTimeoutId !== null) {
        //     clearTimeout(secondSettleTimeoutId);
        // }

        // // Second update: apply at 550ms total (450ms after first)
        // // This ensures the terminal is properly settled even if font scaling caused minor drift
        // secondSettleTimeoutId = setTimeout(() => {
        //     secondSettleTimeoutId = null;
        //     applyWindowChromeUpdate(windowElement);
        // }, SECOND_SETTLE_DELAY_MS);
    });

    // Return cleanup function
    return () => {
        unsubscribe();
        // if (secondSettleTimeoutId !== null) {
        //     clearTimeout(secondSettleTimeoutId);
        //     secondSettleTimeoutId = null;
        // }
    };
}
