// Barrel file to export floating window editor components and types.
// The floating window system itself is now managed by the Cytoscape extension.
// See: src/graph-core/extensions/cytoscape-floating-windows.ts

export { MarkdownEditor } from './editors/MarkdownEditor';
export { Terminal } from './editors/Terminal';
export { TestComponent } from './editors/TestComponent';
export { MermaidRenderer } from './editors/MermaidRenderer';
export type { NodeMetadata } from './types';
