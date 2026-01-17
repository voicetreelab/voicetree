// Base types for floating windows - no dependencies on EditorData/TerminalData
// This breaks circular imports between types.ts and *DataType.ts files

import type {Option} from 'fp-ts/lib/Option.js';
import type {NodeIdAndFilePath} from "@/pure/graph";

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
}

// =============================================================================
// Shared Floating Window Fields (composition via intersection)
// =============================================================================

export type FloatingWindowFields = {
    readonly anchoredToNodeId: Option<NodeIdAndFilePath>;
    readonly title: string;
    readonly resizable: boolean;
    readonly shadowNodeDimensions: { readonly width: number; readonly height: number };
    readonly ui?: FloatingWindowUIData;
};
