import path from 'path';
import { promises as fs } from 'fs';

interface CreateChildResult {
  success: boolean;
  nodeId?: number;
  filePath?: string;
  error?: string;
}

interface FileOperationResult {
  success: boolean;
  error?: string;
}

/**
 * Deep module for managing markdown nodes in the watched directory.
 *
 * Public API:
 * - async createChild(parentNodeId, watchDirectory)
 * - async saveContent(filePath, content)
 * - async delete(filePath)
 *
 * Hides:
 * - Parent node lookup logic
 * - Node ID generation
 * - Frontmatter parsing
 * - File path resolution
 * - Template generation
 */
export default class MarkdownNodeManager {
  /**
   * Create a child node for a given parent
   */
  async createChild(parentNodeId: string, watchDirectory: string | null): Promise<CreateChildResult> {
    try {
      if (!watchDirectory) {
        return { success: false, error: 'No directory is being watched' };
      }

      console.log(`[create-child-node] Looking for parent: ${parentNodeId} in ${watchDirectory}`);

      // Read all markdown files in the directory
      const files = await fs.readdir(watchDirectory);
      const markdownFiles = files.filter(f => f.endsWith('.md'));
      console.log(`[create-child-node] Found ${markdownFiles.length} markdown files:`, markdownFiles);

      // Find parent file and track max node ID
      const { parentFilePath, parentFileName, maxNodeId } = await this.findParentAndMaxNodeId(
        markdownFiles,
        watchDirectory,
        parentNodeId
      );

      if (!parentFilePath || !parentFileName) {
        return { success: false, error: `Parent node ${parentNodeId} not found` };
      }

      // Generate new node and create file
      const newNodeId = maxNodeId + 1;
      const newFileName = `_${newNodeId}.md`;
      const newFilePath = path.join(watchDirectory, newFileName);

      const content = this.generateNodeTemplate(newNodeId, parentFileName);

      // Write the file
      await fs.writeFile(newFilePath, content, 'utf-8');

      console.log(`[create-child-node] Created ${newFileName} as child of ${parentFileName}`);
      return { success: true, nodeId: newNodeId, filePath: newFilePath };
    } catch (error: any) {
      console.error('Error creating child node:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a standalone node at a specific position (no parent)
   */
   //todo, this could probably be merged with createChild, don't want two paths.
  async createStandaloneNode(watchDirectory: string | null): Promise<CreateChildResult> {
    try {
      if (!watchDirectory) {
        return { success: false, error: 'No directory is being watched' };
      }

      console.log(`[create-standalone-node] Creating new node in ${watchDirectory}`);
      //todo, we should just be storing the max node ID
      // Read all markdown files to find max node ID
      const files = await fs.readdir(watchDirectory);
      const markdownFiles = files.filter(f => f.endsWith('.md'));

      let maxNodeId = 0;
      for (const file of markdownFiles) {
        const filePath = path.join(watchDirectory, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const nodeIdMatch = content.match(/^node_id:\s*(\d+)/m);
        if (nodeIdMatch) {
          const nodeId = parseInt(nodeIdMatch[1], 10);
          if (nodeId > maxNodeId) {
            maxNodeId = nodeId;
          }
        }
      }

      // Generate new node
      const newNodeId = maxNodeId + 1;
      const newFileName = `_${newNodeId}.md`;
      const newFilePath = path.join(watchDirectory, newFileName);

      const content = this.generateStandaloneNodeTemplate(newNodeId);

      // Write the file
      await fs.writeFile(newFilePath, content, 'utf-8');

      console.log(`[create-standalone-node] Created ${newFileName}`);
      return { success: true, nodeId: newNodeId, filePath: newFilePath };
    } catch (error: any) {
      console.error('Error creating standalone node:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save content to a file
   */
  async saveContent(filePath: string, content: string): Promise<FileOperationResult> {
    try {
      await fs.writeFile(filePath, content, 'utf8');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving file:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a file
   */
  async delete(filePath: string): Promise<FileOperationResult> {
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting file:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find parent file by scanning for matching node_id in frontmatter
   * Also tracks the max node_id across all files
   */
  private async findParentAndMaxNodeId(
    markdownFiles: string[],
    watchDirectory: string,
    parentNodeId: string
  ): Promise<{ parentFilePath: string | undefined; parentFileName: string | undefined; maxNodeId: number }> {
    let parentFilePath: string | undefined;
    let parentFileName: string | undefined;
    let maxNodeId = 0;

    for (const file of markdownFiles) {
      const filePath = path.join(watchDirectory, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract node_id from frontmatter
      const nodeIdMatch = content.match(/^node_id:\s*(\d+)/m);
      if (nodeIdMatch) {
        const nodeId = parseInt(nodeIdMatch[1], 10);

        // Track max node_id
        if (nodeId > maxNodeId) {
          maxNodeId = nodeId;
        }

        // Check if this is the parent node (match by node_id number)
        if (nodeId.toString() === parentNodeId || file.replace('.md', '') === parentNodeId) {
          parentFilePath = filePath;
          parentFileName = file;
        }
      } else {
        // No node_id in frontmatter, try matching by filename
        const fileNameWithoutExt = file.replace(/\.md$/i, '');
        console.log(`[create-child-node] Checking file ${file}: fileNameWithoutExt="${fileNameWithoutExt}" vs parentNodeId="${parentNodeId}"`);
        if (fileNameWithoutExt === parentNodeId) {
          parentFilePath = filePath;
          parentFileName = file;
          console.log(`[create-child-node] Matched by filename!`);
        }
      }
    }

    return { parentFilePath, parentFileName, maxNodeId };
  }

  /**
   * Generate markdown template for a new node
   */
  private generateNodeTemplate(nodeId: number, parentFileName: string): string {
    return `---
node_id: ${nodeId}
title:  (${nodeId})
---
###



-----------------
_Links:_
Parent:
- relationshipToParent [[${parentFileName}]]
`;
  }

  /**
   * Generate markdown template for a standalone node (no parent)
   */
  private generateStandaloneNodeTemplate(nodeId: number): string {
    return `---
node_id: ${nodeId}
title: Title (${nodeId})
---
### Summary

Content.
`;
  }
}
