import { useCallback, useRef } from 'react';
import type { CytoscapeCore } from '@/graph-core';
import type { LayoutManager } from '@/graph-core/graphviz/layout';

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

interface UseFileWatcherParams {
  cytoscapeRef: React.RefObject<CytoscapeCore | null>;
  markdownFiles: React.MutableRefObject<Map<string, string>>;
  layoutManagerRef: React.MutableRefObject<LayoutManager | null>;
  isInitialLoad: boolean;
  setNodeCount: (count: number) => void;
  setEdgeCount: (count: number) => void;
  setIsInitialLoad: (value: boolean) => void;
}

export function useFileWatcher({
  cytoscapeRef,
  markdownFiles,
  layoutManagerRef,
  isInitialLoad,
  setNodeCount,
  setEdgeCount,
  setIsInitialLoad
}: UseFileWatcherParams) {
  // Track last new node for animation timeout management
  const lastNewNodeIdRef = useRef<string | null>(null);

  const handleBulkFilesAdded = useCallback((data: { files: Array<{ path: string; content?: string }>; directory: string }) => {
    console.log(`[Bulk Load] Processing ${data.files.length} files from initial scan`);

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) {
      console.log('[DEBUG] No cy instance, cannot add files');
      return;
    }

    const allNodeIds: string[] = [];

    // Process all files
    for (const file of data.files) {
      if (!file.path.endsWith('.md') || !file.content) {
        continue;
      }

      // Store file content using fullPath (absolute path) for save operations
      markdownFiles.current.set(file.fullPath, file.content);

      // Parse wikilinks to get linked node IDs
      const linkedNodeIds: string[] = [];
      const linkMatches = file.content.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const match of linkMatches) {
        const targetId = normalizeFileId(match[1]);
        linkedNodeIds.push(targetId);
      }

      // Add node if it doesn't exist
      const nodeId = normalizeFileId(file.path);
      const isNewNode = !cy.getElementById(nodeId).length;

      if (isNewNode) {
        // Use first wikilink as parent for tree structure
        const parentId = linkedNodeIds.length > 0 ? linkedNodeIds[0] : undefined;

        cy.add({
          data: {
            id: nodeId,
            label: nodeId.replace(/_/g, ' '),
            linkedNodeIds,
            parentId
          }
        });
        allNodeIds.push(nodeId);
      } else {
        // Update linkedNodeIds for existing node
        cy.getElementById(nodeId).data('linkedNodeIds', linkedNodeIds);
      }

      // Create target nodes and edges
      for (const targetId of linkedNodeIds) {
        // Ensure target node exists (create placeholder if needed)
        if (!cy.getElementById(targetId).length) {
          cy.add({
            data: {
              id: targetId,
              label: targetId.replace(/_/g, ' '),
              linkedNodeIds: []
            }
          });
        }

        const edgeId = `${nodeId}->${targetId}`;

        // Add edge if it doesn't exist
        if (!cy.getElementById(edgeId).length) {
          cy.add({
            data: {
              id: edgeId,
              source: nodeId,
              target: targetId
            }
          });
        }
      }
    }

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    console.log(`[DEBUG] Bulk load complete: ${allNodeIds.length} nodes added`);

    // Apply layout to all nodes at once
    if (layoutManagerRef.current && allNodeIds.length > 0) {
      console.log(`[Layout] Applying TidyLayout to ${allNodeIds.length} nodes from bulk load`);
      layoutManagerRef.current.applyLayout(cy, allNodeIds);

      // Fit the graph after bulk load completes
      cy.fit(50);
    }

    // Switch to incremental layout strategy
    console.log('[Layout] Switching to incremental layout strategy after bulk load');
    setIsInitialLoad(false);

  }, [cytoscapeRef, markdownFiles, layoutManagerRef, setNodeCount, setEdgeCount, setIsInitialLoad]);

  const handleFileAdded = useCallback((data: { path: string; content?: string }) => {
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

    // Store file content using fullPath (absolute path) for save operations
    markdownFiles.current.set(data.fullPath, data.content);
    console.log('[DEBUG] Added file to markdownFiles, new count:', markdownFiles.current.size);

    // Parse wikilinks to get linked node IDs
    const linkedNodeIds: string[] = [];
    const linkMatches = data.content.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of linkMatches) {
      const targetId = normalizeFileId(match[1]);
      linkedNodeIds.push(targetId);
    }

    // Add node if it doesn't exist
    const nodeId = normalizeFileId(data.path);
    const isNewNode = !cy.getElementById(nodeId).length;

    if (isNewNode) {
      // Use first wikilink as parent for tree structure
      const parentId = linkedNodeIds.length > 0 ? linkedNodeIds[0] : undefined;

      const addedNode = cy.add({
        data: {
          id: nodeId,
          label: nodeId.replace(/_/g, ' '),
          linkedNodeIds,
          parentId
        }
      });

      // If there was a previous new node, add a 10s timeout to it
      if (lastNewNodeIdRef.current) {
        const prevNode = cy.getElementById(lastNewNodeIdRef.current);
        if (prevNode.length > 0 && prevNode.data('breathingActive')) {
          cytoscapeRef.current?.setAnimationTimeout(prevNode, 10000);
        }
      }

      // Trigger breathing animation for new node (no timeout)
      cytoscapeRef.current?.animateNewNode(addedNode);

      // Track this as the last new node
      lastNewNodeIdRef.current = nodeId;
    } else {
      // Update linkedNodeIds for existing node
      cy.getElementById(nodeId).data('linkedNodeIds', linkedNodeIds);
    }

    // Create target nodes and edges
    for (const targetId of linkedNodeIds) {
      // Ensure target node exists (create placeholder if needed)
      if (!cy.getElementById(targetId).length) {
        cy.add({
          data: {
            id: targetId,
            label: targetId.replace(/_/g, ' '),
            linkedNodeIds: []
          }
        });
      }

      const edgeId = `${nodeId}->${targetId}`;

      // Add edge if it doesn't exist
      if (!cy.getElementById(edgeId).length) {
        cy.add({
          data: {
            id: edgeId,
            source: nodeId,
            target: targetId
          }
        });
      }
    }

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    // Apply layout using appropriate strategy
    // During initial load, skip individual layouts - we'll do bulk layout on scan complete
    if (layoutManagerRef.current && isNewNode && !isInitialLoad) {
      layoutManagerRef.current.applyLayout(cy, [nodeId]);
    }
  }, [cytoscapeRef, markdownFiles, layoutManagerRef, isInitialLoad, setNodeCount, setEdgeCount]);

  const handleFileChanged = useCallback((data: { path: string; content?: string }) => {
    if (!data.path.endsWith('.md') || !data.content) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Update stored content using fullPath (absolute path) for save operations
    markdownFiles.current.set(data.fullPath, data.content);

    const nodeId = normalizeFileId(data.path);

    // Remove old edges from this node
    cy.edges(`[source = "${nodeId}"]`).remove();

    // Parse wikilinks to get updated linked node IDs
    const linkedNodeIds: string[] = [];
    const linkMatches = data.content.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of linkMatches) {
      const targetId = normalizeFileId(match[1]);
      linkedNodeIds.push(targetId);

      // Ensure target node exists (create placeholder if needed)
      if (!cy.getElementById(targetId).length) {
        cy.add({
          data: {
            id: targetId,
            label: targetId.replace(/_/g, ' '),
            linkedNodeIds: []
          }
        });
      }

      const edgeId = `${nodeId}->${targetId}`;

      cy.add({
        data: {
          id: edgeId,
          source: nodeId,
          target: targetId
        }
      });
    }

    // Update linkedNodeIds for changed node
    const changedNode = cy.getElementById(nodeId);
    changedNode.data('linkedNodeIds', linkedNodeIds);

    // Trigger breathing animation for appended content (only once per node)
    // Only trigger if not already triggered to prevent re-triggering on every file change
    if (!changedNode.data('appendAnimationTriggered')) {
      changedNode.data('appendAnimationTriggered', true);
      cytoscapeRef.current?.animateAppendedContent(changedNode);
    }

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    // For file changes during incremental mode, apply layout
    if (layoutManagerRef.current && !isInitialLoad) {
      layoutManagerRef.current.applyLayout(cy, [nodeId]);
    }

    // TODO: Implement external file change sync to open editors
    // The old React Context-based system has been removed.
    // Need to implement sync via the Cytoscape extension system.
  }, [cytoscapeRef, markdownFiles, layoutManagerRef, isInitialLoad, setNodeCount, setEdgeCount]);

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
