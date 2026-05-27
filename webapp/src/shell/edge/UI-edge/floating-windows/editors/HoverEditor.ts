import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@vt/graph-model/graph';
import {isImageNode} from '@vt/graph-model/graph';
import { getLayout } from '@vt/graph-state/state/layoutStore';
import type {Position} from '@/shell/UI/views/graph-view/IVoiceTreeGraphView';
import {openHoverImageViewer} from '@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD';
import {type EditorData} from '@/shell/edge/UI-edge/state/stores/UIAppState';
import {getEditorByNodeId, getHoverEditor} from "@/shell/edge/UI-edge/state/stores/EditorStore";
import {createFloatingEditor, closeEditor} from './FloatingEditorCRUD';
import {createAnchoredFloatingEditor} from './AnchoredEditor';

/**
 * Predicate used by hover-editor mouseleave logic to decide whether the
 * editor should stay open. Receives current mouse client coords and the
 * editor's window element. Returning true keeps the editor open.
 *
 * Defaults to {@link isMouseInHoverZone} bound to the originating node — i.e.
 * the editor stays open while the mouse is over the source node, the editor
 * itself, the horizontal menu, or the distance slider. Folder VIEW-chip
 * hovers (FolderHandleService) override this with a tighter chip+editor zone
 * so the editor closes once you leave the chip.
 */
export type HoverZonePredicate = (
    mouseX: number,
    mouseY: number,
    editorWindow: HTMLElement | null,
) => boolean;

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
    // [L2-seam-residual] cy-only: renderedBoundingBox needs cy; layoutStore has graph coords but not rendered screen coords
    const node: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    if (node.length > 0) {
        const bbox: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH = node.renderedBoundingBox();
        // Get canvas offset since renderedBoundingBox is relative to the canvas
        // [L2-seam-residual] cy-only: container rect not in layoutStore
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

    //console.log('[FloatingEditorManager-v2] Closing command-hover editor');
    closeEditor(cy, hoverEditorOption.value);
}

// =============================================================================
// Open Hover Editor
// =============================================================================

/**
 * Open a hover editor at the given position.
 *
 * @param hoverZone - Optional predicate to decide whether the editor stays
 *   open as the mouse moves. Defaults to {@link isMouseInHoverZone} on the
 *   originating node.
 */
export async function openHoverEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    nodePos: Position,
    hoverZone?: HoverZonePredicate,
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
        const zoom: number = getLayout().zoom ?? 1;
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
            const stillInZone: boolean = hoverZone
                ? hoverZone(e.clientX, e.clientY, editor.ui?.windowElement ?? null)
                : isMouseInHoverZone(
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

        // Double-click anywhere on hover editor converts it to an anchored/pinned editor
        editor.ui.windowElement.addEventListener('dblclick', (): void => {
            closeHoverEditor(cy);
            document.removeEventListener('mousedown', handleClickOutside);
            void createAnchoredFloatingEditor(cy, nodeId);
        });

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating hover editor:', error);
    }
}

// =============================================================================
// Setup Command Hover
// =============================================================================

/**
 * Setup hover mode (hover to show editor or image viewer).
 *
 * Presentation nodes: hoverWiring.ts handles in-place CM editing via card DOM events.
 * When zoomed out, Cy circles are for overview — no hover editor spawned.
 *
 * Non-presentation nodes: existing hover editor behavior (editor below node).
 */
export function setupCommandHover(cy: Core): void {
    // Folders never trigger auto-hover here: the empty space inside an expanded
    // compound and the body of a collapsed pill are NOT folder-note hover
    // affordances. The eye chip in the TL affordance strip is — handled in
    // FolderHandleService.setupFolderHandles via cy mousemove hit-testing.
    // [L2-seam-residual] cy-only: cy event binding for node hover detection
    cy.on('mouseover', 'node[!isFolderNode]', (event: cytoscape.EventObject): void => {
        void (async (): Promise<void> => {
            const node: cytoscape.NodeSingular = event.target;
            const cyNodeId: string = node.id();

            // Only open hover for nodes with file extensions
            // Terminal nodes, shadow nodes, etc. don't have file extensions
            const hasFileExtension: boolean = /\.\w+$/.test(cyNodeId);
            if (!hasFileExtension) return;

            // Check if this is an image node - open image viewer instead of editor
            if (isImageNode(cyNodeId)) {
                // Close any open hover editor first
                closeHoverEditor(cy);
                await openHoverImageViewer(cy, cyNodeId as NodeIdAndFilePath, node.position());
                return;
            }

            // Open hover editor for markdown files (non-presentation nodes)
            await openHoverEditor(cy, cyNodeId as NodeIdAndFilePath, node.position());
        })();
    });
}
