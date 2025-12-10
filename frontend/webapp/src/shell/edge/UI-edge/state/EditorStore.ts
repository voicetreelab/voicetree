import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/Option";
import {type Option} from "fp-ts/Option";
import {getEditorId, type EditorId, type EditorData} from "@/shell/edge/UI-edge/floating-windows/types";

const editors: Map<EditorId, EditorData> = new Map<EditorId, EditorData>();

export function getEditors(): Map<EditorId, EditorData> {
    return editors;
}

export function addEditor(editor: EditorData): void {
    editors.set(getEditorId(editor), editor);
}

export function getEditorByNodeId(nodeId: NodeIdAndFilePath): Option<EditorData> {
    for (const editor of editors.values()) {
        if (editor.contentLinkedToNodeId === nodeId) {
            return O.some(editor);
        }
    }
    return O.none;
}

export function removeEditor(editorId: EditorId): void {
    editors.delete(editorId);
}

/**
 * Get the current hover editor (editor without anchor).
 * Hover editors have anchoredToNodeId = O.none, while permanent editors have O.some(nodeId).
 * This is derived state - no separate tracking needed.
 */
export function getHoverEditor(): Option<EditorData> {
    for (const editor of editors.values()) {
        if (O.isNone(editor.anchoredToNodeId)) {
            return O.some(editor);
        }
    }
    return O.none;
}
