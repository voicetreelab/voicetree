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
    initialCommand?: string;
    executeCommand?: boolean;
    floatingWindow?: FloatingWindowData;
}
export type TerminalId = string;
// function getIdForTerminal(td TerminalData) : TerminalId =>  td.attachedToNodeId + "-terminal" + td.terminalCount;

/**
 * FloatingWindow object returned by component creation functions
 * Provides access to DOM elements and cleanup
 */
export interface FloatingWindowUIHTMLData {
    id: string;
    windowElement: HTMLElement;
    contentContainer: HTMLElement;
    titleBar: HTMLElement;
    cleanup: () => void;
}

export interface FloatingWindowData {
    cyAnchorNodeId: string;
    id: string;
    component: FloatingWindowType;
    title: string;
    HTMLData?: FloatingWindowUIHTMLData
    resizable?: boolean;
    initialContent?: string; // todo, move to EditorData
    onSave?: (content: string) => Promise<void>; // todo move to editorData
    // Shadow node dimensions for layout algorithm (defaults based on component type)
    shadowNodeDimensions?: { width: number; height: number };
    // Cleanup callback when window is closed
    onClose?: () => void;

    // z-index todo
}

// export interface EditorData { } // todo after terminal