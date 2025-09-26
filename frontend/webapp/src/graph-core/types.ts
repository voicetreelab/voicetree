// Basic node structure
export interface Node {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
}

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