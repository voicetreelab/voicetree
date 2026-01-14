import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/lib/Option.js";
import {type Option} from "fp-ts/lib/Option.js";
import {getEditorId, type EditorId, type EditorData} from "@/shell/edge/UI-edge/floating-windows/types";

const editors: Map<EditorId, EditorData> = new Map<EditorId, EditorData>();

// Auto-pin tracking: FIFO queue of auto-pinned editor node IDs
// When queue exceeds MAX_AUTO_PINNED_EDITORS, oldest is closed
// If user manually pins (via Pin Editor button), editor is removed from queue
const MAX_AUTO_PINNED_EDITORS: number = 4;
const autoPinnedEditorQueue: NodeIdAndFilePath[] = [];

/**
 * Add an editor to the auto-pin queue.
 * Returns the oldest editor's nodeId if queue exceeds limit (caller should close it).
 */
export function addToAutoPinQueue(nodeId: NodeIdAndFilePath): NodeIdAndFilePath | null {
    autoPinnedEditorQueue.push(nodeId);
    if (autoPinnedEditorQueue.length > MAX_AUTO_PINNED_EDITORS) {
        return autoPinnedEditorQueue.shift() ?? null;
    }
    return null;
}

/**
 * Remove an editor from the auto-pin queue (e.g., when manually pinned).
 */
export function removeFromAutoPinQueue(nodeId: NodeIdAndFilePath): void {
    const index: number = autoPinnedEditorQueue.indexOf(nodeId);
    if (index !== -1) {
        autoPinnedEditorQueue.splice(index, 1);
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
