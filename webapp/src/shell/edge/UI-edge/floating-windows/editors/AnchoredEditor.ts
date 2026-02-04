import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@/pure/graph';
import {type EditorId, getEditorId, getShadowNodeId} from '@/shell/edge/UI-edge/floating-windows/types';
import type {EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {addToAutoPinQueue, getEditorByNodeId} from '@/shell/edge/UI-edge/state/EditorStore';
import {anchorToNode} from '@/shell/edge/UI-edge/floating-windows/anchor-to-node';
import {cySmartCenter} from '@/utils/responsivePadding';
import {closeEditor, createFloatingEditor} from './FloatingEditorCRUD';
import {closeHoverEditor} from './HoverEditor';

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
        anchorToNode(cy, editor);

        // TODO: Re-enable zoom for UI-initiated editor creation only.
        // Currently disabled because both UI-created nodes and external filesystem nodes
        // flow through the same file watcher path, so we can't distinguish them here.
        // To fix: either track "pending UI nodes" or have UI path call this directly
        // (with early-exit preventing duplicates from file watcher).
        // See: tues/58_Dae_Fix_Prevent_Duplicate_Auto_Pin_Editors_3.md

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating floating editor:', error);
    }
}

// =============================================================================
// Create Floating Editor for UI-Created Node
// =============================================================================

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

/**
 * Create a floating editor for a node created via UI interaction (hotkey/menu).
 * This is separate from the auto-pin path used for external graph deltas.
 *
 * Key differences from createAnchoredFloatingEditor:
 * - ALWAYS steals focus (user just created the node, they want to type)
 * - NO autopin state logic (editor is independent/permanent)
 * - Does not close previous auto-pinned editors
 * - Pans to editor neighborhood after creation (like terminal spawn)
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the newly created node
 */
export async function createFloatingEditorForUICreatedNode(
    cy: Core,
    nodeId: NodeIdAndFilePath
): Promise<void> {
    try {
        // Close any open hover editor - user is creating a new node, focus should shift
        closeHoverEditor(cy);

        // Early exit if editor already exists
        if (O.isSome(getEditorByNodeId(nodeId))) {
            //console.log('[FloatingEditorManager-v2] UI-created node editor already exists:', nodeId);
            return;
        }

        //console.log('[FloatingEditorManager-v2] Creating editor for UI-created node:', nodeId);

        // Create floating editor window with focus at end (user wants to type immediately)
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            nodeId, // Anchor to the same node we're editing
            true    // Always focus at end for UI-created nodes
        );

        if (!editor) {
            //console.log('[FloatingEditorManager-v2] Failed to create editor for UI-created node');
            return;
        }

        // Anchor to node (creates shadow node for positioning)
        anchorToNode(cy, editor);

        // Navigate to editor neighborhood with delay to handle IPC race condition
        // (node may not be fully positioned in Cytoscape yet when this runs)
        const editorId: EditorId = getEditorId(editor);
        setTimeout(() => navigateToEditorNeighborhood(cy, nodeId, editorId), 1200);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating editor for UI-created node:', error);
    }
}
