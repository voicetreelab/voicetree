// Type definitions for floating window components - V2
// Functional design: flat types with intersection composition, IDs derived not stored
//
// Terminal wire types are owned by @vt/vt-daemon-protocol (re-exported via
// @vt/vt-daemon-client); this file mirrors `TerminalData` locally so the
// webapp can intersect an optional `ui` field (HTMLElement handle) without
// leaking the DOM into the protocol package.

import type {Option} from 'fp-ts/lib/Option.js';
import * as O from 'fp-ts/lib/Option.js';
import type {NodeIdAndFilePath} from "@vt/graph-model/graph";
import type { TerminalLifecycle } from '@vt/graph-model/agent-tabs';
import type {CreateEditorDataParams, EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import type {CreateImageViewerDataParams, ImageViewerData} from "@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType";

// =============================================================================
// Branded ID Types
// =============================================================================

export type EditorId = string & { readonly __brand: 'EditorId' };
export type TerminalId = string & { readonly __brand: 'TerminalId' };
export type ImageViewerId = string & { readonly __brand: 'ImageViewerId' };
export type ShadowNodeId = string & { readonly __brand: 'ShadowNodeId' };

// =============================================================================
// UI HTML Data (populated after DOM creation)
// =============================================================================

export interface FloatingWindowUIData {
    readonly windowElement: HTMLElement;
    readonly contentContainer: HTMLElement;
    // No titleBar - removed in Phase 1 of floating window chrome refactor
    // Traffic lights will be moved to horizontal menu in Phase 2A/3
    // Menu cleanup destroys floating slider when editor closes
    readonly menuCleanup?: () => void;
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
// Webapp's TerminalData = pure runtime shape + optional UI handle.
// =============================================================================

export type TerminalData = {
    readonly type: 'Terminal';
    readonly terminalId: TerminalId;
    readonly attachedToContextNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly anchoredToNodeId: Option<NodeIdAndFilePath>;
    readonly title: string;
    readonly resizable: boolean;
    readonly shadowNodeDimensions: { readonly width: number; readonly height: number };
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly isPinned: boolean;
    readonly isDone: boolean;
    readonly lifecycle: TerminalLifecycle;
    readonly lastOutputTime: number;
    readonly activityCount: number;
    readonly parentTerminalId: TerminalId | null;
    readonly agentName: string;
    readonly worktreeName: string | undefined;
    readonly isHeadless: boolean;
    readonly isMinimized: boolean;
    readonly contextContent: string;
    readonly agentTypeName: string;
    readonly ui?: FloatingWindowUIData;
};

export type CreateTerminalDataParams = {
    readonly terminalId: TerminalId;
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath;
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly resizable?: boolean;
    readonly shadowNodeDimensions?: { readonly width: number; readonly height: number };
    readonly isPinned?: boolean;
    readonly parentTerminalId?: TerminalId | null;
    readonly agentName: string;
    readonly worktreeName?: string;
    readonly isHeadless?: boolean;
    readonly isMinimized?: boolean;
    readonly contextContent?: string;
    readonly agentTypeName?: string;
};

// =============================================================================
// Union Type for FloatingWindow Content
// =============================================================================

export type FloatingWindowData = EditorData | TerminalData | ImageViewerData;

// =============================================================================
// Pure ID Derivation Functions (single source of truth)
// =============================================================================

export function getEditorId(editor: EditorData): EditorId {
    return `${editor.contentLinkedToNodeId}-editor` as EditorId;
}

export function computeTerminalId(attachedToNodeId: string, terminalCount: number): TerminalId {
    return `${attachedToNodeId}-terminal-${terminalCount}` as TerminalId;
}

export function getTerminalId(terminal: TerminalData): TerminalId {
    return terminal.terminalId;
}

export function getImageViewerId(imageViewer: ImageViewerData): ImageViewerId {
    return `${imageViewer.imageNodeId}-image-viewer` as ImageViewerId;
}

export function getFloatingWindowId(fw: FloatingWindowData): EditorId | TerminalId | ImageViewerId {
    if (fw.type === 'Editor') return getEditorId(fw);
    if (fw.type === 'Terminal') return getTerminalId(fw);
    return getImageViewerId(fw);
}

export function getShadowNodeId(floatingWindowId: EditorId | TerminalId | ImageViewerId): ShadowNodeId {
    return `${floatingWindowId}-anchor-shadowNode` as ShadowNodeId;
}

// Convenience: get shadow node ID directly from FloatingWindowData
export function getShadowNodeIdFromData(fw: FloatingWindowData): ShadowNodeId {
    return getShadowNodeId(getFloatingWindowId(fw));
}

/** Base width for hover (floating) editors */
export const FLOATING_EDITOR_WIDTH: number = 380;
/** Width for anchored/pinned editors (35% wider than hover) */
export const ANCHORED_EDITOR_WIDTH: number = Math.round(FLOATING_EDITOR_WIDTH * 1.35);

export function createEditorData(params: CreateEditorDataParams): EditorData {
    return {
        type: 'Editor',
        contentLinkedToNodeId: params.contentLinkedToNodeId,
        title: params.title,
        anchoredToNodeId: params.anchoredToNodeId ? O.some(params.anchoredToNodeId) : O.none,
        initialContent: params.initialContent,
        resizable: params.resizable ?? true,
        shadowNodeDimensions: params.shadowNodeDimensions ?? { width: FLOATING_EDITOR_WIDTH, height: 400 },
    };
}

export function createTerminalData(params: CreateTerminalDataParams): TerminalData {
    return {
        type: 'Terminal',
        terminalId: params.terminalId,
        attachedToContextNodeId: params.attachedToNodeId,
        terminalCount: params.terminalCount,
        title: params.title,
        anchoredToNodeId: params.anchoredToNodeId ? O.some(params.anchoredToNodeId) : O.none,
        initialEnvVars: params.initialEnvVars,
        initialSpawnDirectory: params.initialSpawnDirectory,
        initialCommand: params.initialCommand,
        executeCommand: params.executeCommand,
        resizable: params.resizable ?? true,
        shadowNodeDimensions: params.shadowNodeDimensions ?? { width: 395, height: 380 },
        isPinned: params.isPinned ?? true,
        isDone: false,
        lifecycle: 'spawning',
        lastOutputTime: Date.now(),
        activityCount: 0,
        parentTerminalId: params.parentTerminalId ?? null,
        agentName: params.agentName,
        worktreeName: params.worktreeName,
        isHeadless: params.isHeadless ?? false,
        isMinimized: params.isMinimized ?? false,
        contextContent: params.contextContent ?? '',
        agentTypeName: params.agentTypeName ?? '',
    };
}

export function createImageViewerData(params: CreateImageViewerDataParams): ImageViewerData {
    return {
        type: 'ImageViewer',
        imageNodeId: params.imageNodeId,
        title: params.title,
        anchoredToNodeId: params.anchoredToNodeId ? O.some(params.anchoredToNodeId) : O.none,
        resizable: params.resizable ?? true,
        shadowNodeDimensions: params.shadowNodeDimensions ?? { width: 400, height: 400 },
    };
}

// =============================================================================
// Type Guards & Helpers
// =============================================================================

export function isEditorData(fw: FloatingWindowData): fw is EditorData {
    return fw.type === 'Editor';
}

export function isTerminalData(fw: FloatingWindowData): fw is TerminalData {
    return fw.type === 'Terminal';
}

export function isImageViewerData(fw: FloatingWindowData): fw is ImageViewerData {
    return fw.type === 'ImageViewer';
}

export function isAnchored(fw: FloatingWindowFields): boolean {
    return O.isSome(fw.anchoredToNodeId);
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type {EditorData, CreateEditorDataParams} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
export type {ImageViewerData, CreateImageViewerDataParams} from "@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType";
