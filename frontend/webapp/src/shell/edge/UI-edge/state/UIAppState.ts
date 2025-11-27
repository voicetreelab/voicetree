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
