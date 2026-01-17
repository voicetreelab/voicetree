// Type definitions for floating window components - V2
// Functional design: flat types with intersection composition, IDs derived not stored

import type {Option} from 'fp-ts/lib/Option.js';
import * as O from 'fp-ts/lib/Option.js';
import type {NodeIdAndFilePath} from "@/pure/graph";
import type {
    CreateTerminalDataParams,
    TerminalData
} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type {CreateEditorDataParams, EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";

// =============================================================================
// Branded ID Types (for type safety)
// =============================================================================

export type EditorId = string & { readonly __brand: 'EditorId' };
export type TerminalId = string & { readonly __brand: 'TerminalId' };
export type ShadowNodeId = string & { readonly __brand: 'ShadowNodeId' };

// =============================================================================
// UI HTML Data (populated after DOM creation)
// =============================================================================

export interface FloatingWindowUIData {
    readonly windowElement: HTMLElement;
    readonly contentContainer: HTMLElement;
    // No titleBar - removed in Phase 1 of floating window chrome refactor
    // Traffic lights will be moved to horizontal menu in Phase 2A/3
    // No cleanup stored - use disposeFloatingWindow(fw) function instead
}

// =============================================================================
// Shared Floating Window Fields (composition via intersection)
// =============================================================================

export type FloatingWindowFields = {
    readonly anchoredToNodeId: Option<NodeIdAndFilePath>;
    readonly title: string;
    readonly resizable: boolean;
    readonly shadowNodeDimensions: { readonly width: number; readonly height: number };
    // No onClose callback stored - handle via shell/edge event handlers
    // UI populated after DOM creation
    readonly ui?: FloatingWindowUIData;
};

// =============================================================================
// Union Type for FloatingWindow Content
// =============================================================================

export type FloatingWindowData = EditorData | TerminalData;

// =============================================================================
// Pure ID Derivation Functions (single source of truth)
// =============================================================================

export function getEditorId(editor: EditorData): EditorId {
    return `${editor.contentLinkedToNodeId}-editor` as EditorId;
}

export function getTerminalId(terminal: TerminalData): TerminalId {
    return `${terminal.attachedToNodeId}-terminal-${terminal.terminalCount}` as TerminalId;
}

export function getFloatingWindowId(fw: FloatingWindowData): EditorId | TerminalId {
    return fw.type === 'Editor' ? getEditorId(fw) : getTerminalId(fw);
}

export function getShadowNodeId(editorOrTerminalId: EditorId | TerminalId): ShadowNodeId {
    return `${editorOrTerminalId}-anchor-shadowNode` as ShadowNodeId;
}

// Convenience: get shadow node ID directly from FloatingWindowData
export function getShadowNodeIdFromData(fw: FloatingWindowData): ShadowNodeId {
    return getShadowNodeId(getFloatingWindowId(fw));
}



export function createEditorData(params: CreateEditorDataParams): EditorData {
    return {
        type: 'Editor',
        contentLinkedToNodeId: params.contentLinkedToNodeId,
        title: params.title,
        anchoredToNodeId: params.anchoredToNodeId ? O.some(params.anchoredToNodeId) : O.none,
        initialContent: params.initialContent,
        resizable: params.resizable ?? true,
        shadowNodeDimensions: params.shadowNodeDimensions ?? { width: 480, height: 400 }, // matches getDefaultDimensions('MarkdownEditor')
    };
}

export function createTerminalData(params: CreateTerminalDataParams): TerminalData {
    return {
        type: 'Terminal',
        attachedToNodeId: params.attachedToNodeId,
        terminalCount: params.terminalCount,
        title: params.title,
        anchoredToNodeId: params.anchoredToNodeId ? O.some(params.anchoredToNodeId) : O.none,
        initialEnvVars: params.initialEnvVars,
        initialSpawnDirectory: params.initialSpawnDirectory,
        initialCommand: params.initialCommand,
        executeCommand: params.executeCommand,
        resizable: params.resizable ?? true,
        shadowNodeDimensions: params.shadowNodeDimensions ?? { width: 400, height: 300 }, // matches getDefaultDimensions('Terminal')
        // Tab UI state defaults
        isPinned: params.isPinned ?? true,  // New terminals start pinned by default
        isDone: false,          // Running initially
        lastOutputTime: Date.now(),
        activityCount: 0,
    };
}

// =============================================================================
// Callback Types
// =============================================================================

export type GetContentForEditor = (editor: EditorData) => string;
export type EditorOnSave = (editor: EditorData, content: string) => Promise<void>;

// =============================================================================
// Type Guards & Helpers
// =============================================================================

export function isEditorData(fw: FloatingWindowData): fw is EditorData {
    return fw.type === 'Editor';
}

export function isTerminalData(fw: FloatingWindowData): fw is TerminalData {
    return fw.type === 'Terminal';
}

export function isAnchored(fw: FloatingWindowFields): boolean {
    return O.isSome(fw.anchoredToNodeId);
}
