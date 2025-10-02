import { useState, useEffect, useRef, useCallback } from "react";
// Removed voice-related imports - this component should only handle graph visualization
// Removed Token import - not needed for graph visualization
import SpeedDialMenu from "./speed-dial-menu";
import { CytoscapeCore } from "@/graph-core";
import { useFloatingWindows } from '@/components/floating-windows/hooks/useFloatingWindows';
import { FloatingWindowContainer } from '@/components/floating-windows/FloatingWindowContainer';
import { toScreenCoords, toGraphCoords } from '@/utils/coordinate-conversions';
import { LayoutManager, SeedParkRelaxStrategy, ReingoldTilfordStrategy } from '@/graph-core/graphviz/layout';
// Import graph styles
import '@/graph-core/styles/graph.css';

interface HistoryEntry {
  id: string;
  text: string;
  timestamp: Date;
  source: 'speech' | 'text';
}

const MAX_HISTORY_ENTRIES = 50;
const HISTORY_STORAGE_KEY = 'voicetree-history';

interface VoiceTreeGraphVizLayoutProps {
  // File watching controls from parent
  isWatching?: boolean;
  isLoading?: boolean;
  watchDirectory?: string;
  error?: string | null;
  startWatching?: () => Promise<void>;
  stopWatching?: () => Promise<void>;
  clearError?: () => void;
}

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function VoiceTreeGraphVizLayout(_props: VoiceTreeGraphVizLayoutProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  // REMOVED: lastSentText ref - not needed without voice transcription logic
  const cytoscapeRef = useRef<CytoscapeCore | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markdownFiles = useRef<Map<string, string>>(new Map());
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const { openWindow, windows, updateWindowContent, updateWindowGraphOffset } = useFloatingWindows();
  const openWindowRef = useRef(openWindow);
  const windowsRef = useRef(windows);

  // Track whether we're in initial bulk load phase or incremental phase
  // During initial scan: use ReingoldTilfordStrategy for hierarchical layout
  // After initial scan: use SeedParkRelaxStrategy for incremental additions
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Layout manager for positioning nodes
  const layoutManagerRef = useRef<LayoutManager | null>(null);

  // Track last new node for animation timeout management
  const lastNewNodeIdRef = useRef<string | null>(null);

  // Initialize layout manager with appropriate strategy
  useEffect(() => {
    const strategy = isInitialLoad ? new ReingoldTilfordStrategy() : new SeedParkRelaxStrategy();
    layoutManagerRef.current = new LayoutManager(strategy);
    console.log(`[Layout] Strategy changed to: ${strategy.name} (isInitialLoad=${isInitialLoad})`);
  }, [isInitialLoad]);

  // Note: We now use useFloatingWindows context as the single source of truth for window state
  // No duplicate openEditors state needed

  // Ref to store the position update callback from FloatingWindowContainer
  const positionUpdateCallbackRef = useRef<((positionUpdates: Map<string, { x: number; y: number }>) => void) | null>(null);

  // RAF throttling for position updates
  const rafIdRef = useRef<number | null>(null);

  // REMOVED: Voice transcription logic
  // This component should only handle graph visualization
  // Voice transcription is handled by VoiceTreeTranscribe component

  // Update refs when values change
  useEffect(() => {
    openWindowRef.current = openWindow;
  }, [openWindow]);

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);



  // Function to update positions of all open editors based on their node positions
  const updateEditorPositions = useCallback(() => {
    if (!positionUpdateCallbackRef.current || !cytoscapeRef.current) {
      console.log('[DEBUG] updateEditorPositions early return - no callback or cy');
      return;
    }

    const cy = cytoscapeRef.current.getCore();
    const positionUpdates = new Map<string, { x: number; y: number }>();

    // console.log('[DEBUG] Windows to update:', windowsRef.current.length);

    // Use actual windows from context instead of duplicate openEditorsRef
    for (const window of windowsRef.current) {
      // Update position for any window with graph coordinates (not just editors)
      if (window.nodeId && window.graphAnchor) {
          const graphX = window.graphAnchor.x + (window.graphOffset?.x || 0);
          const graphY = window.graphAnchor.y + (window.graphOffset?.y || 0);
          const screenPos = toScreenCoords(graphX, graphY, cy);
          // console.log(`[DEBUG] Window ${window.nodeId}: graph(${graphX},${graphY}) -> screen(${screenPos.x},${screenPos.y})`);
          positionUpdates.set(window.nodeId, screenPos);
      } else if (window.nodeId) {
        // Fallback to old behavior for backward compatibility (windows without graph coordinates)
        const node = cy.getElementById(window.nodeId);
        if (node.length > 0) {
          const renderedPos = node.renderedPosition();
          positionUpdates.set(window.nodeId, {
            x: renderedPos.x - 50,
            y: renderedPos.y - 50
          });
        }
      }
    }

    if (positionUpdates.size > 0) {
      // console.log('[DEBUG] Calling position update callback with', positionUpdates.size, 'updates');
      positionUpdateCallbackRef.current(positionUpdates);
    } else {
      // console.log('[DEBUG] No position updates to send');
    }
  }, []);

  // Throttled version using requestAnimationFrame
  const throttledUpdateEditorPositions = useCallback(() => {
    // console.log('[DEBUG] throttledUpdateEditorPositions called');
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      // console.log('[DEBUG] RAF executing updateEditorPositions');
      updateEditorPositions();
      rafIdRef.current = null;
    });
  }, [updateEditorPositions]);

  // Callback to register the position update function from FloatingWindowContainer
  const handlePositionUpdateCallback = useCallback((callback: (positionUpdates: Map<string, { x: number; y: number }>) => void) => {
    positionUpdateCallbackRef.current = callback;
  }, []);

  // Handle window drag to update graph offset
  const handleWindowDragStop = useCallback((windowId: string, screenPosition: { x: number; y: number }) => {
    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    const window = windows.find(w => w.id === windowId);
    if (!window || !window.graphAnchor) return;

    // Convert screen position to graph coordinates
    const graphPos = toGraphCoords(screenPosition.x, screenPosition.y, cy);

    // Calculate new offset from anchor
    const newGraphOffset = {
      x: graphPos.x - window.graphAnchor.x,
      y: graphPos.y - window.graphAnchor.y
    };

    // Update the window's graph offset
    updateWindowGraphOffset(windowId, newGraphOffset);
  }, [windows, updateWindowGraphOffset]);


  // Dark mode management
  useEffect(() => {
    const isDark = localStorage.getItem('darkMode') === 'true';
    setIsDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleDarkMode = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);
    localStorage.setItem('darkMode', String(newDarkMode));
    if (newDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Load history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        const historyWithDates = parsed.map((entry: HistoryEntry & { timestamp: string }) => ({
          ...entry,
          timestamp: new Date(entry.timestamp)
        }));
        setHistory(historyWithDates);
      } catch (err) {
        console.warn('Failed to load history from localStorage:', err);
        localStorage.removeItem(HISTORY_STORAGE_KEY);
      }
    }
  }, []);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    if (history.length > 0) {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
  }, [history]);

  // REMOVED: getTranscriptText function
  // Not needed - voice transcription is handled elsewhere

  // Add entry to history with limit management
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addToHistory = useCallback((text: string, source: 'speech' | 'text') => {
    const newEntry: HistoryEntry = {
      id: `${Date.now()}-${Math.random()}`,
      text,
      timestamp: new Date(),
      source
    };

    setHistory(prev => {
      const updated = [...prev, newEntry];
      if (updated.length > MAX_HISTORY_ENTRIES) {
        return updated.slice(updated.length - MAX_HISTORY_ENTRIES);
      }
      return updated;
    });
  }, []);

  // Clear all history
  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  };

  // REMOVED: sendToVoiceTree function
  // Text sending to backend should be handled by VoiceTreeTranscribe component
  // This component should focus only on graph visualization

  // File event handlers
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

    // Store file content
    markdownFiles.current.set(data.path, data.content);
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
      const addedNode = cy.add({
        data: {
          id: nodeId,
          label: nodeId.replace(/_/g, ' '),
          linkedNodeIds
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
  }, [isInitialLoad]);

  const handleFileChanged = useCallback((data: { path: string; content?: string }) => {
    if (!data.path.endsWith('.md') || !data.content) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Update stored content
    markdownFiles.current.set(data.path, data.content);

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

    // Trigger breathing animation for appended content
    cytoscapeRef.current?.animateAppendedContent(changedNode);

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    // For file changes during incremental mode, apply layout
    if (layoutManagerRef.current && !isInitialLoad) {
      layoutManagerRef.current.applyLayout(cy, [nodeId]);
    }

    // Update any open editors for this file
    const window = windows.find(w => w.nodeId === nodeId);
    if (window) {
      console.log(`VoiceTreeGraphVizLayout: Updating editor content for node ${nodeId} due to external file change`);
      updateWindowContent(window.id, data.content);
    }
  }, [windows, updateWindowContent, isInitialLoad]);

  const handleFileDeleted = useCallback((data: { path: string }) => {
    if (!data.path.endsWith('.md')) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Remove from stored files
    markdownFiles.current.delete(data.path);

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
  }, []);

  // Handle watching stopped - clear everything (stable callback)
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
  }, []);

  // Handle initial scan complete - switch to incremental mode
  const handleInitialScanComplete = useCallback(() => {
    console.log('[Layout] Initial scan complete - applying bulk layout to all nodes');

    const cy = cytoscapeRef.current?.getCore();
    if (cy && layoutManagerRef.current) {
      // Get all node IDs for bulk layout
      const allNodeIds = cy.nodes().map(n => n.id());
      console.log(`[Layout] Applying ReingoldTilford to ${allNodeIds.length} nodes`);

      // Apply bulk layout to all nodes at once
      if (allNodeIds.length > 0) {
        layoutManagerRef.current.applyLayout(cy, allNodeIds);
      }

      // Fit the graph after bulk load completes
      cy.fit(50);
    }

    // Switch to incremental layout strategy for future additions
    console.log('[Layout] Switching to incremental layout strategy');
    setIsInitialLoad(false);
  }, []);

  // Handle watching started - reset to initial load mode
  const handleWatchingStarted = useCallback(() => {
    console.log('[Layout] Watching started - using bulk load layout strategy');
    setIsInitialLoad(true);
  }, []);

  // Initialize Cytoscape on mount
  useEffect(() => {
    console.log('VoiceTreeGraphVizLayout: Init effect running', {
      hasContainer: !!containerRef.current,
      hasCytoscapeRef: !!cytoscapeRef.current
    });
    if (!containerRef.current || cytoscapeRef.current) return;

    const container = containerRef.current;

    // Prevent page scroll when zooming
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    container.addEventListener('wheel', handleWheel);

    try {
      // Create Cytoscape instance
      cytoscapeRef.current = new CytoscapeCore(container);

      // Expose Cytoscape instance for testing
      const core = cytoscapeRef.current.getCore();
      if (typeof window !== 'undefined') {
        console.log('VoiceTreeGraphVizLayout: Initial cytoscapeInstance set on window');
        (window as unknown as { cytoscapeInstance: CytoscapeCore }).cytoscapeInstance = core;
        // Also expose CytoscapeCore for testing
        (window as unknown as { cytoscapeCore: typeof cytoscapeRef.current }).cytoscapeCore = cytoscapeRef.current;
      }

      // Enable context menu
      cytoscapeRef.current.enableContextMenu({
        onOpenEditor: (nodeId: string) => {
          // Check if already open
          if (windowsRef.current.some(w => w.nodeId === nodeId)) {
            return;
          }

          // Find file path and content for this node
          let content: string | undefined;
          let filePath: string | undefined;
          for (const [path, fileContent] of markdownFiles.current) {
            if (normalizeFileId(path) === nodeId) {
              content = fileContent;
              filePath = path;
              break;
            }
          }

          if (content && filePath) {
            const node = core.getElementById(nodeId);
            if (node.length > 0) {
              const nodeGraphPos = node.position();
              const nodeScreenPos = node.renderedPosition();
              const zoom = core.zoom();

              // Position window below the node, centered horizontally
              const nodeRadius = 40; // Max node size / 2 (conservative estimate)
              const spacing = 10;
              const windowWidth = 700;

              const initialGraphOffset = {
                x: -(windowWidth / 2) / zoom,
                y: (nodeRadius + spacing) / zoom
              };

              openWindowRef.current({
                nodeId,
                title: nodeId,
                type: 'MarkdownEditor',
                content,
                position: { x: nodeScreenPos.x - (windowWidth / 2), y: nodeScreenPos.y + nodeRadius + spacing },
                graphAnchor: nodeGraphPos,
                graphOffset: initialGraphOffset,
                size: { width: 700, height: 500 },
                onSave: async (text: string) => {
                  if (window.electronAPI?.saveFileContent) {
                    const result = await window.electronAPI.saveFileContent(filePath, text);
                    if (!result.success) {
                      throw new Error(result.error || 'Failed to save file');
                    }
                  } else {
                    throw new Error('Save functionality not available');
                  }
                }
              });
            }
          }
        },
        onExpandNode: (node) => {
            console.log("EXPAND DISABLED", node);
            // cytoscapeRef.current?.xpandNode(node);
          // // Trigger layout update
          // core.layout({ name: 'cola', animate: true }).run();
        },
        onCollapseNode: (node) => {
            console.log("COLLAPSE DISABLED", node);
          // cytoscapeRef.current?.collapseNode(node);
          // // Remove connected nodes that aren't connected to other expanded nodes
          // const connectedNodes = node.connectedEdges().connectedNodes();
          // connectedNodes.forEach((connectedNode: cytoscape.NodeSingular) => {
          //   const otherConnections = connectedNode.connectedEdges().connectedNodes('.expanded');
          //   if (otherConnections.length === 1) { // Only connected to this collapsing node
          //     connectedNode.remove();
          //   }
          // });
          // core.layout({ name: 'cola', animate: true }).run();
        },
        onDeleteNode: async (node) => {
          const nodeId = node.id();

          // Find the file path for this node
          let filePath: string | undefined;
          for (const [path] of markdownFiles.current) {
            if (normalizeFileId(path) === nodeId) {
              filePath = path;
              break;
            }
          }

          if (filePath && window.electronAPI?.deleteFile) {
            // Confirm deletion
            if (!confirm(`Are you sure you want to delete "${nodeId}"? This will move the file to trash.`)) {
              return;
            }

            try {
              const result = await window.electronAPI.deleteFile(filePath);
              if (result.success) {
                // Remove from our local state
                markdownFiles.current.delete(filePath);
                // Remove from graph
                cytoscapeRef.current?.hideNode(node);
                setNodeCount(core.nodes().length);
                setEdgeCount(core.edges().length);
              } else {
                console.error('Failed to delete file:', result.error);
                alert(`Failed to delete file: ${result.error}`);
              }
            } catch (error) {
              console.error('Error deleting file:', error);
              alert(`Error deleting file: ${error}`);
            }
          }
        },
        onCopyNodeName: (nodeId: string) => {
          navigator.clipboard.writeText(nodeId);
        },
        onOpenTerminal: (nodeId: string) => {
          // Generate unique terminal ID with node context
          const terminalId = `terminal-${nodeId}-${Date.now()}`;

          // Find the node position to place terminal near it
          const node = core.getElementById(nodeId);
          if (node.length > 0) {
            const nodeGraphPos = node.position(); // Get graph position
            const zoom = core.zoom();

            // Position window below the node, centered horizontally
            const nodeRadius = 40; // Max node size / 2 (conservative estimate)
            const spacing = 10;
            const windowWidth = 800;

            const initialGraphOffset = {
              x: -(windowWidth / 2) / zoom,
              y: (nodeRadius + spacing) / zoom
            };

            // Calculate initial screen position using toScreenCoords to match future updates
            const graphX = nodeGraphPos.x + initialGraphOffset.x;
            const graphY = nodeGraphPos.y + initialGraphOffset.y;
            const initialScreenPos = toScreenCoords(graphX, graphY, core);

            openWindowRef.current({
              nodeId: terminalId,
              title: `Terminal - ${nodeId}`,
              type: 'Terminal',
              content: '',
              position: initialScreenPos,
              graphAnchor: nodeGraphPos,  // Store node position in graph coords
              graphOffset: initialGraphOffset,  // Store initial offset in graph coords
              size: { width: 800, height: 400 }
            });
          } else {
            // Fallback if node not found
            openWindowRef.current({
              nodeId: terminalId,
              title: `Terminal - ${nodeId}`,
              type: 'Terminal',
              content: '',
              position: { x: 150, y: 150 },
              size: { width: 800, height: 400 }
            });
          }
        }
      });

      // Add event listener for tapping on a node
      core.on('tap', 'node', (event) => {
        const nodeId = event.target.id();

        // Check using actual window state, not duplicate
        if (windowsRef.current.some(w => w.nodeId === nodeId)) {
          return; // Already open
        }

        // Find file path and content for this node
        let content: string | undefined;
        let filePath: string | undefined;
        for (const [path, fileContent] of markdownFiles.current) {
          if (normalizeFileId(path) === nodeId) {
            content = fileContent;
            filePath = path;
            break;
          }
        }

        if (content && filePath) {
          const nodeGraphPos = event.target.position(); // Get graph position
          const cy = event.cy;
          const zoom = cy.zoom();

          // Position window below the node, centered horizontally
          const nodeRadius = 40; // Max node size / 2 (conservative estimate)
          const spacing = 10;
          const windowWidth = 700;

          const initialGraphOffset = {
            x: -(windowWidth / 2) / zoom,
            y: (nodeRadius + spacing) / zoom
          };

          // Calculate initial screen position using toScreenCoords to match future updates
          const graphX = nodeGraphPos.x + initialGraphOffset.x;
          const graphY = nodeGraphPos.y + initialGraphOffset.y;
          const initialScreenPos = toScreenCoords(graphX, graphY, cy);

          openWindowRef.current({
            nodeId,
            title: nodeId,
            type: 'MarkdownEditor',
            content,
            position: initialScreenPos,
            graphAnchor: nodeGraphPos,  // Store node position in graph coords
            graphOffset: initialGraphOffset,  // Store initial offset in graph coords
            size: { width: 700, height: 500 },
            onSave: async (text: string) => {
              if (window.electronAPI?.saveFileContent) {
                const result = await window.electronAPI.saveFileContent(filePath, text);
                if (!result.success) {
                  throw new Error(result.error || 'Failed to save file');
                }
              } else {
                throw new Error('Save functionality not available');
              }
            }
          });
        }
      });

      // Add viewport event listeners for positioning bridge
      core.on('pan zoom resize', throttledUpdateEditorPositions);

    } catch (error) {
      console.error('Failed to initialize Cytoscape:', error);
    }

    // Cleanup function
    return () => {
      console.log('VoiceTreeGraphVizLayout: Cleanup running, destroying Cytoscape');
      container.removeEventListener('wheel', handleWheel);

      // Clean up RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (cytoscapeRef.current) {
        cytoscapeRef.current.destroy();
        cytoscapeRef.current = null;
      }
    };
  }, [throttledUpdateEditorPositions]); // Include the throttled function in deps

  // Set up file event listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    // Set up event listeners
    console.log('VoiceTreeGraphVizLayout: Setting up file event listeners');
    window.electronAPI.onFileAdded(handleFileAdded);
    window.electronAPI.onFileChanged(handleFileChanged);
    window.electronAPI.onFileDeleted(handleFileDeleted);
    window.electronAPI.onFileWatchingStopped(handleWatchingStopped);

    // Expose handlers for testing
    (window as unknown as { testHandlers: { handleFileAdded: typeof handleFileAdded; handleFileChanged: typeof handleFileChanged; handleFileDeleted: typeof handleFileDeleted } }).testHandlers = {
      handleFileAdded,
      handleFileChanged,
      handleFileDeleted
    };

    // Set up layout strategy event listeners
    if (window.electronAPI.onInitialScanComplete) {
      window.electronAPI.onInitialScanComplete(handleInitialScanComplete);
    }
    if (window.electronAPI.onWatchingStarted) {
      window.electronAPI.onWatchingStarted(handleWatchingStarted);
    }

    return () => {
      // Cleanup listeners
      console.log('[DEBUG] VoiceTreeGraphVizLayout: Cleaning up file event listeners');
      window.electronAPI!.removeAllListeners('file-added');
      window.electronAPI!.removeAllListeners('file-changed');
      window.electronAPI!.removeAllListeners('file-deleted');
      window.electronAPI!.removeAllListeners('file-watching-stopped');
      if (window.electronAPI!.onInitialScanComplete) {
        window.electronAPI!.removeAllListeners('initial-scan-complete');
      }
      if (window.electronAPI!.onWatchingStarted) {
        window.electronAPI!.removeAllListeners('watching-started');
      }
    };
  }, [handleFileAdded, handleFileChanged, handleFileDeleted, handleWatchingStopped, handleInitialScanComplete, handleWatchingStarted]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (cytoscapeRef.current) {
        const core = cytoscapeRef.current.getCore();
        core.resize();
        core.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // REMOVED: Duplicate sending of final tokens to server
  // This was causing duplicate text to be sent to the backend
  // VoiceTreeTranscribe component already handles sending transcriptions
  // useEffect(() => {
  //   const currentText = getTranscriptText(finalTokens);
  //   if (currentText && currentText !== lastSentText.current) {
  //     sendToVoiceTree(currentText, 'speech');
  //   }
  // }, [finalTokens, sendToVoiceTree]);

  return (
    <div className="h-screen bg-background overflow-hidden relative">
      {/* Hamburger Menu Button - Top Left */}
      <button
        onClick={() => {
          // Trigger sidebar open - will need to pass this up or use context
          const event = new CustomEvent('toggleSidebar');
          window.dispatchEvent(event);
        }}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg hover:bg-accent transition-colors"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>


      {/* Main Canvas Area with Cytoscape.js Graph */}
      <div className="h-full relative">
        {/* Graph container */}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{
            opacity: cytoscapeRef.current ? 1 : 0.3,
            transition: 'opacity 0.3s ease-in-out'
          }}
        />

        {/* Empty state overlay */}
        {(nodeCount === 0) && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none">
            <div className="text-center">
              <svg
                className="w-24 h-24 mx-auto mb-4 opacity-20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              >
                <circle cx="12" cy="12" r="3" />
                <circle cx="6" cy="6" r="2" />
                <circle cx="18" cy="6" r="2" />
                <circle cx="6" cy="18" r="2" />
                <circle cx="18" cy="18" r="2" />
                <path d="M12 9 L6 6" />
                <path d="M12 9 L18 6" />
                <path d="M12 15 L6 18" />
                <path d="M12 15 L18 18" />
              </svg>
              <p className="text-sm">Graph visualization will appear here</p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                Use "Open Folder" to watch markdown files live
              </p>
              <p className="text-xs text-muted-foreground/60">Powered by Cytoscape.js</p>
            </div>
          </div>
        )}

        {/* Graph info overlay (bottom right) */}
        {nodeCount > 0 && (
          <div className="absolute bottom-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-muted-foreground pointer-events-none">
            {nodeCount} nodes • {edgeCount} edges
          </div>
        )}
      </div>

      {/* Floating Window Container - Renders on top of everything */}
      <FloatingWindowContainer
        onPositionUpdateCallback={handlePositionUpdateCallback}
        onDragStop={handleWindowDragStop}
      />

      {/* Speed Dial Menu */}
      <SpeedDialMenu
        onToggleDarkMode={toggleDarkMode}
        onClearHistory={clearHistory}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}