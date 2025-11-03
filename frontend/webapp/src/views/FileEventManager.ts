/**
 * FileEventManager - Deep module for file operation management
 *
 * Minimal public API that hides:
 * - Markdown file content caching
 * - Position persistence and restoration
 * - File parsing and graph mutation
 * - Node/edge counting and stats
 * - Animation triggers
 *
 * This class owns all file-related state and operations.
 */

import type { CytoscapeCore } from '@/graph-core';
import { GraphMutator } from '@/graph-core/mutation/GraphMutator';
import { parseForCytoscape } from '@/graph-core/data/load_markdown/MarkdownParser';
import type {
  FileEvent,
  BulkFileEvent,
  Position
} from './IVoiceTreeGraphView';
import { getResponsivePadding } from '@/utils/responsivePadding';
import type { IMarkdownVaultProvider } from '@/providers/IMarkdownVaultProvider';

// Helper function to normalize file ID
// 'concepts/introduction.md' -> 'introduction'
function normalizeFileId(filename: string): string {
  let id = filename.replace(/\.md$/i, '');
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash >= 0) {
    id = id.substring(lastSlash + 1);
  }
  return id;
}

/**
 * Manages all file-related operations for the graph
 */
export class FileEventManager {
  private cy: CytoscapeCore;
  private vaultProvider: IMarkdownVaultProvider;

  // Data storage
  private markdownFiles = new Map<string, string>();
  private savedPositions: Record<string, Position> = {};

  // Stats
  private nodeCount = 0;
  private edgeCount = 0;

  // Callback for stats updates
  private onStatsChanged?: (stats: { nodeCount: number; edgeCount: number }) => void;

  constructor(
    cy: CytoscapeCore,
    vaultProvider: IMarkdownVaultProvider,
    onStatsChanged?: (stats: { nodeCount: number; edgeCount: number }) => void
  ) {
    this.cy = cy;
    this.vaultProvider = vaultProvider;
    this.onStatsChanged = onStatsChanged;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Handle bulk file loading (initial load)
   */
  handleBulkFilesAdded(data: BulkFileEvent): void {
    console.log('[FileEventManager] Handling bulk files added:', data.files.length);

    const cy = this.cy.getCore();
    const mutator = new GraphMutator(cy, null);

    // Clear existing elements (except ghost root)
    cy.elements().not('[isGhostRoot]').remove();

    // Reset markdown cache so it mirrors graph state
    this.markdownFiles.clear();

    const parsedFiles = data.files.map(file => {
      const nodeId = normalizeFileId(file.fullPath);
      const parsed = parseForCytoscape(file.content, file.fullPath);
      const savedPos = this.getSavedPositionForFile(file.fullPath);
      const parentId = parsed.linkedNodeIds.length > 0 ? parsed.linkedNodeIds[0] : undefined;

      return {
        file,
        nodeId,
        parsed,
        savedPos,
        parentId
      };
    });

    // Create nodes + edges in bulk to minimise layout churn
    mutator.bulkAddNodes(parsedFiles.map(({ nodeId, parsed, savedPos, parentId }) => ({
      nodeId,
      label: parsed.label,
      linkedNodeIds: parsed.linkedNodeIds,
      edgeLabels: parsed.edgeLabels,
      parentId,
      color: parsed.color,
      explicitPosition: savedPos
    })));

    // Cache file contents and decorate nodes with metadata
    parsedFiles.forEach(({ file, nodeId, parsed }) => {
      this.markdownFiles.set(file.fullPath, file.content);

      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        node.data('content', file.content);
        node.data('linkedNodeIds', parsed.linkedNodeIds);
        node.data('edgeLabels', Object.fromEntries(parsed.edgeLabels));
        if (parsed.color) {
          node.data('color', parsed.color);
        }
      }
    });

    // Update counts
    this.updateCounts();

    // Fit graph after auto-layout completes (enableAutoLayout will trigger automatically)
    // Layout animation is 300ms, so wait 750ms total
    setTimeout(() => {
      // Use 3% responsive padding for bulk load fit (was 50px on 1440p)
      cy.fit(undefined, getResponsivePadding(cy, 3));
    }, 750);
  }

