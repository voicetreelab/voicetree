// Type definitions for floating window components
// Defines the core types and interfaces used throughout the floating window system

export type FloatingWindowType = 'MarkdownEditor' | 'Terminal';

export interface TerminalData {
  id: string;
  name: string;
  filePath?: string;
  initialEnvVars?: Record<string, string>;
  initialCommand?: string;
  executeCommand?: boolean;
  floatingWindow?: FloatingWindowData;
}

export interface FloatingWindowData {
  id: string;
  nodeId: string;
  type: FloatingWindowType;
  title: string;
  content: string;
  HTMLData?: FloatingWindowUIHTMLData
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  // Graph coordinate fields for zoom-independent positioning
  graphAnchor?: {
    x: number;  // GraphNode position in graph coordinates
    y: number;
  };
  graphOffset?: {
    x: number;  // User's drag offset from anchor in graph coordinates
    y: number;
  };
  zIndex: number;
  onSave?: (newContent: string) => Promise<void>;
}

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