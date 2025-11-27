import type { NodeIdAndFilePath } from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js';
import type { Option } from 'fp-ts/lib/Option.js';

// Import new types (Phase 5 complete - all types from types-v2)
import {
    getEditorId,
    getTerminalId,
    type EditorData,
    type EditorId,
    type TerminalData,
    type TerminalId,
} from "@/shell/edge/UI-edge/floating-windows/types-v2";

// Re-export types for consumers
export type { EditorData, EditorId, TerminalData, TerminalId } from "@/shell/edge/UI-edge/floating-windows/types-v2";

// =============================================================================
// Editors State (NEW - uses types-v2)
// =============================================================================

const editors: Map<EditorId, EditorData> = new Map<EditorId, EditorData>();

export function getEditors(): Map<EditorId, EditorData> {
    return editors;
}

export function addEditor(editor: EditorData): void {
    editors.set(getEditorId(editor), editor);
}

export function getEditor(editorId: EditorId): Option<EditorData> {
    const editor: EditorData | undefined = editors.get(editorId);
    return editor ? O.some(editor) : O.none;
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

export function removeEditorByData(editor: EditorData): void {
    editors.delete(getEditorId(editor));
}

/**
 * Clear all editors from state (for testing)
 * @internal - Only for test usage
 */
export function clearEditors(): void {
    editors.clear();
}

// =============================================================================
// Terminals State (uses types-v2 - Phase 5 complete)
// =============================================================================

const terminals: Map<TerminalId, TerminalData> = new Map<TerminalId, TerminalData>();

export function getTerminals(): Map<TerminalId, TerminalData> {
    return terminals;
}

export function addTerminal(terminal: TerminalData): void {
    terminals.set(getTerminalId(terminal), terminal);
}

export function getTerminal(terminalId: TerminalId): Option<TerminalData> {
    const terminal: TerminalData | undefined = terminals.get(terminalId);
    return terminal ? O.some(terminal) : O.none;
}

export function getTerminalByNodeId(nodeId: NodeIdAndFilePath): Option<TerminalData> {
    for (const terminal of terminals.values()) {
        if (terminal.attachedToNodeId === nodeId) {
            return O.some(terminal);
        }
    }
    return O.none;
}

export function removeTerminal(terminalId: TerminalId): void {
    terminals.delete(terminalId);
}

export function removeTerminalByData(terminal: TerminalData): void {
    terminals.delete(getTerminalId(terminal));
}

/**
 * @deprecated Use addTerminal instead
 */
export const addTerminalToMapState: (terminal: TerminalData) => void = addTerminal;

/**
 * @deprecated Use removeTerminalByData instead
 */
export const removeTerminalFromMapState: (terminal: TerminalData) => void = removeTerminalByData;

/**
 * @deprecated Use removeTerminal instead
 */
export const removeTerminalFromMapStateById: (terminalId: TerminalId) => void = removeTerminal;

export function getNextTerminalCount(
    terminalsMap: Map<TerminalId, TerminalData>,
    nodeId: NodeIdAndFilePath
): number {
    let maxCount: number = -1;
    for (const data of terminalsMap.values()) {
        if (data.attachedToNodeId === nodeId && data.terminalCount > maxCount) {
            maxCount = data.terminalCount;
        }
    }
    return maxCount + 1;
}

/**
 * Clear all terminals from state (for testing)
 * @internal - Only for test usage
 */
export function clearTerminals(): void {
    terminals.clear();
}

// =============================================================================
// Derived Editor Queries
// =============================================================================

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

// =============================================================================
// Awaiting UI Saved Content (for race condition handling in editor save flow)
// =============================================================================

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

// =============================================================================
// Legacy: vanillaFloatingWindowInstances (to be removed in Phase 3+)
// =============================================================================

/**
 * @deprecated This will be removed once Phase 3-5 migrate to using ui field in EditorData/TerminalData.
 * The dispose/focus callbacks should be accessed via EditorData.ui.cleanup or TerminalData.ui.cleanup.
 */
export const vanillaFloatingWindowInstances: Map<string, { dispose: () => void; focus?: () => void }> = new Map<string, { dispose: () => void; focus?: () => void }>();

/**
 * Get a vanilla instance by window ID (for testing)
 * @internal - Only for test usage
 * @deprecated Use getEditor/getTerminal and access ui.cleanup instead
 */
export function getVanillaInstance(windowId: string): { dispose: () => void; focus?: () => void } | undefined {
    return vanillaFloatingWindowInstances.get(windowId);
}
