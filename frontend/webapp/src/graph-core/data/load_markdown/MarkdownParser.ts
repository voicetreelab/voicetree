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
    let frontmatter: Record<string, string> = {};

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

    // Extract links with relationship types
    const links: ParsedLink[] = [];

    // Look for Links section
    const linksSectionMatch = bodyContent.match(/_Links:_([\s\S]*?)(?:\n\n|$)/);
    if (linksSectionMatch) {
      const linksContent = linksSectionMatch[1];

      // Match patterns like "- relationship_type [[filename.md]]"
      const linkMatches = linksContent.matchAll(/- ([^\[]+)\[\[([^\]]+)\]\]/g);

      for (const match of linkMatches) {
        const relationshipType = match[1].trim();
        const targetFile = match[2];
        // Extract node ID from filename
        const nodeIdMatch = targetFile.match(/^(\d+)_/);
        const targetNodeId = nodeIdMatch ? nodeIdMatch[1] : targetFile;

        links.push({
          type: relationshipType,  // Actual relationship type from markdown
          targetFile: targetFile,
          targetNodeId: targetNodeId
        });
      }
    } else {
      // Fallback: extract simple wikilinks without relationship types
      const simpleLinkMatches = bodyContent.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const match of simpleLinkMatches) {
        const targetFile = match[1];
        const nodeIdMatch = targetFile.match(/^(\d+)_/);
        const targetNodeId = nodeIdMatch ? nodeIdMatch[1] : targetFile;

        links.push({
          type: 'link',
          targetFile: targetFile,
          targetNodeId: targetNodeId
        });
      }
    }

    return {
      id: frontmatter.node_id || '',
      title: frontmatter.title || '',
      content: bodyContent,
      links: links,
      filename: filename
    };
  }

  /**
   * Parse a directory of markdown files and return simple graph data (original API)
   */
  static async parseDirectory(files: Map<string, string>): Promise<GraphData> {
    const nodes: Array<{ data: NodeData }> = [];
    const edges: Array<{ data: EdgeData }> = [];

    // For each file in the map
    for (const [filename, content] of files) {
      const nodeId = this.normalizeFileId(filename);
      const linkedNodeIds: string[] = [];

      // Extract wikilinks: [[filename.md]]
      const linkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const match of linkMatches) {
        const targetFile = match[1];
        const normalizedTargetId = this.normalizeFileId(targetFile);
        linkedNodeIds.push(normalizedTargetId);

        edges.push({
          data: {
            id: `${nodeId}->${normalizedTargetId}`,
            source: nodeId,
            target: normalizedTargetId
          }
        });
      }

      nodes.push({
        data: {
          id: nodeId,
          label: nodeId.replace(/_/g, ' '),
          linkedNodeIds
        }
      });
    }

    return { nodes, edges };
  }
}