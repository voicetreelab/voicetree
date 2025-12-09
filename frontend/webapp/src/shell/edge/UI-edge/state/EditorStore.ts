import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/Option";
import {type Option} from "fp-ts/Option";
import {getEditorId, type EditorId, type EditorData} from "@/shell/edge/UI-edge/floating-windows/types";
import {createRecentActionStore, type RecentActionStore} from "@/pure/utils/recent-action-store";

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

/**
 * Tracks content that we're saving from the UI-edge to prevent feedback loop.
 * Uses the shared createRecentActionStore factory with built-in normalization
 * (strips brackets + whitespace) for consistent comparison with FS events.
 *
 * Now includes TTL cleanup (300ms window) for automatic stale entry removal.
 *
 * Flow 1 (external fs change): fs -> updateFloatingEditors (set awaiting) -> onChange DONT SAVE, clear awaiting
 * Flow 2 (our UI change): onChange -> set awaiting -> fs -> updateFloatingEditors DONT SET, clear awaiting
 */
const editorAwaitingStore: RecentActionStore = createRecentActionStore();

export function getAwaitingUISavedContent(): Map<NodeIdAndFilePath, string> {
    // Legacy API - return a snapshot for debugging only
    // Note: This doesn't reflect TTL-expired entries
    const result: Map<NodeIdAndFilePath, string> = new Map<NodeIdAndFilePath, string>();
    // Can't easily reconstruct the full map from the store,
    // keeping this for backwards compatibility with any debug code
    return result;
}

export function setAwaitingUISavedContent(nodeId: NodeIdAndFilePath, content: string): void {
    editorAwaitingStore.mark(nodeId, content);
}

export function getAwaitingContent(nodeId: NodeIdAndFilePath): string | undefined {
    // Legacy API: returns the content if it exists and is recent
    // This is used for exact comparison in FloatingEditorCRUD
    const entries: readonly { timestamp: number; content: string }[] | undefined =
        editorAwaitingStore.getEntriesForKey(nodeId);
    if (!entries || entries.length === 0) return undefined;

    // Return the most recent entry's content if within TTL
    const now: number = Date.now();
    const validEntries: { timestamp: number; content: string }[] =
        entries.filter(e => now - e.timestamp <= 300);
    if (validEntries.length === 0) return undefined;

    // Return the latest entry's content
    return validEntries[validEntries.length - 1].content;
}

/**
 * Check if content matches what we're awaiting (exact match).
 * New API using the store's isRecent method.
 */
export function isAwaitingContent(nodeId: NodeIdAndFilePath, content: string): boolean {
    return editorAwaitingStore.isRecent(nodeId, content);
}

export function deleteAwaitingContent(nodeId: NodeIdAndFilePath): void {
    editorAwaitingStore.deleteKey(nodeId);
}

export function clearAwaitingUISavedContent(): void {
    editorAwaitingStore.clear();
}
