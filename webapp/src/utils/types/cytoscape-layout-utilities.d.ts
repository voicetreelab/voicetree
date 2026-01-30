// Type declarations for cytoscape-layout-utilities plugin
import type { Collection } from 'cytoscape';

export interface LayoutUtilitiesOptions {
  idealEdgeLength?: number;
  offset?: number;
}

export interface LayoutUtilitiesInstance {
  placeNewNodes(nodes: Collection): void;
}

declare module 'cytoscape' {
  interface Core {
    layoutUtilities(options?: LayoutUtilitiesOptions): LayoutUtilitiesInstance;
  }
}
