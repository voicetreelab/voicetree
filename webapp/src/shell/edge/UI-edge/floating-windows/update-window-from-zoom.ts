import type cytoscape from "cytoscape";
import {
    getScalingStrategy,
    getScreenDimensions,
    getTransformOrigin,
    getWindowTransform,
    graphToScreenPosition,
    type ScalingStrategy,
    type TransformOrigin,
    TERMINAL_CSS_TRANSFORM_THRESHOLD
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
 */
export function updateWindowFromZoom(cy: cytoscape.Core, windowElement: HTMLElement, zoom: number): void {
    // During overlay scale, position at refZoom — overlay's scale(zoom/refZoom) compensates.
    // Use actual zoom for strategy/threshold decisions (visual correctness on settle).
    const posZoom: number = getPositioningZoom();

    const baseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
    const baseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');
    const isTerminal: boolean = windowElement.classList.contains('cy-floating-window-terminal');
    const windowType: 'Terminal' | 'Editor' = isTerminal ? 'Terminal' : 'Editor';

    // During active zoom, force CSS transform for terminals to prevent flickering
    // Terminal dimension updates are deferred to handleZoomEnd in TerminalVanilla
    const zoomIsActive: boolean = isZoomActive();
    const strategy: ScalingStrategy = isTerminal && zoomIsActive
        ? 'css-transform'
        : getScalingStrategy(windowType, zoom);

    // Flag terminals that need deferred dimension update after zoom settles
    // Only flag if zoom level is high enough that dimension-scaling would normally be used
    if (isTerminal && zoomIsActive && zoom >= TERMINAL_CSS_TRANSFORM_THRESHOLD) {
        windowElement.dataset.pendingDimensionUpdate = 'true';
    }

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
    windowElement.dataset.usingCssTransform = strategy === 'css-transform' ? 'true' : 'false';

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

    // Update position - look up shadow node or use stored graph position
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
        // Hover editors store their graph position in dataset (no shadow node)
        graphX = parseFloat(windowElement.dataset.graphX);
        graphY = parseFloat(windowElement.dataset.graphY);
    }

    // Apply optional graph-coordinate Y offset (e.g. card shells shift up to sit below labels)
    const graphOffsetY: number = parseFloat(windowElement.dataset.graphOffsetY ?? '0');
    if (graphOffsetY !== 0 && graphY !== undefined) {
        graphY += graphOffsetY;
    }

    // Toggle toolbar visibility based on actual zoom (not posZoom) — visual threshold
    windowElement.classList.toggle('zoom-below-toolbar-threshold', zoom < 0.5);

    if (graphX !== undefined && graphY !== undefined) {
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({
            x: graphX,
            y: graphY
        }, posZoom);
        windowElement.style.left = `${screenPos.x}px`;
        windowElement.style.top = `${screenPos.y}px`;

        // Check for custom transform origin (e.g., hover editors use translateX(-50%) for centering)
        const customOrigin: TransformOrigin = windowElement.dataset.transformOrigin === 'top-center' ? 'top-center' : 'center';
        windowElement.style.transform = getWindowTransform(strategy, posZoom, customOrigin);
        windowElement.style.transformOrigin = getTransformOrigin(customOrigin);
    }
}