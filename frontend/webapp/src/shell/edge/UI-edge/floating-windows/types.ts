// Type definitions for floating window components - V2
// Functional design: flat types with intersection composition, IDs derived not stored

import * as O from 'fp-ts/lib/Option.js';
import type { Option } from 'fp-ts/lib/Option.js';
import type { NodeIdAndFilePath } from "@/pure/graph";

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
    readonly titleBar: HTMLElement;
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
// Editor Data Type
// =============================================================================

export type EditorData = FloatingWindowFields & {
    readonly type: 'Editor';
    readonly contentLinkedToNodeId: NodeIdAndFilePath;
    readonly initialContent?: string; // ONLY for initial content (e.g. "loading..."). After loading, use GetContentForEditor
};

// =============================================================================
// Terminal Data Type
// =============================================================================

export type TerminalData = FloatingWindowFields & {
    readonly type: 'Terminal';
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number; // Multiple terminals per parent node allowed
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
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

// =============================================================================
// Factory Functions
// =============================================================================

export type CreateEditorDataParams = {
    readonly contentLinkedToNodeId: NodeIdAndFilePath;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath; // defaults to O.none
    readonly initialContent?: string;
    readonly resizable?: boolean; // defaults to true
    readonly shadowNodeDimensions?: { width: number; height: number };
};

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

export type CreateTerminalDataParams = {
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath; // defaults to O.none
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly resizable?: boolean; // defaults to true
    readonly shadowNodeDimensions?: { width: number; height: number };
};

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
