import { useCallback, useRef } from 'react';
import type { Core, NodeSingular } from 'cytoscape';
import type { CytoscapeCore } from '@/graph-core';
import { parseForCytoscape } from '@/graph-core/data/load_markdown/MarkdownParser';
import { GraphMutator } from '@/graph-core/mutation/GraphMutator';
import { calculateChildAngle, polarToCartesian, SPAWN_RADIUS } from '@/graph-core/graphviz/layout/angularPositionSeeding';
import { GHOST_ROOT_ID } from '@/graph-core/constants';

// Normalize a filename to a consistent ID
// 'concepts/introduction.md' -> 'introduction'
function normalizeFileId(filename: string): string {
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
 * Seed positions for all nodes in a bulk load using angular positioning
 * Performs pre-order traversal from root nodes
 */
function seedBulkPositions(cy: Core, nodes: NodeSingular[]): void {
  // Build parent -> children map
  const childrenMap = new Map<string, NodeSingular[]>();

  nodes.forEach(node => {
    const parentId = node.data('parentId');
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(node);
    }
  });

  // Find roots (nodes with no parentId)
  const roots = nodes.filter(n => !n.data('parentId'));

  // Position root nodes around origin
  roots.forEach((root, index) => {
    const angle = calculateChildAngle(index, undefined);
    const pos = polarToCartesian(angle, SPAWN_RADIUS);
    root.position({ x: pos.x, y: pos.y });
    root.data('spawnAngle', angle);

    // Recursively position children
    positionChildren(root, childrenMap);
  });
}

/**
 * Recursively position children of a node
 */
function positionChildren(parent: NodeSingular, childrenMap: Map<string, NodeSingular[]>): void {
  const parentId = parent.id();
  const children = childrenMap.get(parentId) || [];

  if (children.length === 0) return;

  const parentPos = parent.position();
  const parentAngle = parent.data('spawnAngle');

  children.forEach((child, index) => {
    // Calculate angle for this child
    const angle = calculateChildAngle(index, parentAngle);

    // Calculate position relative to parent
    const offset = polarToCartesian(angle, SPAWN_RADIUS);
    child.position({
      x: parentPos.x + offset.x,
      y: parentPos.y + offset.y
    });

    // Store angle on child
    child.data('spawnAngle', angle);

    // Recursively position this child's children
    positionChildren(child, childrenMap);
  });
}

interface UseFileWatcherParams {
  cytoscapeRef: React.RefObject<CytoscapeCore | null>;
  markdownFiles: React.MutableRefObject<Map<string, string>>;
  isInitialLoad: boolean;
  setNodeCount: (count: number) => void;
  setEdgeCount: (count: number) => void;
  setIsInitialLoad: (value: boolean) => void;
}

