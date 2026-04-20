import type {Core} from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@vt/graph-model/pure/graph';
import {isImageNode} from '@vt/graph-model/pure/graph';

import {createAnchoredFloatingEditor} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {getEditorByNodeId} from '@/shell/edge/UI-edge/state/EditorStore';

export interface ApplyNodeSelectionSideEffectsParams {
    cy: Core;
    nodeId: NodeIdAndFilePath;
    onNodeSelected?: (nodeId: NodeIdAndFilePath) => void;
}

/**
 * Mirrors the side effects of selecting a node in the live graph UI.
 * Selection state itself is handled by Cytoscape select/unselect listeners.
 */
export async function applyNodeSelectionSideEffects({
    cy,
    nodeId,
    onNodeSelected,
}: ApplyNodeSelectionSideEffectsParams): Promise<void> {
    onNodeSelected?.(nodeId);

    if (isImageNode(nodeId)) {
        return;
    }

    if (O.isSome(getEditorByNodeId(nodeId))) {
        return;
    }

    await createAnchoredFloatingEditor(cy, nodeId, false);
}
