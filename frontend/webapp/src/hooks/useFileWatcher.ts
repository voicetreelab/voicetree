import { useCallback, useRef } from 'react';
import type { Core, NodeSingular } from 'cytoscape';
import type { CytoscapeCore } from '@/graph-core';
import { parseForCytoscape } from '@/graph-core/data/load_markdown/MarkdownParser';
import { GraphMutator } from '@/graph-core/mutation/GraphMutator';
import { calculateChildAngle, polarToCartesian, SPAWN_RADIUS, calculateParentAngle } from '@/graph-core/graphviz/layout/angularPositionSeeding';
import { GHOST_ROOT_ID } from '@/graph-core/constants';
import type { FileEvent } from '@/types/electron';

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
  // Get ghost root node
  const ghostRoot = cy.getElementById(GHOST_ROOT_ID);

  // Include ghost root in the nodes to position (treat it like a normal node)
  const allNodes = ghostRoot.length > 0 ? [...nodes, ghostRoot] : nodes;

  // Build parent -> children map
  const childrenMap = new Map<string, NodeSingular[]>();

  allNodes.forEach(node => {
    const parentId = node.data('parentId');
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(node);
    }
  });

  // Orphan nodes (no parentId) are children of ghost root
  const orphans = nodes.filter(n => !n.data('parentId'));
  if (orphans.length > 0 && ghostRoot.length > 0) {
    childrenMap.set(GHOST_ROOT_ID, orphans);
  }

  // Find true roots (nodes with no parentId AND not the ghost root)
  // In this case, ghost root is the only true root
  const roots = ghostRoot.length > 0 ? [ghostRoot] : nodes.filter(n => !n.data('parentId'));

  // Position root nodes around origin
  roots.forEach((root, index) => {
    const angle = calculateChildAngle(index, undefined);
    const pos = polarToCartesian(angle, SPAWN_RADIUS);
    root.position({ x: pos.x, y: pos.y });

    // Recursively position children
    positionChildren(root, childrenMap, cy);
  });
}

/**
 * Recursively position children of a node
 */
function positionChildren(parent: NodeSingular, childrenMap: Map<string, NodeSingular[]>, cy: Core): void {
  const parentId = parent.id();
  const children = childrenMap.get(parentId) || [];

  if (children.length === 0) return;

  const parentPos = parent.position();
  const parentAngle = calculateParentAngle(parent, cy);

  children.forEach((child, index) => {
    // Calculate angle for this child
    const angle = calculateChildAngle(index, parentAngle);

    // Calculate position relative to parent
    const offset = polarToCartesian(angle, SPAWN_RADIUS);
    child.position({
      x: parentPos.x + offset.x,
      y: parentPos.y + offset.y
    });

    // Recursively position this child's children
    positionChildren(child, childrenMap, cy);
  });
}

interface UseFileWatcherParams {
  cytoscapeRef: React.RefObject<CytoscapeCore | null>;
  markdownFiles: React.MutableRefObject<Map<string, string>>;
  isInitialLoad: boolean;
  setNodeCount: (count: number) => void;
  setEdgeCount: (count: number) => void;
  setIsInitialLoad: (value: boolean) => void;
  pendingNodePositions?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
}

export function useFileWatcher({
  cytoscapeRef,
  markdownFiles,
  isInitialLoad,
  setNodeCount,
  setEdgeCount,
  setIsInitialLoad,
  pendingNodePositions
}: UseFileWatcherParams) {
  // Store loaded positions for restoring nodes
  const savedPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  const handleBulkFilesAdded = useCallback(async (data: { files: FileEvent[]; directory: string }) => {
    console.log(`[Bulk Load] Processing ${data.files.length} files from initial scan`);

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) {
      console.log('[DEBUG] No cy instance, cannot add files');
      return;
    }

    // Ensure ghost root exists (may have been removed during previous unload)
    if (!cy.getElementById(GHOST_ROOT_ID).length) {
      console.log('[Bulk Load] Re-creating ghost root node');
      cy.add({
        data: {
          id: GHOST_ROOT_ID,
          label: '',
          linkedNodeIds: [],
          isGhostRoot: true
        },
        position: { x: 0, y: 0 }
      });
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
      explicitPosition?: { x: number; y: number };
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

      // Check if we have a saved position for this file
      const savedPosition = savedPositionsRef.current[file.path];

      nodesData.push({
        nodeId,
        label: parsed.label,
        linkedNodeIds,
        edgeLabels,
        parentId,
        color: parsed.color,
        // Pass saved position if available
        ...(savedPosition && { explicitPosition: savedPosition })
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

  const handleFileAdded = useCallback(async (data: FileEvent) => {
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

      // Check if there's a pending position for this node (e.g., from right-click)
      const pendingPosition = pendingNodePositions?.current.get(nodeId);
      if (pendingPosition && pendingNodePositions) {
        console.log('[handleFileAdded] Using pending position for node:', nodeId, pendingPosition);
        // Remove from pending positions map
        pendingNodePositions.current.delete(nodeId);
      }

      // Use GraphMutator to create node (handles positioning internally)
      // The BreathingAnimationService will automatically animate new nodes via event listener
      graphMutator.addNode({
        nodeId,
        label,
        linkedNodeIds,
        parentId,
        color,
        explicitPosition: pendingPosition
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

    // Fit viewport when going from ghost root to ghost root + first real node
    if (nodeCount <= 3) { // Ghost root + first real node
      console.log('[Layout] First node added, fitting viewport with padding');
      setTimeout(() => {
        cy.fit(undefined, 100); // 100px padding for comfortable zoom level
      }, 50); // 50ms delay to avoid race condition with positioning
    }

    // Auto-layout will handle layout automatically via event listeners
  }, [cytoscapeRef, markdownFiles, isInitialLoad, setNodeCount, setEdgeCount]);

  const handleFileChanged = useCallback(async (data: FileEvent) => {
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

  const handleFileDeleted = useCallback((data: FileEvent) => {
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
      // Remove ALL elements (including ghost root) for clean state
      cy.elements().remove();
      setNodeCount(0);
      setEdgeCount(0);
    } else {
      console.log('[DEBUG] No cy instance to clear');
    }

    // Reset to initial load mode for next watch session
    setIsInitialLoad(true);
  }, [cytoscapeRef, markdownFiles, setNodeCount, setEdgeCount, setIsInitialLoad]);

  const handleWatchingStarted = useCallback(async (data: { directory: string }) => {
    console.log('[Layout] Watching started - using bulk load layout strategy');
    setIsInitialLoad(true);

    // Load saved positions for this directory
    if (window.electronAPI?.positions) {
      const result = await window.electronAPI.positions.load(data.directory);
      if (result.success && result.positions) {
        console.log(`[useFileWatcher] Loaded ${Object.keys(result.positions).length} saved positions`);
        savedPositionsRef.current = result.positions;
      } else {
        console.log('[useFileWatcher] No saved positions found or load failed');
        savedPositionsRef.current = {};
      }
    }
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
