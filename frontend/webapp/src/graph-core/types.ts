// Basic node structure - single source of truth (matches Python Node class)
export interface Node {
  id: string;
  label?: string;

  // Tree structure
  parentId?: string;      // Single parent ID (undefined for roots)
  children: string[];     // Child node IDs

  // Position & rendering
  x?: number;
  y?: number;
  size?: number;
  color?: string;

  // Optional metadata
  content?: string;
  createdAt?: Date;
  modifiedAt?: Date;
  tags?: string[];
}

// Removed TreeNode - was duplicate of Node with different naming
// Use Node with parents/children fields instead

// Basic edge structure
export interface Edge {
  id: string;
  source: string;
  target: string;
  label?: string;
  color?: string;
}

// Graph data container
export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}


// why do we also need these?????? duplication?????
// Cytoscape-specific definitions (extracted from cytoscape types)
export interface NodeDefinition {
  data: {
    id: string;
    label?: string;
    [key: string]: unknown;
  };
  position?: {
    x: number;
    y: number;
  };
  style?: {
    [key: string]: unknown;
  };
}

export interface EdgeDefinition {
  data: {
    id: string;
    source: string;
    target: string;
    label?: string;
    [key: string]: unknown;
  };
  style?: {
    [key: string]: unknown;
  };
}