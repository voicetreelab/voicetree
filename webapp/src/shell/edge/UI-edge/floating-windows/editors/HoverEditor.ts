import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@/pure/graph';
import {isImageNode} from '@/pure/graph';
import type {Position} from '@/shell/UI/views/IVoiceTreeGraphView';
import {openHoverImageViewer} from '@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD';
import {getCachedZoom} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import {type EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {getEditorByNodeId, getHoverEditor} from "@/shell/edge/UI-edge/state/EditorStore";
import {createFloatingEditor, closeEditor} from './FloatingEditorCRUD';
import {hasPresentation} from '@/shell/edge/UI-edge/node-presentation/NodePresentationStore';
import {transitionTo} from '@/shell/edge/UI-edge/node-presentation/transitions';

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
 * Close the current hover editor (editor without anchor)
 */
export function closeHoverEditor(cy: Core): void {
    const hoverEditorOption: O.Option<EditorData> = getHoverEditor();
    if (O.isNone(hoverEditorOption)) return;

    // Restore the node's Cytoscape label
    const nodeId: string = hoverEditorOption.value.contentLinkedToNodeId;
    cy.getElementById(nodeId).removeClass('hover-editor-open');

    //console.log('[FloatingEditorManager-v2] Closing command-hover editor');
    closeEditor(cy, hoverEditorOption.value);
}

// =============================================================================
// Open Hover Editor
// =============================================================================

/**
 * Open a hover editor at the given position
 */
async function openHoverEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    nodePos: Position
): Promise<void> {
    // Skip if this node already has an editor open (hover or permanent)
    const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(existingEditor)) {
        //console.log('[HoverEditor-v2] EARLY RETURN - node already has editor:', nodeId);
        return;
    }
    //console.log('[HoverEditor-v2] No existing editor, will create new one for:', nodeId);

    // Close any existing hover editor
    closeHoverEditor(cy);

    //console.log('[FloatingEditorManager-v2] Creating command-hover editor for node:', nodeId);

    try {
        // Create floating editor with anchoredToNodeId: undefined (hover mode, no shadow node)
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            undefined, // Not anchored - hover mode
            true // focusAtEnd - cursor at end of content
        );

        if (!editor || !editor.ui) {
            //console.log('[FloatingEditorManager-v2] Failed to create hover editor');
            return;
        }

        // Set position manually (no shadow node to sync with)
        // Position editor below the node, clearing the node circle icon
        // Store graph position in dataset so updateWindowFromZoom can update on zoom changes
        const HOVER_EDITOR_VERTICAL_OFFSET: number = 18;
        const zoom: number = getCachedZoom();
        const graphX: number = nodePos.x;
        const graphY: number = nodePos.y + HOVER_EDITOR_VERTICAL_OFFSET;

        // Store graph position for zoom updates (hover editors have no shadow node)
        editor.ui.windowElement.dataset.graphX = String(graphX);
        editor.ui.windowElement.dataset.graphY = String(graphY);
        editor.ui.windowElement.dataset.transformOrigin = 'top-center';

        // Apply initial position and transform with scale
        editor.ui.windowElement.style.left = `${graphX * zoom}px`;
        editor.ui.windowElement.style.top = `${graphY * zoom}px`;
        editor.ui.windowElement.style.transformOrigin = 'top center';
        editor.ui.windowElement.style.transform = `translateX(-50%) scale(${zoom})`;

        // Hide the node's Cytoscape label (editor title bar shows the name)
        cy.getElementById(nodeId).addClass('hover-editor-open');

        // Close on click outside (but allow clicks on menus that control this editor)
        const handleClickOutside: (e: MouseEvent) => void = (e: MouseEvent): void => {
            const target: Node = e.target as Node;
            const isInsideEditor: boolean = editor.ui !== undefined && editor.ui.windowElement.contains(target);
            // Also allow clicks on the hover menu (traffic lights, etc.) - it controls this hover editor
            const hoverMenu: HTMLElement | null = document.querySelector('.cy-horizontal-context-menu');
            const isInsideHoverMenu: boolean = hoverMenu !== null && hoverMenu.contains(target);
            // Also allow clicks on context menus (right-click "Add Link", etc.) - they interact with this editor
            const contextMenu: HTMLElement | null = document.querySelector('.ctxmenu');
            const isInsideContextMenu: boolean = contextMenu !== null && contextMenu.contains(target);
            // Also allow clicks on the distance slider (context retrieval distance squares)
            const distanceSlider: HTMLElement | null = document.querySelector('.distance-slider');
            const isInsideDistanceSlider: boolean = distanceSlider !== null && distanceSlider.contains(target);
            if (!isInsideEditor && !isInsideHoverMenu && !isInsideContextMenu && !isInsideDistanceSlider) {
                //console.log('[CommandHover-v2] Click outside detected, closing editor');
                closeHoverEditor(cy);
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };

        // Add listener after a short delay to prevent immediate closure
        setTimeout((): void => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

        // Close on mouse leave (when mouse exits the hover zone)
        const handleMouseLeave: (e: MouseEvent) => void = (e: MouseEvent): void => {
            const stillInZone: boolean = isMouseInHoverZone(
                e.clientX,
                e.clientY,
                cy,
                nodeId,
                editor.ui?.windowElement ?? null
            );
            if (!stillInZone) {
                closeHoverEditor(cy);
                document.removeEventListener('mousedown', handleClickOutside);
                // Request menu to close via custom event
                const menu: Element | null = document.querySelector('.cy-horizontal-context-menu');
                if (menu) {
                    menu.dispatchEvent(new CustomEvent('close-requested'));
                }
            }
        };
        editor.ui.windowElement.addEventListener('mouseleave', handleMouseLeave);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating hover editor:', error);
    }
}

