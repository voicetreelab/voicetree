import type cytoscape from "cytoscape";
import {
    getScalingStrategy,
    getScreenDimensions,
    getTransformOrigin,
    getWindowTransform,
    graphToScreenPosition,
    type ScalingStrategy,
    type TransformOrigin
} from "@/pure/floatingWindowScaling";

/**
 * Update a floating window's scale and position based on zoom level
 * Called on every zoom change for all floating windows
 */
export function updateWindowFromZoom(cy: cytoscape.Core, windowElement: HTMLElement, zoom: number): void {
    const baseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
    const baseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');
    const isTerminal: boolean = windowElement.classList.contains('cy-floating-window-terminal');
    const windowType: 'Terminal' | 'Editor' = isTerminal ? 'Terminal' : 'Editor';
    const strategy: ScalingStrategy = getScalingStrategy(windowType, zoom);

    // Apply dimensions based on strategy
    const baseDimensions: { readonly width: number; readonly height: number } = {width: baseWidth, height: baseHeight};
    const screenDimensions: {
        readonly width: number;
        readonly height: number
    } = getScreenDimensions(baseDimensions, zoom, strategy);
    windowElement.style.width = `${screenDimensions.width}px`;
    // Only update height for terminals - editors use auto-height (SetupAutoHeight.ts)
    // which manages height based on content. Resetting height here causes flicker.
    if (isTerminal) {
        windowElement.style.height = `${screenDimensions.height}px`;
    }
    windowElement.dataset.usingCssTransform = strategy === 'css-transform' ? 'true' : 'false';

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

    if (graphX !== undefined && graphY !== undefined) {
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({
            x: graphX,
            y: graphY
        }, zoom);
        windowElement.style.left = `${screenPos.x}px`;
        windowElement.style.top = `${screenPos.y}px`;

        // Check for custom transform origin (e.g., hover editors use translateX(-50%) for centering)
        const customOrigin: TransformOrigin = windowElement.dataset.transformOrigin === 'top-center' ? 'top-center' : 'center';
        windowElement.style.transform = getWindowTransform(strategy, zoom, customOrigin);
        windowElement.style.transformOrigin = getTransformOrigin(customOrigin);
    }
}