  /**
   * Handle single file added
   */
  handleFileAdded(data: FileEvent): void {
    console.log('[FileEventManager] Handling file added:', data.fullPath);

    const nodeId = normalizeFileId(data.fullPath);
    const cy = this.cy.getCore();

    // Check if node already exists
    if (cy.getElementById(nodeId).length > 0) {
      console.log('[FileEventManager] Node already exists, skipping');
      return;
    }

    // Check for saved position (from right-click creation or previous session)
    const savedPos = this.getSavedPositionForFile(data.fullPath);

    // Parse and add node
    const parsed = parseForCytoscape(data.content, data.fullPath);
    const mutator = new GraphMutator(cy, null);
    const newNode = mutator.addNode({
      nodeId,
      label: parsed.label,
      linkedNodeIds: parsed.linkedNodeIds,
      parentId: parsed.linkedNodeIds.length > 0 ? parsed.linkedNodeIds[0] : undefined,
      color: parsed.color,
      explicitPosition: savedPos
    });

    // Create edges for newly discovered wikilinks
    for (const targetId of parsed.linkedNodeIds) {
      const label = parsed.edgeLabels.get(targetId) || '';
      mutator.addEdge(nodeId, targetId, label);
    }

    // Store latest content and metadata on node + cache
    newNode.data('content', data.content);
    newNode.data('linkedNodeIds', parsed.linkedNodeIds);
    newNode.data('edgeLabels', Object.fromEntries(parsed.edgeLabels));

    if (parsed.color) {
      newNode.data('color', parsed.color);
    }

    // Auto-layout will trigger automatically via enableAutoLayout when node is added
    // No manual layout call needed

    // Cache content
    this.markdownFiles.set(data.fullPath, data.content);

    // Update counts
    this.updateCounts();
  }

  /**
   * Handle file content changed
   */
  handleFileChanged(data: FileEvent): void {
    console.log('[FileEventManager] Handling file changed:', data.fullPath);

    const nodeId = normalizeFileId(data.fullPath);
    const cy = this.cy.getCore();
    const node = cy.getElementById(nodeId);

    // If node doesn't exist, treat as add
    if (node.length === 0) {
      this.handleFileAdded(data);
      return;
    }

    // Parse new content
    const parsed = parseForCytoscape(data.content, data.fullPath);

    // Update node label + metadata
    node.data('label', parsed.label);
    node.data('content', data.content);
    node.data('linkedNodeIds', parsed.linkedNodeIds);
    node.data('edgeLabels', Object.fromEntries(parsed.edgeLabels));
    if (parsed.color) {
      node.data('color', parsed.color);
    }

    // Update edges in-place
    const mutator = new GraphMutator(cy, null);
    mutator.updateNodeLinks(nodeId, parsed.linkedNodeIds, parsed.edgeLabels);

    // Trigger breathing animation (if available)
    const animationService = (this.cy as any).animationService;
    if (animationService && typeof animationService.startAnimation === 'function') {
      const AnimationType = { CONTENT_APPEND: 'content_append' };
      animationService.startAnimation(node, AnimationType.CONTENT_APPEND);
    }

    // Update content cache
    this.markdownFiles.set(data.fullPath, data.content);

    // Update counts
    this.updateCounts();
  }

  /**
   * Handle file deleted
   */
  handleFileDeleted(data: { fullPath: string }): void {
    console.log('[FileEventManager] Handling file deleted:', data.fullPath);

    const nodeId = normalizeFileId(data.fullPath);
    const cy = this.cy.getCore();
    const mutator = new GraphMutator(cy, null);

    // Remove node (mutator handles edge cleanup)
    mutator.removeNode(nodeId);

    // Remove from cache
    this.markdownFiles.delete(data.fullPath);
    delete this.savedPositions[data.fullPath];
    const filename = data.fullPath.split('/').pop();
    if (filename) {
      delete this.savedPositions[filename];
    }

    // Update counts
    this.updateCounts();
  }

  /**
   * Handle watching stopped (clear all state)
   */
  handleWatchingStopped(): void {
    console.log('[FileEventManager] Handling watching stopped');

    // Save positions before clearing everything
    console.log('[FileEventManager] Saving positions before stopping watch...');
    this.saveNodePositions();

    const cy = this.cy.getCore();

    // Clear graph - remove ALL elements (including ghost root) for clean state
    cy.elements().remove();

    // Clear caches
    this.markdownFiles.clear();
    this.savedPositions = {};

    // Reset state
    this.nodeCount = 0;
    this.edgeCount = 0;

    // Notify stats change
    this.notifyStatsChanged();
  }

  /**
   * Handle watching started (restore positions)
   */
  handleWatchingStarted(data: { directory: string; positions?: Record<string, Position> }): void {
    console.log('[FileEventManager] Handling watching started:', data.directory);

    // Store saved positions
    if (data.positions) {
      this.savedPositions = data.positions;
    }
  }

  /**
   * Get markdown content for a node ID
   */
  getContentForNode(nodeId: string): string | undefined {
    // First check if node has content in its data (for test nodes)
    const node = this.cy.getCore().getElementById(nodeId);
    if (node.length > 0) {
      const nodeData = node.data();
      if (nodeData.content) {
        return nodeData.content;
      }
    }

    // Fall back to markdown files map (for real file-backed nodes)
    for (const [path, content] of this.markdownFiles) {
      if (normalizeFileId(path) === nodeId) {
        return content;
      }
    }
    return undefined;
  }

