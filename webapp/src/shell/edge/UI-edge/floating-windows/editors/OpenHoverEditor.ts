import type {Position} from "@/shell/UI/views/graph-view/IVoiceTreeGraphView";
import {createNewEmptyOrphanNodeFromUI} from "@/shell/edge/UI-edge/graph/actions/handleUIActions";

/**
 * Handle adding a node at a specific position.
 * Used by ContextMenuService callbacks.
 *
 * @param clickedFolderId - When the click landed inside a folder node, its id (an
 *   absolute directory path); the new node is written into that folder instead of the
 *   project-wide write folder. Undefined for clicks on empty canvas.
 */
export async function handleAddNodeAtPosition(position: Position, clickedFolderId?: string): Promise<void> {
    try {
        // Pass position directly to Electron - it will save it immediately.
        // Editor auto-pinning is handled by the file watcher in VoiceTreeGraphView,
        // so the returned node id is not needed here.
        await createNewEmptyOrphanNodeFromUI(position, clickedFolderId);
    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating standalone node:', error);
    }
}