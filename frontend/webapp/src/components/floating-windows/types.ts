// Type definitions for floating window components
// Defines the core types and interfaces used throughout the floating window system

export type FloatingWindowType = 'MarkdownEditor' | 'Terminal';

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
  zIndex: number;
}