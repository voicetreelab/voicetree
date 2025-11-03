import type { Node, MarkdownTree } from '@/graph-core/types';

/**
 * Converts markdown files to tree data structure
 * Direct 1:1 port of Python MarkdownToTreeConverter
 * (backend/markdown_tree_manager/markdown_to_tree/tree_from_markdown.py)
 */

interface ParsedRelationships {
  parent?: {
    filename: string;
    relationshipType: string;
  };
  children: Array<{
    filename: string;
    relationshipType: string;
  }>;
}

export class MarkdownToTreeConverter {
  private treeData: Map<string, Node> = new Map();
  private filenameToNodeId: Map<string, string> = new Map();

  /**
   * Main entry point to load tree from markdown files
   * @param files Map of filename -> content
   * @param outputDir Output directory for markdown files (default: "markdownTreeVaultDefault")
   * @returns MarkdownTree object
   */
  loadTreeFromMarkdown(files: Map<string, string>, outputDir: string = "markdownTreeVaultDefault"): MarkdownTree {
    console.log(`Loading tree from ${files.size} markdown files`);

    // First pass: Load all nodes and build filename mapping
    for (const [filename, content] of files) {
      try {
        const node = this.parseMarkdownFile(content, filename);
        if (node) {
          // Check for duplicate node IDs
          if (this.treeData.has(node.id)) {
            const existingNode = this.treeData.get(node.id)!;
            console.warn(`Duplicate node_id ${node.id}: ${existingNode.filename} vs ${filename}`);
          }
          this.treeData.set(node.id, node);
          this.filenameToNodeId.set(filename, node.id);
        } else {
          console.warn(`Failed to parse file ${filename} - node is null`);
        }
      } catch (error) {
        console.error(`Error parsing file ${filename}:`, error);
      }
    }

    // Second pass: Resolve relationships
    for (const [filename, content] of files) {
      try {
        this.parseRelationships(content, filename);
      } catch (error) {
        console.error(`Error parsing relationships in ${filename}:`, error);
      }
    }

    console.log(`Loaded ${this.treeData.size} nodes from markdown`);

    // Build MarkdownTree object
    // nextNodeId: find max numeric ID, ignore string IDs like "4_1"
    const numericIds = Array.from(this.treeData.keys())
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id));
    const nextNodeId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;

    return {
      tree: this.treeData,
      nextNodeId,
      outputDir,
    };
  }

  /**
   * Parse a single markdown file to extract node data
   * Wrapper around comprehensive parser (matches Python structure)
   * @param content File content
   * @param filename Filename
   * @returns Node object or null if parsing fails
   */
  private parseMarkdownFile(content: string, filename: string): Node | null {
    const parsedData = this.parseMarkdownFileComplete(content, filename);
    if (!parsedData) {
      console.warn(`Could not parse file ${filename}`);
      return null;
    }

    // Create Node object from parsed data (match Python defaults)
    const node: Node = {
      id: parsedData.nodeId,
      title: parsedData.title,
      filename: filename,
      content: parsedData.content,
      summary: parsedData.summary || '',  // Default to empty string like Python
      children: [],
      relationships: {},
      createdAt: parsedData.createdAt || new Date(),  // Default to now like Python
      modifiedAt: parsedData.modifiedAt || new Date(),  // Default to now like Python
      tags: parsedData.tags || [],  // Default to empty array like Python
      color: parsedData.color,  // Optional, can be undefined
    };

    return node;
  }

  /**
   * Parse complete markdown file (frontmatter + content)
   * Equivalent to Python comprehensive_parser.parse_markdown_file_complete
   */
  private parseMarkdownFileComplete(content: string, filename: string): {
    nodeId: string;
    title: string;
    content: string;
    summary?: string;
    createdAt?: Date;
    modifiedAt?: Date;
    tags?: string[];
    color?: string;
  } | null {
    const lines = content.split('\n');
    let frontmatterEnd = -1;
    const frontmatter: Record<string, string> = {};

    // Parse frontmatter (YAML between --- markers)
    if (lines[0]?.trim() === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') {
          frontmatterEnd = i;
          break;
        }
        const line = lines[i]?.trim();
        if (line && line.includes(':')) {
          const [key, ...valueParts] = line.split(':');
          const value = valueParts.join(':').trim().replace(/^['"]|['"]$/g, '');
          frontmatter[key.trim()] = value;
        }
      }
    }

    // Extract body content (everything after frontmatter)
    const contentStartIndex = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    const bodyContent = lines.slice(contentStartIndex).join('\n').trim();

    // Extract node_id: use frontmatter if available, otherwise derive from filename
    let nodeId = frontmatter.node_id?.trim();
    if (!nodeId) {
      // Fallback: use filename without .md extension as node_id
      nodeId = filename.replace(/\.md$/i, '');
    }

    // Extract title: use frontmatter if available, otherwise try first # heading, or filename
    let title = frontmatter.title || '';
    if (!title) {
      // Try to extract from first # heading
      const headingMatch = bodyContent.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        title = headingMatch[1].trim();
      } else {
        // Fallback: use filename without extension
        title = filename.replace(/\.md$/i, '');
      }
    }

    return {
      nodeId,
      title,
      content: bodyContent,
      summary: frontmatter.summary,
      createdAt: frontmatter.created_at ? new Date(frontmatter.created_at) : undefined,
      modifiedAt: frontmatter.modified_at ? new Date(frontmatter.modified_at) : undefined,
      tags: frontmatter.tags ? frontmatter.tags.split(',').map(t => t.trim()) : undefined,
      color: frontmatter.color,
    };
  }

  /**
   * Parse relationships from _Links: section
   * Equivalent to Python parse_relationships_from_links
   */
  private parseRelationships(content: string, filename: string): void {
    if (!this.filenameToNodeId.has(filename)) {
      return;
    }

    const nodeId = this.filenameToNodeId.get(filename)!;
    const node = this.treeData.get(nodeId)!;

    const relationships = this.parseRelationshipsFromLinks(content);
    let parentFound = false;

    // Process parent relationship from _Links:_ section
    if (relationships.parent) {
      let parentFilename = relationships.parent.filename;
      const relationshipType = relationships.parent.relationshipType;

      // Strip directory prefix if present (e.g., "2025-09-30/file.md" -> "file.md")
      const lastSlash = parentFilename.lastIndexOf('/');
      if (lastSlash >= 0) {
        parentFilename = parentFilename.substring(lastSlash + 1);
      }

      if (this.filenameToNodeId.has(parentFilename)) {
        const parentId = this.filenameToNodeId.get(parentFilename)!;
        node.parentId = parentId;
        node.relationships[parentId] = relationshipType;
        parentFound = true;

        // Add this node as child to parent
        const parentNode = this.treeData.get(parentId);
        if (parentNode && !parentNode.children.includes(nodeId)) {
          parentNode.children.push(nodeId);
        }
      }
    }

    // If no parent found in _Links:_, use first [[wikilink]] as parent
    if (!parentFound) {
      const wikilinkMatch = content.match(/\[\[([^\]]+)\]\]/);
      if (wikilinkMatch) {
        let linkTarget = wikilinkMatch[1];

        // Handle relative paths (strip ../ or ./)
        linkTarget = linkTarget.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');

        // Add .md extension if not present
        if (!linkTarget.endsWith('.md')) {
          linkTarget += '.md';
        }

        // Check if this wikilink points to an existing node
        if (this.filenameToNodeId.has(linkTarget)) {
          const parentId = this.filenameToNodeId.get(linkTarget)!;
          node.parentId = parentId;
          node.relationships[parentId] = 'references';

          // Add this node as child to parent
          const parentNode = this.treeData.get(parentId);
          if (parentNode && !parentNode.children.includes(nodeId)) {
            parentNode.children.push(nodeId);
          }
        }
      }
    }

    // Process children relationships (if any)
    for (const childInfo of relationships.children) {
      let childFilename = childInfo.filename;
      const relationshipType = childInfo.relationshipType;

      // Strip directory prefix if present
      const lastSlash = childFilename.lastIndexOf('/');
      if (lastSlash >= 0) {
        childFilename = childFilename.substring(lastSlash + 1);
      }

      if (this.filenameToNodeId.has(childFilename)) {
        const childId = this.filenameToNodeId.get(childFilename)!;
        if (!node.children.includes(childId)) {
          node.children.push(childId);
        }

        // Set the relationship from child's perspective
        const childNode = this.treeData.get(childId);
        if (childNode) {
          childNode.parentId = nodeId;
          childNode.relationships[nodeId] = relationshipType;
        }
      }
    }
  }

  /**
   * Parse _Links: section to extract parent and children relationships
   * Format:
   *   _Links:_
   *   Parent:
   *   - relationship_type [[filename.md]]
   *
   *   Children:
   *   - relationship_type [[filename.md]]
   */
  private parseRelationshipsFromLinks(content: string): ParsedRelationships {
    const result: ParsedRelationships = {
      children: [],
    };

    // Find _Links:_ section
    const linksSectionMatch = content.match(/_Links:_([\s\S]*?)(?:\n\n|$)/);
    if (!linksSectionMatch) {
      return result;
    }

    const linksContent = linksSectionMatch[1];

    // Parse Parent: section
    const parentMatch = linksContent.match(/Parent:\s*\n- ([^[]+)\[\[([^\]]+)\]\]/);
    if (parentMatch) {
      const relationshipType = parentMatch[1].trim();
      const filename = parentMatch[2].trim();
      result.parent = {
        filename,
        relationshipType,
      };
    }

    // Parse Children: section
    const childrenSectionMatch = linksContent.match(/Children:([\s\S]*?)(?:\n\n|$)/);
    if (childrenSectionMatch) {
      const childrenContent = childrenSectionMatch[1];
      const childMatches = childrenContent.matchAll(/- ([^[]+)\[\[([^\]]+)\]\]/g);
      for (const match of childMatches) {
        const relationshipType = match[1].trim();
        const filename = match[2].trim();
        result.children.push({
          filename,
          relationshipType,
        });
      }
    }

    return result;
  }
}

