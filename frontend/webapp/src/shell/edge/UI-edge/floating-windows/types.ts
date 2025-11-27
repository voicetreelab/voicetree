// Type definitions for floating window components
// Defines the core types and interfaces used throughout the floating window system

import type {NodeIdAndFilePath} from "@/pure/graph";

export type FloatingWindowType = 'MarkdownEditor' | 'Terminal';

export interface TerminalData {
    attachedToNodeId: NodeIdAndFilePath; //pk
    terminalCount: number; // we allow for multiple terminals per parent node terminal is attached to
    // terminalId is derived it's nodeIdIsFilePath + "-terminal" + terminalCount, make this a function.
    // wait actually, not even any need for terminal id, just get through parentNodeID
    // name is derived, it's node.title +
    // filePath is nodeID
    initialEnvVars?: Record<string, string>;
    initial_spawn_directory?: string;
    initialCommand?: string;
    executeCommand?: boolean;
    floatingWindow?: FloatingWindowData;
}
export type TerminalId = string;

// Generate a unique terminal ID from TerminalData
export function getTerminalId(td: TerminalData): TerminalId {
    return `${td.attachedToNodeId}-terminal-${td.terminalCount}`;
}


// export interface EditorData {
//     contentLinkedToNodeId: NodeIdAndFilePath;
//     initialContent?: string; // ONLY use this for initial content (e.g. "loading..."). after loading, we use GetContentForEditor
//     floatingWindow?: FloatingWindowData;
// }

export type EditorId = string;

// export function getEditorId(editor : EditorData): EditorId {
//     return `${editor.contentLinkedToNodeId}-editor`
// }
//
// export type GetContentForEditor = (editor: EditorData) => string // e.g. returning replaceLinks(getNode(contentLinkedToNodeId).contentWithoutYaml)
//
// export type EditorOnSave = (editor: EditorData, content : string) => Promise<void> // e.g. returning replaceLinks(getNode(contentLinkedToNodeId).contentWithoutYaml)
//
//todo, why isn't eslint enforcing readonly types here?
// export interface FloatingWindowData {
//     // anchored: boolean; derived from anchoredToNodeId
//     anchoredToNodeId?: NodeIdAndFilePath; //todo optional is probs better here
//     // anchoredToNodeId is derived. getAnchorNodeId
//     // cyAnchorNodeId?: string; // Optional - only needed when anchoring to a node, todo again avoid, it should be derived: id + -anchor
//     readonly associatedTerminalOrEditorID: TerminalId | EditorId; //todo ideally we remove it in the future and reverse the types so FloatingWindowData HAS a Terminal | Editor
//     component: FloatingWindowType;
//     title: string;
//     HTMLData?: FloatingWindowUIHTMLData
//     resizable?: boolean;
//     initialContent?: string; // todo, move to EditorData
//     // Shadow node dimensions for layout algorithm (defaults based on component type)
//     shadowNodeDimensions?: { width: number; height: number }; // todo can remove, just use defaults
//     // Cleanup callback when window is closed
//     onClose?: () => void;
//     // z-index todo
// }
// export type AnchorNodeId = string;
//
// export function getAnchorShadowNodeId(floatingWindow: FloatingWindowData) : AnchorNodeId {
//     return floatingWindow.associatedTerminalOrEditorID + "-anchor-shadowNode"
// }


// /**
//  * FloatingWindow object returned by component creation functions
//  * Provides access to DOM elements and cleanup
//  */
// export interface FloatingWindowUIHTMLData {
//     id: string; // todo we want to avoid using this, ideally we remove it in the future and use just the terminal / editor id
//     windowElement: HTMLElement;
//     contentContainer: HTMLElement;
//     titleBar: HTMLElement;
//     cleanup: () => void;
// }
