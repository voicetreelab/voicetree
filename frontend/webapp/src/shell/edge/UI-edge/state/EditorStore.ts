import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/lib/Option.js";
import {type Option} from "fp-ts/lib/Option.js";
import {getEditorId, type EditorId, type EditorData} from "@/shell/edge/UI-edge/floating-windows/types";

const editors: Map<EditorId, EditorData> = new Map<EditorId, EditorData>();

// Manually pinned editors: set of nodeIds that user has explicitly pinned
const pinnedEditors: Set<string> = new Set<string>();

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
    const editor = editors.get(editorId);
    if (editor) {
        pinnedEditors.delete(editor.contentLinkedToNodeId);
    }
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

/**
 * Add a nodeId to the pinned editors set (manually pinned by user).
 */
export function addToPinnedEditors(nodeId: string): void {
    pinnedEditors.add(nodeId);
    document.dispatchEvent(new CustomEvent('pinned-editors-changed'));
}

/**
 * Remove a nodeId from the pinned editors set.
 */
export function removeFromPinnedEditors(nodeId: string): void {
    pinnedEditors.delete(nodeId);
    document.dispatchEvent(new CustomEvent('pinned-editors-changed'));
}

/**
 * Check if a nodeId is manually pinned.
 */
export function isPinned(nodeId: string): boolean {
    return pinnedEditors.has(nodeId);
}

/**
 * Get the set of pinned editor nodeIds for UI rendering.
 */
export function getPinnedEditors(): ReadonlySet<string> {
    return pinnedEditors;
}