/**
 * Convenience function to load tree from markdown files
 * @param files Map of filename -> content
 * @param outputDir Output directory (default: "markdownTreeVaultDefault")
 * @returns MarkdownTree object
 */
export function loadMarkdownTree(files: Map<string, string>, outputDir?: string): MarkdownTree {
  const converter = new MarkdownToTreeConverter();
  return converter.loadTreeFromMarkdown(files, outputDir);
}

/**
 * Parsed data for Cytoscape graph visualization
 */
export interface ParsedCytoscapeData {
  nodeId: string;
  title?: string;
  label: string;
  color?: string;
  linkedNodeIds: string[];
  edgeLabels: Map<string, string>;
}

/**
 * Parse markdown content for Cytoscape graph visualization
 * Extracts frontmatter (color, title), wikilinks, and generates normalized IDs
 *
 * This is a lighter-weight parser optimized for real-time file watching,
 * compared to the full MarkdownToTreeConverter used for batch loading.
 *
 * @param content Markdown file content
 * @param filename Filename (with path and extension)
 * @returns Parsed data ready for Cytoscape node/edge creation
 */
export function parseForCytoscape(content: string, filename: string): ParsedCytoscapeData {
  // 1. Normalize filename to node ID
  // Remove .md extension
  let nodeId = filename.replace(/\.md$/i, '');
  // Take just the filename without path
  const lastSlash = nodeId.lastIndexOf('/');
  if (lastSlash >= 0) {
    nodeId = nodeId.substring(lastSlash + 1);
  }

  // 2. Extract frontmatter (color, title)
  let color: string | undefined;
  let title: string | undefined;

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];

    // Extract color
    const colorMatch = frontmatter.match(/^color:\s*['"]?([^'"\n]+)['"]?$/m);
    if (colorMatch) {
      color = colorMatch[1].trim();
    }

    // Extract title
    const titleMatch = frontmatter.match(/^title:\s*['"]?([^'"\n]+)['"]?$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
  }

  // 3. Parse wikilinks to get linked node IDs and relationship types
  const linkedNodeIds: string[] = [];
  const edgeLabels = new Map<string, string>();

  // First, find all labeled links: "- relationship_type [[filename]]"
  const labeledLinkMatches = content.matchAll(/(?:^|\n)\s*-\s*([^[\n]+?)\s*\[\[([^\]]+)\]\]/g);
  const labeledTargets = new Set<string>();

  for (const match of labeledLinkMatches) {
    const label = match[1]?.trim() || '';
    const targetId = normalizeFileIdInternal(match[2]);
    linkedNodeIds.push(targetId);
    labeledTargets.add(targetId);
    if (label) {
      edgeLabels.set(targetId, label);
    }
  }

  // Then, find all plain wikilinks: [[filename]]
  const plainLinkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g);

  for (const match of plainLinkMatches) {
    const targetId = normalizeFileIdInternal(match[1]);
    // Only add if not already captured as a labeled link
    if (!labeledTargets.has(targetId) || !linkedNodeIds.includes(targetId)) {
      // Check if this exact link instance was already captured
      // We do this by checking if we already added this targetId
      // In the case of duplicates, we allow them (Obsidian does)
      linkedNodeIds.push(targetId);
    }
  }

  // 4. Generate label (use title if available, otherwise normalized nodeId with spaces)
  const label = title || nodeId.replace(/_/g, ' ');

  return {
    nodeId,
    title,
    label,
    color,
    linkedNodeIds,
    edgeLabels
  };
}

/**
 * Internal helper to normalize a filename/path to a node ID
 * @param filename Filename or path (may include .md extension)
 * @returns Normalized node ID
 */
function normalizeFileIdInternal(filename: string): string {
  // Remove .md extension
  let id = filename.replace(/\.md$/i, '');
  // Take just the filename without path
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash >= 0) {
    id = id.substring(lastSlash + 1);
  }
  return id;
}
