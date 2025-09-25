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

    // Extract links from the Links section
    const links: ParsedLink[] = [];
    const linksSectionMatch = bodyContent.match(/_Links:_([\s\S]*?)$/m);

    if (linksSectionMatch) {
      const linksContent = linksSectionMatch[1];
      // Match patterns like "- is_child_of [[2_Parent_Node.md]]"
      const linkMatches = linksContent.matchAll(/- (\w+(?:_\w+)*) \[\[([^\]]+)\]\]/g);

      for (const match of linkMatches) {
        const linkType = match[1];
        const targetFile = match[2];
        // Extract node ID from filename (assumes format like "2_Parent_Node.md")
        const nodeIdMatch = targetFile.match(/^(\d+)_/);
        const targetNodeId = nodeIdMatch ? nodeIdMatch[1] : '';

        links.push({
          type: linkType,
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
      // Create node
      const linkedNodeIds: string[] = [];

      // Extract wikilinks: [[filename.md]]
      const linkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const match of linkMatches) {
        const targetFile = match[1];
        linkedNodeIds.push(targetFile);

        edges.push({
          data: {
            id: `${filename}->${targetFile}`,
            source: filename,
            target: targetFile
          }
        });
      }

      nodes.push({
        data: {
          id: filename,
          label: filename.replace('.md', '').replace(/_/g, ' '),
          linkedNodeIds
        }
      });
    }

    return { nodes, edges };
  }
}