// =============================================================================
// Setup Command Hover
// =============================================================================

// Debounce timers for Cy mouseover on presentation-backed nodes
const cyPresentationHoverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Setup hover mode (hover to show editor or image viewer).
 *
 * Dual hover path for presentation nodes:
 * - Zoomed in (card visible): card DOM mouseenter → hoverWiring.ts → transitionTo('HOVER')
 * - Zoomed out (Cy circle visible): Cy mouseover → this handler → transitionTo('HOVER')
 *
 * Non-presentation nodes: existing hover editor behavior (editor below node).
 */
export function setupCommandHover(cy: Core): void {
    // Listen for node hover
    cy.on('mouseover', 'node', (event: cytoscape.EventObject): void => {
        void (async (): Promise<void> => {
            //console.log('[HoverEditor-v2] GraphNode mouseover');

            const node: cytoscape.NodeSingular = event.target;
            const nodeId: string = node.id();

            // Presentation-backed nodes: route to transitionTo (zoomed-out hover path)
            // When zoomed in, the card's own mouseenter (via hoverWiring.ts) handles hover.
            // Cy mouseover fires when zoomed out because the card has pointer-events: none.
            if (hasPresentation(nodeId)) {
                if (cyPresentationHoverTimers.has(nodeId)) return;

                const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
                    cyPresentationHoverTimers.delete(nodeId);
                    void transitionTo(cy, nodeId, 'HOVER');
                }, 200);
                cyPresentationHoverTimers.set(nodeId, timer);
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

            // Open hover editor for markdown files (non-presentation nodes)
            await openHoverEditor(cy, nodeId, node.position());
        })();
    });

    // Cancel presentation hover timers on mouseout
    cy.on('mouseout', 'node', (event: cytoscape.EventObject): void => {
        const nodeId: string = event.target.id();
        const timer: ReturnType<typeof setTimeout> | undefined = cyPresentationHoverTimers.get(nodeId);
        if (timer) {
            clearTimeout(timer);
            cyPresentationHoverTimers.delete(nodeId);
        }
    });
}
