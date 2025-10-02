// Canonical Node type - matches Python Node class (backend/markdown_tree_manager/markdown_tree_ds.py)
// NOTE: node_id is always stored as string (e.g., "1", "14_1", "4_2") for simplicity
export interface Node {
  // Core identity
  id: string;              // node_id from Python (converted to string)
  title: string;           // title from frontmatter (matches Python self.title)
  filename: string;        // markdown filename

  // Tree structure (canonical - single source of truth)
  parentId?: string;       // Single parent ID (undefined for roots)
  children: string[];      // Child node IDs
  relationships: Record<string, string>;  // Map of node_id -> relationship_type

  // Content
  content: string;         // Markdown body content
  summary: string;         // Summary (default empty string in Python)

  // Metadata
  createdAt: Date;         // created_at
  modifiedAt: Date;        // modified_at
  tags: string[];          // Tags (default empty array in Python)
  color?: string;          // Optional color for rendering

  // Position (for layout, not in Python)
  x?: number;
  y?: number;
  size?: number;
}

// Canonical MarkdownTree container - matches Python MarkdownTree class
export interface MarkdownTree {
  tree: Map<string, Node>;   // dict[node_id, Node] in Python (keys always strings)
  nextNodeId: number;        // next_node_id for ID generation (only for numeric IDs)
  outputDir: string;         // output_dir for markdown files
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