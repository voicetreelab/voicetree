import type {Position} from "@/shell/UI/views/graph-view/IVoiceTreeGraphView";
import {createNewEmptyOrphanNodeFromUI} from "@/shell/edge/UI-edge/graph/actions/handleUIActions";

/**
 * Handle adding a node at a specific position
 * Used by ContextMenuService callbacks
 */
export async function handleAddNodeAtPosition(position: Position): Promise<void> {
    try {
        // Pass position directly to Electron - it will save it immediately
        // Editor auto-pinning handled by file watcher in VoiceTreeGraphView
        const _nodeId: string = await createNewEmptyOrphanNodeFromUI(position);
        //console.log('[FloatingEditorManager-v2] Creating node:', nodeId);
    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating standalone node:', error);
    }
}