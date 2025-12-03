import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/Option";
import {type Option} from "fp-ts/Option";
import {getEditorId, type EditorId, type EditorData} from "@/shell/edge/UI-edge/floating-windows/types-v2";

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
 * Used by updateFloatingEditors to ignore changes we initiated.
 *
 * Flow 1 (external fs change): fs -> updateFloatingEditors (set awaiting) -> onChange DONT SAVE, clear awaiting
 * Flow 2 (our UI change): onChange -> set awaiting -> fs -> updateFloatingEditors DONT SET, clear awaiting
 */
const awaitingUISavedContent: Map<NodeIdAndFilePath, string> = new Map();

export function getAwaitingUISavedContent(): Map<NodeIdAndFilePath, string> {
    return awaitingUISavedContent;
}

export function setAwaitingUISavedContent(nodeId: NodeIdAndFilePath, content: string): void {
    awaitingUISavedContent.set(nodeId, content);
}

export function getAwaitingContent(nodeId: NodeIdAndFilePath): string | undefined {
    return awaitingUISavedContent.get(nodeId);
}

export function deleteAwaitingContent(nodeId: NodeIdAndFilePath): void {
    awaitingUISavedContent.delete(nodeId);
}

export function clearAwaitingUISavedContent(): void {
    awaitingUISavedContent.clear();
}