  /**
   * Get file path for a node ID
   */
  getFilePathForNode(nodeId: string): string | undefined {
    // First check if node has filePath in its data (for test nodes)
    const node = this.cy.getCore().getElementById(nodeId);
    if (node.length > 0) {
      const nodeData = node.data();
      if (nodeData.filePath) {
        return nodeData.filePath;
      }
    }

    // Fall back to markdown files map (for real file-backed nodes)
    for (const [path] of this.markdownFiles) {
      if (normalizeFileId(path) === nodeId) {
        return path;
      }
    }

    // For test nodes without filePath, generate a dummy path
    // This is expected for test nodes, only log in development
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[FileEventManager] getFilePathForNode: Could not find file path for node "${nodeId}", using fallback /test/ path`);
    }
    return `/test/${nodeId}.md`;
  }

  /**
   * Save all node positions to disk
   */
  async saveNodePositions(): Promise<void> {
    try {
      // Get watch directory
      const watchStatus = await this.vaultProvider.getWatchStatus();
      if (!watchStatus.isWatching || !watchStatus.directory) {
        console.warn('[FileEventManager] Not watching any directory');
        return;
      }

      const cy = this.cy.getCore();
      const positions: Record<string, Position> = {};

      // Collect positions
      const allNodes = cy.nodes();
      let skippedFloating = 0;
      let skippedGhost = 0;
      let skippedNoFilename = 0;
      let saved = 0;

      console.log(`[FileEventManager] saveNodePositions: Processing ${allNodes.length} total nodes`);
      console.log(`[FileEventManager] markdownFiles map has ${this.markdownFiles.size} entries`);

      allNodes.forEach((node: any) => {
        const nodeId = node.id();
        const isFloatingWindow = node.data('isFloatingWindow');
        const isGhostRoot = node.data('isGhostRoot');

        if (isFloatingWindow) {
          skippedFloating++;
          return;
        }
        if (isGhostRoot) {
          skippedGhost++;
          return;
        }

        const filePath = this.getFilePathForNode(nodeId);
        if (filePath) {
          // Use basename (filename only) for consistency with right-click creation
          const filename = filePath.split('/').pop() || filePath;
          const pos = node.position();
          positions[filename] = { x: pos.x, y: pos.y };
          saved++;
        } else {
          skippedNoFilename++;
          console.warn(`[FileEventManager] No filename found for node: ${nodeId}`);
        }
      });

      console.log(`[FileEventManager] Position save stats:
  - Total nodes: ${allNodes.length}
  - Saved: ${saved}
  - Skipped (floating): ${skippedFloating}
  - Skipped (ghost): ${skippedGhost}
  - Skipped (no filename): ${skippedNoFilename}`);

      // Save to disk
      const result = await this.vaultProvider.savePositions(
        watchStatus.directory,
        positions
      );
      if (result.success) {
        console.log(`[FileEventManager] Successfully saved ${Object.keys(positions).length} positions to disk`);
      } else {
        console.error('[FileEventManager] Failed to save positions:', result.error);
      }
    } catch (error) {
      console.error('[FileEventManager] Error saving positions:', error);
    }
  }

  /**
   * Store a position for a file (used when creating nodes at specific positions)
   */
  storePosition(filePath: string, position: Position): void {
    const filename = filePath.split('/').pop() || filePath;
    this.savedPositions[filename] = position;
  }

  /**
   * Get current node/edge counts
   */
  getStats(): { nodeCount: number; edgeCount: number } {
    return {
      nodeCount: this.nodeCount,
      edgeCount: this.edgeCount
    };
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.markdownFiles.clear();
    this.savedPositions = {};
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private getSavedPositionForFile(filePath: string): Position | undefined {
    const filename = filePath.split('/').pop();

    if (this.savedPositions[filePath]) {
      return this.savedPositions[filePath];
    }

    if (filename && this.savedPositions[filename]) {
      return this.savedPositions[filename];
    }

    return undefined;
  }

  private updateCounts(): void {
    const cy = this.cy.getCore();
    // Count non-ghost, non-floating nodes and edges
    this.nodeCount = cy.nodes().filter(
      (n: any) => !n.data('isGhostRoot') && !n.data('isFloatingWindow')
    ).length;
    this.edgeCount = cy.edges().filter(
      (e: any) => !e.data('isGhostEdge')
    ).length;

    this.notifyStatsChanged();
  }

  private notifyStatsChanged(): void {
    if (this.onStatsChanged) {
      this.onStatsChanged({
        nodeCount: this.nodeCount,
        edgeCount: this.edgeCount
      });
    }
  }
}
