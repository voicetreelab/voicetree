/**
 * ResizeObserver setup for floating windows
 *
 * Handles window resize → shadow node dimension sync
 * Only triggers layout for user-initiated resizes (CSS drag), not zoom-induced resizes.
 */

import type cytoscape from "cytoscape";
import {screenToGraphDimensions, type ScalingStrategy} from "@/pure/graph/floating-windows/floatingWindowScaling";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {markNodeDirty} from "@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout";

/**
 * Update shadow node dimensions based on window DOM element dimensions.
 * Shadow node dimensions are in graph coordinates (base dimensions).
 * Also updates the base dimensions dataset so zoom/pan events preserve user resize.
 */
export function updateShadowNodeDimensions(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement): void {
    const strategy: ScalingStrategy = domElement.dataset.usingCssTransform === 'true' ? 'css-transform' : 'dimension-scaling';
    const zoom: number = getCyInstance().zoom();
    const screenDimensions: { readonly width: number; readonly height: number } = {
        width: domElement.offsetWidth,
        height: domElement.offsetHeight
    };
    const graphDimensions: { readonly width: number; readonly height: number } = screenToGraphDimensions(screenDimensions, zoom, strategy);

    shadowNode.style({
        'width': graphDimensions.width,
        'height': graphDimensions.height
    });

    // Update base dimensions dataset so updateWindowFromZoom preserves user resize
    domElement.dataset.baseWidth = String(graphDimensions.width);
    domElement.dataset.baseHeight = String(graphDimensions.height);
}

/**
 * Set up ResizeObserver for a floating window.
 *
 * Key insight for distinguishing user resize from zoom resize:
 * - Zoom resize: Screen dims change but graph dims stay same (dimension-scaling divides by zoom)
 * - User resize: Graph dims actually change
 *
 * We check the shadow node's graph dimensions before/after to detect actual user resizes.
 */
export function setupResizeObserver(
    cy: cytoscape.Core,
    shadowNode: cytoscape.NodeSingular,
    windowElement: HTMLElement
): ResizeObserver | undefined {
    if (typeof ResizeObserver === 'undefined') {
        return undefined;
    }

    const resizeObserver: ResizeObserver = new ResizeObserver(() => {
        // Capture old graph dimensions from shadow node (the source of truth)
        const oldWidth: number = shadowNode.width();
        const oldHeight: number = shadowNode.height();

        updateShadowNodeDimensions(shadowNode, windowElement);
        cy.trigger('floatingwindow:resize', [{nodeId: shadowNode.id()}]);

        // Check if graph dimensions actually changed (user resize vs zoom-induced)
        const newWidth: number = shadowNode.width();
        const newHeight: number = shadowNode.height();
        const dimChanged: boolean = Math.abs(newWidth - oldWidth) > 1 || Math.abs(newHeight - oldHeight) > 1;

        if (dimChanged) {
            markNodeDirty(cy, shadowNode.id());
        }
    });

    resizeObserver.observe(windowElement);
    return resizeObserver;
}