export function useFileWatcher({
  cytoscapeRef,
  markdownFiles,
  isInitialLoad,
  setNodeCount,
  setEdgeCount,
  setIsInitialLoad
}: UseFileWatcherParams) {

  const handleBulkFilesAdded = useCallback(async (data: { files: Array<{ path: string; content?: string }>; directory: string }) => {
    console.log(`[Bulk Load] Processing ${data.files.length} files from initial scan`);

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) {
      console.log('[DEBUG] No cy instance, cannot add files');
      return;
    }

    // Create GraphMutator instance for this operation
    const graphMutator = new GraphMutator(cy, null);

    // Prepare data for bulk addition
    const nodesData: Array<{
      nodeId: string;
      label: string;
      linkedNodeIds: string[];
      edgeLabels: Map<string, string>;
      parentId?: string;
      color?: string;
    }> = [];

    // Process all files and prepare node data
    for (const file of data.files) {
      if (!file.path.endsWith('.md') || !file.content) {
        continue;
      }

      // Store file content using fullPath (absolute path) for save operations
      markdownFiles.current.set(file.fullPath, file.content);

      // Parse markdown using MarkdownParser (frontmatter + wikilinks)
      const parsed = parseForCytoscape(file.content, file.path);
      const linkedNodeIds = parsed.linkedNodeIds;
      const edgeLabels = parsed.edgeLabels;
      const nodeId = normalizeFileId(file.path);

      // Use first wikilink as parent for tree structure
      const parentId = linkedNodeIds.length > 0 ? linkedNodeIds[0] : undefined;

      nodesData.push({
        nodeId,
        label: parsed.label,
        linkedNodeIds,
        edgeLabels,
        parentId,
        color: parsed.color
      });
    }

    // Use GraphMutator to bulk add nodes and edges
    const createdNodes = graphMutator.bulkAddNodes(nodesData);

    // PHASE 3: Seed positions via tree traversal
    console.log('[BulkLoad] Seeding initial positions for', createdNodes.length, 'nodes');
    seedBulkPositions(cy, createdNodes);

    const allNodeIds = createdNodes.map(node => node.id());

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    console.log(`[DEBUG] Bulk load complete: ${allNodeIds.length} nodes added`);

    // Auto-layout will handle layout automatically via event listeners

    // Switch to incremental layout strategy
    console.log('[Layout] Switching to incremental layout strategy after bulk load');
    setIsInitialLoad(false);

  }, [cytoscapeRef, markdownFiles, setNodeCount, setEdgeCount, setIsInitialLoad]);

  const handleFileAdded = useCallback(async (data: { path: string; content?: string }) => {
    console.log('[DEBUG] handleFileAdded called with path:', data.path);
    if (!data.path.endsWith('.md') || !data.content) {
      console.log('[DEBUG] Skipping non-md file or no content');
      return;
    }

    const cy = cytoscapeRef.current?.getCore();
    console.log('[DEBUG] cytoscapeRef exists:', !!cytoscapeRef.current, 'cy exists:', !!cy);
    if (!cy) {
      console.log('[DEBUG] No cy instance, cannot add file');
      return;
    }

    // Create GraphMutator instance for this operation
    const graphMutator = new GraphMutator(cy, null);

    // Store file content using fullPath (absolute path) for save operations
    markdownFiles.current.set(data.fullPath, data.content);
    console.log('[DEBUG] Added file to markdownFiles, new count:', markdownFiles.current.size);

    // Parse markdown using MarkdownParser (frontmatter + wikilinks)
    const parsed = parseForCytoscape(data.content, data.path);
    const linkedNodeIds = parsed.linkedNodeIds;
    const edgeLabels = parsed.edgeLabels;

    // Add node if it doesn't exist
    const nodeId = normalizeFileId(data.path);
    const isNewNode = !cy.getElementById(nodeId).length;

    if (isNewNode) {
      // Use first wikilink as parent for tree structure
      const parentId = linkedNodeIds.length > 0 ? linkedNodeIds[0] : undefined;

      const color = parsed.color;
      const label = parsed.label;

      // Use GraphMutator to create node (handles positioning internally)
      // The BreathingAnimationService will automatically animate new nodes via event listener
      graphMutator.addNode({
        nodeId,
        label,
        linkedNodeIds,
        parentId,
        color
      });
    } else {
      // Update linkedNodeIds for existing node
      cy.getElementById(nodeId).data('linkedNodeIds', linkedNodeIds);
    }

    // Create target nodes and edges using GraphMutator
    for (const targetId of linkedNodeIds) {
      const label = edgeLabels.get(targetId) || '';
      graphMutator.addEdge(nodeId, targetId, label);
    }

    // Update counts
    const nodeCount = cy.nodes().length;
    setNodeCount(nodeCount);
    setEdgeCount(cy.edges().length);

    // Fit viewport when going from 0 to 1 node with generous padding
    if (nodeCount === 1) {
      console.log('[Layout] First node added, fitting viewport with padding');
      setTimeout(() => {
        cy.fit(undefined, 100); // 100px padding for comfortable zoom level
      }, 300); // 300ms delay to avoid race condition with positioning
    }

    // Auto-layout will handle layout automatically via event listeners
  }, [cytoscapeRef, markdownFiles, isInitialLoad, setNodeCount, setEdgeCount]);

  const handleFileChanged = useCallback(async (data: { path: string; content?: string }) => {
    if (!data.path.endsWith('.md') || !data.content) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Create GraphMutator instance for this operation
    const graphMutator = new GraphMutator(cy, null);

    // Update stored content using fullPath (absolute path) for save operations
    markdownFiles.current.set(data.fullPath, data.content);

    const nodeId = normalizeFileId(data.path);

    // Parse markdown using MarkdownParser (frontmatter + wikilinks)
    const parsed = parseForCytoscape(data.content, data.path);
    const linkedNodeIds = parsed.linkedNodeIds;
    const edgeLabels = parsed.edgeLabels;

    // Use GraphMutator to update node links
    // This handles edge removal (preserving programmatic edges) and recreation
    graphMutator.updateNodeLinks(nodeId, linkedNodeIds, edgeLabels);

    // Update color and label for changed node
    const changedNode = cy.getElementById(nodeId);

    // Update color from frontmatter
    if (parsed.color) {
      changedNode.data('color', parsed.color);
    } else {
      // Remove color if it no longer exists in frontmatter
      changedNode.removeData('color');
    }

    // Update label from frontmatter
    changedNode.data('label', parsed.label);

    // Emit content-changed event for BreathingAnimationService to handle
    changedNode.emit('content-changed');

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    // Auto-layout will handle layout automatically via event listeners

    // TODO: Implement external file change sync to open editors
    // The old React Context-based system has been removed.
    // Need to implement sync via the Cytoscape extension system.
  }, [cytoscapeRef, markdownFiles, isInitialLoad, setNodeCount, setEdgeCount]);

  const handleFileDeleted = useCallback((data: { path: string }) => {
    if (!data.path.endsWith('.md')) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Remove from stored files using fullPath (absolute path)
    markdownFiles.current.delete(data.fullPath);

    // Remove node and its edges
    const nodeId = normalizeFileId(data.path);
    cy.getElementById(nodeId).remove();

    // Clean up orphaned placeholder nodes
    // A placeholder node is one that has no corresponding file and no incoming edges
    cy.nodes().forEach(node => {
      const id = node.id();
      // Check if this node has a corresponding file
      let hasFile = false;
      for (const [path] of markdownFiles.current) {
        if (normalizeFileId(path) === id) {
          hasFile = true;
          break;
        }
      }
      // If no file and no incoming edges, remove it
      if (!hasFile && cy.edges(`[target = "${id}"]`).length === 0) {
        node.remove();
      }
    });

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);
  }, [cytoscapeRef, markdownFiles, setNodeCount, setEdgeCount]);

  const handleWatchingStopped = useCallback(() => {
    console.log('[DEBUG] VoiceTreeLayout handleWatchingStopped called');
    console.log('[DEBUG] Before clear - markdownFiles count:', markdownFiles.current.size);
    console.log('[DEBUG] Before clear - cytoscapeRef exists:', !!cytoscapeRef.current);

    markdownFiles.current.clear();
    const cy = cytoscapeRef.current?.getCore();
    if (cy) {
      console.log('[DEBUG] Removing', cy.elements().length, 'elements from graph');
      cy.elements().remove();
      setNodeCount(0);
      setEdgeCount(0);
    } else {
      console.log('[DEBUG] No cy instance to clear');
    }

    // Reset to initial load mode for next watch session
    setIsInitialLoad(true);
  }, [cytoscapeRef, markdownFiles, setNodeCount, setEdgeCount, setIsInitialLoad]);

  const handleWatchingStarted = useCallback(() => {
    console.log('[Layout] Watching started - using bulk load layout strategy');
    setIsInitialLoad(true);
  }, [setIsInitialLoad]);

  return {
    handleBulkFilesAdded,
    handleFileAdded,
    handleFileChanged,
    handleFileDeleted,
    handleWatchingStopped,
    handleWatchingStarted
  };
}
