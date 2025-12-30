import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/lib/Option.js";
import {type Option} from "fp-ts/lib/Option.js";
import {getEditorId, type EditorId, type EditorData} from "@/shell/edge/UI-edge/floating-windows/types";
import {vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/UIAppState";

const editors: Map<EditorId, EditorData> = new Map<EditorId, EditorData>();

// Auto-pin tracking: stores the node ID of the last auto-pinned editor
// When a new node is created, the previous auto-pinned editor is closed
// If user manually pins (via Pin Editor button), this is cleared so it won't auto-close
let lastAutoPinnedEditorNodeId: NodeIdAndFilePath | null = null;

export function getLastAutoPinnedEditor(): NodeIdAndFilePath | null {
    return lastAutoPinnedEditorNodeId;
}

export function setLastAutoPinnedEditor(nodeId: NodeIdAndFilePath | null): void {
    lastAutoPinnedEditorNodeId = nodeId;
}

export function clearAutoPinIfMatches(nodeId: NodeIdAndFilePath): void {
    if (lastAutoPinnedEditorNodeId === nodeId) {
        lastAutoPinnedEditorNodeId = null;
    }
}

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
