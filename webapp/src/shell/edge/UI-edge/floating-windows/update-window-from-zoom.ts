import type cytoscape from "cytoscape";
import {
    getScreenDimensions,
    getTransformOrigin,
    getWindowTransform,
    graphToScreenPosition,
    type ScalingStrategy,
    type TransformOrigin,
} from "@/pure/graph/floating-windows/floatingWindowScaling";
import { isZoomActive, getPositioningZoom } from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";

/**
 * Update a floating window's scale and position based on zoom level.
 * Called on every zoom change for all floating windows, and by createCardShell
 * for initial positioning of new windows.
 *
 * During overlay scale (active zoom), uses refZoom for positioning/dimensions
 * so the overlay's CSS scale(zoom/refZoom) gives correct visual placement.
 * The `zoom` parameter is still used for strategy decisions and thresholds.
 *
 * NOTE: This function is deferred to zoom-end via the overlay-scale mechanism.
 * During active zoom it does NOT run — the overlay CSS scale(zoom/refZoom) handles visuals.
 * The active strategy is stored on windowElement.dataset.activeStrategy so the
 * ResizeObserver reads the same value (avoiding forward/inverse conversion mismatch).
 */
/** Resolve graph position from shadow node or dataset (local helper) */
function resolveGraphPosition(
    cy: cytoscape.Core,
    windowElement: HTMLElement
): { graphX: number | undefined; graphY: number | undefined } {
    const shadowNodeId: string | undefined = windowElement.dataset.shadowNodeId;
    let graphX: number | undefined;
    let graphY: number | undefined;

    if (shadowNodeId) {
        const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (shadowNode.length > 0) {
            const pos: cytoscape.Position = shadowNode.position();
            graphX = pos.x;
            graphY = pos.y;
        }
    } else if (windowElement.dataset.graphX && windowElement.dataset.graphY) {
        graphX = parseFloat(windowElement.dataset.graphX);
        graphY = parseFloat(windowElement.dataset.graphY);
    }

    return { graphX, graphY };
}

export function updateWindowFromZoom(cy: cytoscape.Core, windowElement: HTMLElement, zoom: number): void {
    // During overlay scale, position at refZoom — overlay's scale(zoom/refZoom) compensates.
    // Use actual zoom for strategy/threshold decisions (visual correctness on settle).
    const posZoom: number = getPositioningZoom();

    const baseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
    const baseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');
    const isTerminal: boolean = windowElement.classList.contains('cy-floating-window-terminal');

    // Resolve graph position (needed for screen positioning below)
    const { graphX, graphY } = resolveGraphPosition(cy, windowElement);

    // During active zoom, force CSS transform for terminals to prevent flickering.
    // Outside zoom, respect the interaction-driven preference stored by pointerdown handler.
    const zoomIsActive: boolean = isZoomActive();
    const interactionStrategy: string | undefined = windowElement.dataset.interactionStrategy;

    const strategy: ScalingStrategy = isTerminal
        ? (zoomIsActive ? 'css-transform'
            : interactionStrategy === 'dimension-scaling' ? 'dimension-scaling'
            : 'css-transform')
        : 'css-transform';

    // Store strategy on DOM so ResizeObserver reads the same value
    windowElement.dataset.activeStrategy = strategy;

    // Apply dimensions based on strategy (using posZoom for overlay-scale correctness)
    const baseDimensions: { readonly width: number; readonly height: number } = {width: baseWidth, height: baseHeight};
    const screenDimensions: {
        readonly width: number;
        readonly height: number
    } = getScreenDimensions(baseDimensions, posZoom, strategy);

    // Debug: warn when computed screen dimensions are unreasonably large
    if (isTerminal && (screenDimensions.width > 10000 || screenDimensions.height > 10000)) {
        console.warn(
            `[updateWindowFromZoom] OVERSIZED terminal dimensions: ${screenDimensions.width.toFixed(0)}×${screenDimensions.height.toFixed(0)}px`,
            {
                baseWidth, baseHeight,
                posZoom, zoom, strategy,
                zoomIsActive,
                shadowNodeId: windowElement.dataset.shadowNodeId,
            }
        );
        console.trace('[updateWindowFromZoom] OVERSIZED stack trace');
    }

    windowElement.style.width = `${screenDimensions.width}px`;
    // Only update height for terminals - editors use auto-height (SetupAutoHeight.ts)
    // which manages height based on content. Resetting height here causes flicker.
    if (isTerminal) {
        windowElement.style.height = `${screenDimensions.height}px`;
    }
    // Scale terminal title bar during dimension-scaling mode
    // In css-transform mode, the whole window scales so title bar scales automatically.
    // In dimension-scaling mode, we scale window dimensions but title bar stays fixed,
    // making it look disproportionately large. Apply CSS transform to title bar to compensate.
    if (isTerminal) {
        const titleBar: HTMLElement | null = windowElement.querySelector('.terminal-title-bar');
        if (titleBar) {
            if (strategy === 'dimension-scaling') {
                const baseHeight: number = 28; // Match CSS min-height
                // Scale uniformly but counter-scale width so title bar spans full window
                // Width: (100/zoom)% * zoom = 100% after transform
                titleBar.style.width = `${100 / posZoom}%`;
                titleBar.style.transform = `scale(${posZoom})`;
                titleBar.style.transformOrigin = 'top left';
                // Compensate for layout gap - element takes baseHeight but visually smaller
                titleBar.style.marginBottom = `${-baseHeight * (1 - posZoom)}px`;
            } else {
                // Reset in css-transform mode (whole window scales)
                titleBar.style.width = '';
                titleBar.style.transform = '';
                titleBar.style.transformOrigin = '';
                titleBar.style.marginBottom = '';
            }
        }
    }

    // Apply optional graph-coordinate Y offset (position already resolved above)
    const graphOffsetY: number = parseFloat(windowElement.dataset.graphOffsetY ?? '0');
    const finalGraphY: number | undefined = graphY !== undefined && graphOffsetY !== 0
        ? graphY + graphOffsetY
        : graphY;

    // Toggle toolbar visibility based on actual zoom (not posZoom) — visual threshold
    windowElement.classList.toggle('zoom-below-toolbar-threshold', zoom < 0.5);

    if (graphX !== undefined && finalGraphY !== undefined) {
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({
            x: graphX,
            y: finalGraphY
        }, posZoom);
        windowElement.style.left = `${screenPos.x}px`;
        windowElement.style.top = `${screenPos.y}px`;

        // Check for custom transform origin (e.g., hover editors use translateX(-50%) for centering)
        const customOrigin: TransformOrigin = windowElement.dataset.transformOrigin === 'top-center' ? 'top-center' : 'center';
        windowElement.style.transform = getWindowTransform(strategy, posZoom, customOrigin);
        windowElement.style.transformOrigin = getTransformOrigin(customOrigin);
    }
}