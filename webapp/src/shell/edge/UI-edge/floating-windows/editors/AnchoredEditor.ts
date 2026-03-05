import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@/pure/graph';
import {CIRCLE_SIZE} from '@/pure/graph/node-presentation/types';
import type {EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {addToAutoPinQueue, getEditorByNodeId} from '@/shell/edge/UI-edge/state/EditorStore';
import {setPendingPanToNode} from '@/shell/edge/UI-edge/state/PendingPanStore';
import {updateWindowFromZoom} from '@/shell/edge/UI-edge/floating-windows/update-window-from-zoom';
import {updateShadowNodeDimensions} from '@/shell/edge/UI-edge/floating-windows/setup-resize-observer';
import {cleanupRegistry} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import {markNodeDirty} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';
import {cySmartCenter} from '@/utils/responsivePadding';
import {closeEditor, createFloatingEditor} from './FloatingEditorCRUD';

// =============================================================================
// Create Anchored Floating Editor
// =============================================================================

/**
 * Create a floating editor window anchored to the real Cy node.
 * Hides the node circle and positions the editor DOM on top of it.
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the node to edit
 * @param focusAtEnd - If true, focus editor with cursor at end of content (for new nodes)
 * @param isAutoPin - If true, this is an auto-pinned editor (for new nodes) that will be
 *                    auto-closed when the next new node is created
 * @param isAgentNode - If true, node was created by an agent. Agent nodes bypass the
 *                      auto-pin queue and remain open until manually closed.
 */
export async function createAnchoredFloatingEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    focusAtEnd: boolean = false,
    isAutoPin: boolean = false,
    isAgentNode: boolean = false
): Promise<void> {
    try {
        // If editor already exists, center viewport on it and return
        const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
        if (O.isSome(existingEditor)) {
            navigateToEditorNeighborhood(cy, nodeId);
            return;
        }

        // Create floating editor window with anchoredToNodeId set
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            nodeId, // Anchor to the same node we're editing
            focusAtEnd
        );

        // Return early if editor already exists
        if (!editor) {
            //console.log('[FloatingEditorManager-v2] Editor already exists');
            return;
        }

        // FIFO auto-pin: add to queue, close oldest if over limit
        // Agent nodes bypass the queue entirely - they remain open until manually closed
        if (isAutoPin && !isAgentNode) {
            const oldestToClose: NodeIdAndFilePath | null = addToAutoPinQueue(nodeId);
            if (oldestToClose !== null) {
                const oldestEditor: O.Option<EditorData> = getEditorByNodeId(oldestToClose);
                if (O.isSome(oldestEditor)) {
                    closeEditor(cy, oldestEditor.value);
                }
            }
        }

        // Anchor editor to the real Cy node (hide circle, sync dimensions)
        anchorEditorToRealNode(cy, editor, nodeId);

        // Pan to real node after layout completes
        setPendingPanToNode(nodeId);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating floating editor:', error);
    }
}

/**
 * Navigate to editor neighborhood - pans if zoom is comfortable, zooms to 1.0 if not
 */
function navigateToEditorNeighborhood(cy: Core, nodeId: NodeIdAndFilePath): void {
    const contextNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    const nodesToCenter: cytoscape.CollectionReturnValue = contextNode.length > 0
        ? contextNode.closedNeighborhood()
        : cy.collection();
    cySmartCenter(cy, nodesToCenter);
}

// =============================================================================
// Real-Node Anchoring
// =============================================================================

/**
 * Anchor an editor to the real Cy node instead of creating a shadow child node.
 * Hides the Cy circle (opacity 0, keeps ellipse shape for edges), syncs DOM size
 * to Cy node dimensions via ResizeObserver, and registers cleanup to restore the
 * node on editor close.
 */
function anchorEditorToRealNode(cy: Core, editor: EditorData, nodeId: NodeIdAndFilePath): void {
    const windowElement: HTMLElement | undefined = editor.ui?.windowElement;
    if (!windowElement) return;

    // Point the window at the real node (reuses the shadow node positioning system)
    windowElement.dataset.shadowNodeId = nodeId;

    // Initial position sync
    updateWindowFromZoom(cy, windowElement, cy.zoom());

    // Hide the Cy circle — keep ellipse shape so edges stay rendered
    const cyNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        cyNode.style({
            'background-opacity': 0,
            'border-opacity': 0,
            'outline-opacity': 0,
            'shape': 'ellipse',
            'events': 'no',
        } as Record<string, unknown>);
    }

    // ResizeObserver: sync DOM size → Cy node dimensions for Cola layout
    let resizeObserver: ResizeObserver | undefined;
    if (cyNode.length > 0 && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((): void => {
            const oldW: number = cyNode.width();
            const oldH: number = cyNode.height();
            updateShadowNodeDimensions(cyNode, windowElement);
            const dimChanged: boolean = Math.abs(cyNode.width() - oldW) > 1 || Math.abs(cyNode.height() - oldH) > 1;
            if (dimChanged) {
                markNodeDirty(cy, nodeId);
            }
        });
        resizeObserver.observe(windowElement);
    }

    // Register cleanup in the shared registry so disposeFloatingWindow handles teardown
    const originalMenuCleanup: (() => void) | undefined = editor.ui?.menuCleanup;
    cleanupRegistry.set(windowElement, {
        dragMouseMove: (): void => {},
        dragMouseUp: (): void => {},
        resizeObserver,
        menuCleanup: (): void => {
            // Restore Cy node to visible circle
            if (cyNode.length > 0) {
                cyNode.style({
                    'background-opacity': 1,
                    'border-opacity': 1,
                    'outline-opacity': 1,
                    'events': 'yes',
                    'width': CIRCLE_SIZE,
                    'height': CIRCLE_SIZE,
                    'shape': 'ellipse',
                });
                markNodeDirty(cy, nodeId);
            }
            // Run original menu cleanup (floating slider)
            originalMenuCleanup?.();
        },
    });
}
