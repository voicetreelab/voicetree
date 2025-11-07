// Type definitions for floating window components
// Defines the core types and interfaces used throughout the floating window system

export type FloatingWindowType = 'MarkdownEditor' | 'Terminal';

export interface NodeMetadata {
  id: string;
  name: string;
  filePath?: string;
  extraEnv?: Record<string, string>;
  initialCommand?: string;
}

export interface FloatingWindow {
  id: string;
  nodeId: string;
  type: FloatingWindowType;
  title: string;
  content: string;
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
  nodeMetadata?: NodeMetadata;  // Metadata for terminal environment variables
}