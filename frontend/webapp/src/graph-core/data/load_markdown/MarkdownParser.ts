interface NodeData {
  id: string;
  label: string;
  linkedNodeIds: string[];
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
}

export interface GraphData {
  nodes: Array<{ data: NodeData }>;
  edges: Array<{ data: EdgeData }>;
}

export interface ParsedLink {
  type: string;
  targetFile: string;
  targetNodeId: string;
}

export interface ParsedNode {
  id: string;
  title: string;
  content: string;
  links: ParsedLink[];
  filename: string;
}

export class MarkdownParser {
  /**
   * Normalize a filename to a consistent ID
   * 'concepts/introduction.md' -> 'introduction'
   * 'introduction.md' -> 'introduction'
   */
  private static normalizeFileId(filename: string): string {
    // Remove .md extension
    let id = filename.replace(/\.md$/i, '');
    // Take just the filename without path
    const lastSlash = id.lastIndexOf('/');
    if (lastSlash >= 0) {
      id = id.substring(lastSlash + 1);
    }
    return id;
  }

  /**
   * Parse a single markdown file with frontmatter and extract structured data
   */
  static parseMarkdownFile(content: string, filename: string): ParsedNode {
    const lines = content.split('\n');
    let frontmatterEnd = -1;
    const frontmatter: Record<string, string> = {};

    // Parse frontmatter if present
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

    // Extract content (everything after frontmatter)
    const contentStartIndex = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    const bodyContent = lines.slice(contentStartIndex).join('\n');

    // Extract ALL wikilinks from content
    // Any [[link]] anywhere in the file is valid
    const links: ParsedLink[] = [];

    const linkMatches = bodyContent.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of linkMatches) {
      const targetFile = match[1];

      // Try to extract node ID from numbered files (e.g., "5_Something.md" -> "5")
      const nodeIdMatch = targetFile.match(/^(\d+)_/);

      // Otherwise normalize the filename to get a consistent ID
      const targetNodeId = nodeIdMatch ? nodeIdMatch[1] : this.normalizeFileId(targetFile);

      links.push({
        type: 'link',
        targetFile: targetFile,
        targetNodeId: targetNodeId
      });
    }

    return {
      id: frontmatter.node_id || this.normalizeFileId(filename),
      title: frontmatter.title || '',
      content: bodyContent,
      links: links,
      filename: filename
    };
  }

  /**
   * Parse a directory of markdown files and return simple graph data (original API)
   *
   * IMPORTANT: In VoiceTree markdown format, links under "Parent:" section are links FROM child TO parent
   * We invert these to create proper parent->child relationships for the tree layout
   *
   * For generic markdown without Parent: sections, we use wikilinks as-is
   */
  static async parseDirectory(files: Map<string, string>): Promise<GraphData> {
    const nodes: Array<{ data: NodeData }> = [];
    const edges: Array<{ data: EdgeData }> = [];

    // Parse all files
    const parsedNodes = new Map<string, { id: string; filename: string; hasParentSection: boolean }>();
    for (const [filename, content] of files) {
      const parsed = this.parseMarkdownFile(content, filename);
      if (parsed.id) {
        // Check if this file has a Parent: section
        const linksSectionMatch = content.match(/_Links:_([\s\S]*?)(?:\n\n|$)/);
        const hasParentSection = linksSectionMatch ? /Parent:\s*\n/.test(linksSectionMatch[1]) : false;

        parsedNodes.set(parsed.id, { id: parsed.id, filename, hasParentSection });
      }
    }

    // Track children for each node
    const nodeChildren = new Map<string, Set<string>>();
    for (const [id] of parsedNodes) {
      nodeChildren.set(id, new Set());
    }

    // Build edges
    for (const [filename, content] of files) {
      const node = Array.from(parsedNodes.values()).find(n => n.filename === filename);
      if (!node) continue;

      // Check if this has a Parent: section
      const linksSectionMatch = content.match(/_Links:_([\s\S]*?)(?:\n\n|$)/);
      if (linksSectionMatch) {
        const linksContent = linksSectionMatch[1];
        const parentSectionMatch = linksContent.match(/Parent:\s*\n- [^[]+\[\[([^\]]+)\]\]/);

        if (parentSectionMatch) {
          // VoiceTree format: Parent link means "my parent is X"
          // Create edge FROM parent TO this node
          const parentFile = parentSectionMatch[1];
          const parentNodeIdMatch = parentFile.match(/^(\d+)_/);
          const parentId = parentNodeIdMatch ? parentNodeIdMatch[1] : this.normalizeFileId(parentFile);

          if (parsedNodes.has(parentId)) {
            nodeChildren.get(parentId)!.add(node.id);
            edges.push({
              data: {
                id: `${parentId}->${node.id}`,
                source: parentId,
                target: node.id
              }
            });
          }
          continue; // Skip normal wikilink processing for VoiceTree format files
        }
      }

      // Generic format: use wikilinks as-is
      const parsed = this.parseMarkdownFile(content, filename);
      for (const link of parsed.links) {
        const targetId = link.targetNodeId;
        if (parsedNodes.has(targetId)) {
          nodeChildren.get(node.id)!.add(targetId);
          edges.push({
            data: {
              id: `${node.id}->${targetId}`,
              source: node.id,
              target: targetId
            }
          });
        }
      }
    }

    // Create nodes with linkedNodeIds
    for (const [id] of parsedNodes) {
      nodes.push({
        data: {
          id,
          label: id.replace(/_/g, ' '),
          linkedNodeIds: Array.from(nodeChildren.get(id) || [])
        }
      });
    }

    return { nodes, edges };
  }
}