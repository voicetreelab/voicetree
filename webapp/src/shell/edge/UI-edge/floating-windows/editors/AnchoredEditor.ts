import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@/pure/graph';
import {type EditorId, getEditorId, getShadowNodeId} from '@/shell/edge/UI-edge/floating-windows/types';
import type {EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {addToAutoPinQueue, getEditorByNodeId} from '@/shell/edge/UI-edge/state/EditorStore';
import {anchorToNode} from '@/shell/edge/UI-edge/floating-windows/anchor-to-node';
import {getCurrentIndex} from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import {setPendingPanToNode} from '@/shell/edge/UI-edge/state/PendingPanStore';
import {cySmartCenter} from '@/utils/responsivePadding';
import {closeEditor, createFloatingEditor} from './FloatingEditorCRUD';

// =============================================================================
// Create Anchored Floating Editor
// =============================================================================

/**
 * Create a floating editor window anchored to a node
 * Creates a child shadow node and anchors the editor to it
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
            const editorId: EditorId = getEditorId(existingEditor.value);
            navigateToEditorNeighborhood(cy, nodeId, editorId);
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

        // Anchor to node using v2 function
        anchorToNode(cy, editor, getCurrentIndex(cy));

        // Pan to shadow node after layout completes
        const editorId: EditorId = getEditorId(editor);
        const shadowNodeId: string = getShadowNodeId(editorId);
        setPendingPanToNode(shadowNodeId);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating floating editor:', error);
    }
}

/**
 * Navigate to editor neighborhood - pans if zoom is comfortable, zooms to 1.0 if not
 */
function navigateToEditorNeighborhood(cy: Core, nodeId: NodeIdAndFilePath, editorId: EditorId): void {
    const shadowNodeId: string = getShadowNodeId(editorId);
    const editorShadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
    const contextNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    const nodesToCenter: cytoscape.CollectionReturnValue = contextNode.length > 0
        ? contextNode.closedNeighborhood().nodes().union(editorShadowNode)
        : cy.collection().union(editorShadowNode);
    cySmartCenter(cy, nodesToCenter);
}
