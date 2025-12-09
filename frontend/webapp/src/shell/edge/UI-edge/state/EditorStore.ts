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
 * Tracks content that the editor is expecting to receive back via broadcast.
 * This prevents feedback loops when editor changes are broadcast back.
 *
 * Editor write path flow:
 *   1. User types -> onChange fires
 *   2. setAwaitingUISavedContent(content) - mark what we're about to save
 *   3. modifyNodeContentFromUI -> broadcasts delta
 *   4. Delta comes back -> updateFloatingEditors called
 *   5. getAwaitingContent matches -> skip setValue, clear awaiting
 *
 * External update flow:
 *   1. FS/UI change -> delta broadcast
 *   2. updateFloatingEditors -> setAwaitingUISavedContent (before setValue)
 *   3. setValue -> onChange fires
 *   4. getAwaitingContent matches -> skip re-save, clear awaiting
 */
const editorAwaitingStore: RecentActionStore = createRecentActionStore();

export function setAwaitingUISavedContent(nodeId: NodeIdAndFilePath, content: string): void {
    editorAwaitingStore.mark(nodeId, content);
}

export function getAwaitingContent(nodeId: NodeIdAndFilePath): string | undefined {
    const entries: readonly { timestamp: number; content: string }[] | undefined =
        editorAwaitingStore.getEntriesForKey(nodeId);
    if (!entries || entries.length === 0) return undefined;

    // Return the most recent entry's content if within TTL (300ms)
    const now: number = Date.now();
    const validEntries: { timestamp: number; content: string }[] =
        entries.filter(e => now - e.timestamp <= 300);
    if (validEntries.length === 0) return undefined;

    return validEntries[validEntries.length - 1].content;
}

export function deleteAwaitingContent(nodeId: NodeIdAndFilePath): void {
    editorAwaitingStore.deleteKey(nodeId);
}
