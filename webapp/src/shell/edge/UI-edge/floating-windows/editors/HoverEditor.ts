import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@/pure/graph';
import {isImageNode} from '@/pure/graph';
import {openHoverImageViewer} from '@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD';
import {type EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {getHoverEditor} from "@/shell/edge/UI-edge/state/EditorStore";
import {closeEditor} from './FloatingEditorCRUD';
import {createCardShell, destroyCardShell, activeCardShells} from './CardShell';

// NodeId of the card shell most recently created via hover (for closeHoverEditor cleanup)
let hoverCardShellNodeId: string | null = null;

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
 * Close the current hover editor (editor without anchor) and any hover-created card shell.
 */
export function closeHoverEditor(cy: Core): void {
    // Close legacy hover editor if present (unanchored editor in EditorStore)
    const hoverEditorOption: O.Option<EditorData> = getHoverEditor();
    if (O.isSome(hoverEditorOption)) {
        // Restore the node's Cytoscape label
        const nodeId: string = hoverEditorOption.value.contentLinkedToNodeId;
        cy.getElementById(nodeId).removeClass('hover-editor-open');

        //console.log('[FloatingEditorManager-v2] Closing command-hover editor');
        closeEditor(cy, hoverEditorOption.value);
    }

    // Also destroy any card shell created via hover
    if (hoverCardShellNodeId) {
        destroyCardShell(hoverCardShellNodeId);
        hoverCardShellNodeId = null;
    }
}

// =============================================================================
// Setup Command Hover
// =============================================================================

/**
 * Setup hover mode (hover to show card shell or image viewer).
 *
 * Circles and cards both use the card editor system: hovering a zoomed-out
 * circle creates a card shell identical to those created by the zoom system.
 * Image nodes continue to use the image viewer.
 */
export function setupCommandHover(cy: Core): void {
    // Listen for node hover
    cy.on('mouseover', 'node', (event: cytoscape.EventObject): void => {
        void (async (): Promise<void> => {
            //console.log('[HoverEditor-v2] GraphNode mouseover');

            const node: cytoscape.NodeSingular = event.target;
            const nodeId: string = node.id();

            // Skip if node already has a card shell (zoom system or prior hover)
            if (activeCardShells.has(nodeId)) {
                return;
            }

            // Only open hover for nodes with file extensions
            // Terminal nodes, shadow nodes, etc. don't have file extensions
            const hasFileExtension: boolean = /\.\w+$/.test(nodeId);
            if (!hasFileExtension) {
                //console.log('[HoverEditor-v2] Skipping non-file node:', nodeId);
                return;
            }

            // Check if this is an image node - open image viewer instead of editor
            if (isImageNode(nodeId)) {
                //console.log('[HoverEditor-v2] Opening image viewer for:', nodeId);
                // Close any open hover editor first
                closeHoverEditor(cy);
                await openHoverImageViewer(cy, nodeId, node.position());
                return;
            }

            // Markdown nodes: create card shell (unified with zoomed-in card system)
            // Title and preview mirror the zoom system's mountShellForNode logic
            const title: string = (cy.getElementById(nodeId).data('label') as string | undefined) ?? nodeId;
            const content: string = (cy.getElementById(nodeId).data('content') as string | undefined) ?? '';
            const preview: string = content.replace(/^#.*\n?/, '').trim().slice(0, 150);
            void createCardShell(cy, nodeId as NodeIdAndFilePath, title, preview);
            hoverCardShellNodeId = nodeId;
        })();
    });
}
