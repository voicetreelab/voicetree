import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@/pure/graph';
import {isImageNode} from '@/pure/graph';
import {openHoverImageViewer} from '@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD';
import {type EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {getHoverEditor, getEditorByNodeId} from "@/shell/edge/UI-edge/state/EditorStore";
import {closeEditor, createFloatingEditor} from './FloatingEditorCRUD';
import {updateWindowFromZoom} from '@/shell/edge/UI-edge/floating-windows/update-window-from-zoom';

// =============================================================================
// Hover Zone Detection
// =============================================================================

/**
 * Check if mouse position is within the hover zone (node + editor + menu + slider).
 * Used by mouseleave handlers to determine if hover UI should close.
 *
 * @param mouseX - Mouse X position (clientX)
 * @param mouseY - Mouse Y position (clientY)
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the hovered node
 * @param editorWindow - The hover editor window element (optional)
 */
export function isMouseInHoverZone(
    mouseX: number,
    mouseY: number,
    cy: Core,
    nodeId: string,
    editorWindow: HTMLElement | null
): boolean {
    // Check 1: Over the node? (using Cytoscape's rendered bounding box)
    const node: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    if (node.length > 0) {
        const bbox: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH = node.renderedBoundingBox();
        // Get canvas offset since renderedBoundingBox is relative to the canvas
        const container: HTMLElement | null = cy.container();
        if (container) {
            const containerRect: DOMRect = container.getBoundingClientRect();
            const nodeX1: number = containerRect.left + bbox.x1;
            const nodeX2: number = containerRect.left + bbox.x2;
            const nodeY1: number = containerRect.top + bbox.y1;
            const nodeY2: number = containerRect.top + bbox.y2;
            if (mouseX >= nodeX1 && mouseX <= nodeX2 && mouseY >= nodeY1 && mouseY <= nodeY2) {
                return true;
            }
        }
    }

    // Check 2: Over the editor?
    if (editorWindow) {
        const elementAtPoint: Element | null = document.elementFromPoint(mouseX, mouseY);
        if (elementAtPoint && editorWindow.contains(elementAtPoint)) {
            return true;
        }
    }

    // Check 3: Over the menu?
    const menu: Element | null = document.querySelector('.cy-horizontal-context-menu');
    if (menu) {
        const elementAtPoint: Element | null = document.elementFromPoint(mouseX, mouseY);
        if (elementAtPoint && menu.contains(elementAtPoint)) {
            return true;
        }
    }

    // Check 4: Over the distance slider? (context retrieval distance squares)
    const distanceSlider: Element | null = document.querySelector('.distance-slider');
    if (distanceSlider) {
        const elementAtPoint: Element | null = document.elementFromPoint(mouseX, mouseY);
        if (elementAtPoint && distanceSlider.contains(elementAtPoint)) {
            return true;
        }
    }

    return false;
}

// =============================================================================
// Close Hover Editor
// =============================================================================

/**
 * Close the current hover editor (unanchored editor in EditorStore).
 */
export function closeHoverEditor(cy: Core): void {
    const hoverEditorOption: O.Option<EditorData> = getHoverEditor();
    if (O.isSome(hoverEditorOption)) {
        const nodeId: string = hoverEditorOption.value.contentLinkedToNodeId;
        cy.getElementById(nodeId).removeClass('hover-editor-open');
        closeEditor(cy, hoverEditorOption.value);
    }
}

// =============================================================================
// Setup Command Hover
// =============================================================================

/**
 * Setup hover mode (hover to show floating editor or image viewer).
 *
 * Hovering a node creates a temporary unanchored floating editor positioned
 * on the real Cy node. mouseleave closes it via closeHoverEditor().
 * Image nodes use the image viewer instead.
 */
export function setupCommandHover(cy: Core): void {
    cy.on('mouseover', 'node', (event: cytoscape.EventObject): void => {
        void (async (): Promise<void> => {
            const node: cytoscape.NodeSingular = event.target;
            const nodeId: string = node.id();

            // Skip if editor already exists for this node (pinned or prior hover)
            if (O.isSome(getEditorByNodeId(nodeId as NodeIdAndFilePath))) {
                return;
            }

            // Only open hover for nodes with file extensions
            // Terminal nodes, shadow nodes, etc. don't have file extensions
            const hasFileExtension: boolean = /\.\w+$/.test(nodeId);
            if (!hasFileExtension) {
                return;
            }

            // Check if this is an image node - open image viewer instead of editor
            if (isImageNode(nodeId)) {
                closeHoverEditor(cy);
                await openHoverImageViewer(cy, nodeId, node.position());
                return;
            }

            // Close any existing hover editor before opening a new one
            closeHoverEditor(cy);

            // Create unanchored floating editor (anchoredToNodeId = undefined → hover editor)
            const editorData: EditorData | undefined = await createFloatingEditor(
                cy,
                nodeId as NodeIdAndFilePath,
                undefined,
                false,
            );

            if (editorData?.ui) {
                // Position on the real Cy node (no shadow node creation)
                editorData.ui.windowElement.dataset.shadowNodeId = nodeId;
                editorData.ui.windowElement.dataset.transformOrigin = 'center';
                updateWindowFromZoom(cy, editorData.ui.windowElement, cy.zoom());
            }
        })();
    });
}
