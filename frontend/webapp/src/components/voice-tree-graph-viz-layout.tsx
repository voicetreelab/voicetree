import { useState, useEffect, useRef, useCallback } from "react";
// Removed voice-related imports - this component should only handle graph visualization
// Removed Token import - not needed for graph visualization
import SpeedDialMenu from "./speed-dial-menu";
import { CytoscapeCore, registerFloatingWindows } from "@/graph-core";
import { useFloatingWindows } from '@/components/floating-windows/hooks/useFloatingWindows';
import { FloatingWindowContainer } from '@/components/floating-windows/FloatingWindowContainer';
import { toScreenCoords, toGraphCoords } from '@/utils/coordinate-conversions';
import { LayoutManager, SeedParkRelaxStrategy, TidyLayoutStrategy } from '@/graph-core/graphviz/layout';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import cytoscape from 'cytoscape';
// Import graph styles
import '@/graph-core/styles/graph.css';

// Register floating windows extension once at module level
registerFloatingWindows(cytoscape);

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

// Helper to open a markdown editor window for a node
interface OpenEditorParams {
  nodeId: string;
  filePath: string;
  content: string;
  nodeGraphPos: { x: number; y: number };
  cy: cytoscape.Core;
  openWindow: (params: {
    nodeId: string;
    title: string;
    type: string;
    content: string;
    position: { x: number; y: number };
    graphAnchor?: { x: number; y: number };
    graphOffset?: { x: number; y: number };
    size: { width: number; height: number };
    onSave?: (text: string) => Promise<void>;
  }) => void;
}

function openMarkdownEditor({ nodeId, filePath, content, nodeGraphPos, cy, openWindow }: OpenEditorParams): void {
  const zoom = cy.zoom();

  // Position window below the node, centered horizontally
  const windowWidth = 700;

  const initialGraphOffset = {
    x: -(windowWidth / 2) / zoom,
    y: 5  // 5 graph units below the node
  };

  // Calculate initial screen position using toScreenCoords to match future updates
  const graphX = nodeGraphPos.x + initialGraphOffset.x;
  const graphY = nodeGraphPos.y + initialGraphOffset.y;
  const screenPos = toScreenCoords(graphX, graphY, cy);

  // Subtract container offset since FloatingWindowContainer is positioned relative to the same parent
  const containerRect = cy.container().getBoundingClientRect();
  const initialScreenPos = {
    x: screenPos.x - containerRect.left,
    y: screenPos.y - containerRect.top
  };

  openWindow({
    nodeId,
    title: nodeId,
    type: 'MarkdownEditor',
    content,
    position: initialScreenPos,
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function VoiceTreeGraphVizLayout(_props: VoiceTreeGraphVizLayoutProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const cytoscapeRef = useRef<CytoscapeCore | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markdownFiles = useRef<Map<string, string>>(new Map());
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const { openWindow, windows, updateWindowContent, updateWindowGraphOffset } = useFloatingWindows();
  const openWindowRef = useRef(openWindow);
  const windowsRef = useRef(windows);

  // Track whether we're in initial bulk load phase or incremental phase
  // During initial scan: use TidyLayoutStrategy for hierarchical layout
  // After initial scan: use SeedParkRelaxStrategy for incremental additions
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Layout manager for positioning nodes
  const layoutManagerRef = useRef<LayoutManager | null>(null);

  // Initialize layout manager with appropriate strategy
  useEffect(() => {
    const strategy = isInitialLoad ? new TidyLayoutStrategy() : new SeedParkRelaxStrategy();
    layoutManagerRef.current = new LayoutManager(strategy);
    console.log(`[Layout] Strategy changed to: ${strategy.name} (isInitialLoad=${isInitialLoad})`);
  }, [isInitialLoad]);

  // File watching event handlers
  const {
    handleBulkFilesAdded,
    handleFileAdded,
    handleFileChanged,
    handleFileDeleted,
    handleWatchingStopped,
    handleWatchingStarted
  } = useFileWatcher({
    cytoscapeRef,
    markdownFiles,
    layoutManagerRef,
    isInitialLoad,
    setNodeCount,
    setEdgeCount,
    setIsInitialLoad,
    windows,
    updateWindowContent
  });

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
    const containerRect = cy.container().getBoundingClientRect();

    // console.log('[DEBUG] Windows to update:', windowsRef.current.length);

    // Use actual windows from context instead of duplicate openEditorsRef
    for (const window of windowsRef.current) {
      // Update position for any window with graph coordinates (not just editors)
      if (window.nodeId && window.graphAnchor) {
          const graphX = window.graphAnchor.x + (window.graphOffset?.x || 0);
          const graphY = window.graphAnchor.y + (window.graphOffset?.y || 0);
          const screenPos = toScreenCoords(graphX, graphY, cy);
          // Subtract container offset since FloatingWindowContainer is positioned relative to the same parent
          const relativePos = {
            x: screenPos.x - containerRect.left,
            y: screenPos.y - containerRect.top
          };
          // console.log(`[DEBUG] Window ${window.nodeId}: graph(${graphX},${graphY}) -> screen(${screenPos.x},${screenPos.y})`);
          positionUpdates.set(window.nodeId, relativePos);
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

    // Convert container-relative position to viewport position, then to graph coordinates
    const containerRect = cy.container().getBoundingClientRect();
    const viewportX = screenPosition.x + containerRect.left;
    const viewportY = screenPosition.y + containerRect.top;
    const graphPos = toGraphCoords(viewportX, viewportY, cy);

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
              openMarkdownEditor({
                nodeId,
                filePath,
                content,
                nodeGraphPos: node.position(),
                cy: core,
                openWindow: openWindowRef.current
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

          // Find the file path for this node
          let filePath: string | undefined;
          for (const [path] of markdownFiles.current) {
            if (normalizeFileId(path) === nodeId) {
              filePath = path;
              break;
            }
          }

          // Build node metadata for terminal environment
          const nodeMetadata = {
            id: nodeId,
            name: nodeId.replace(/_/g, ' '),
            filePath: filePath
          };

          console.log('[Terminal] nodeMetadata:', nodeMetadata);

          // Find the node position to place terminal near it
          const node = core.getElementById(nodeId);
          if (node.length > 0) {
            const nodeGraphPos = node.position(); // Get graph position
            const zoom = core.zoom();

            // Position window below the node, centered horizontally
            const windowWidth = 800;

            const initialGraphOffset = {
              x: -(windowWidth / 2) / zoom,
              y: 5  // 5 graph units below the node
            };

            // Calculate initial screen position using toScreenCoords to match future updates
            const graphX = nodeGraphPos.x + initialGraphOffset.x;
            const graphY = nodeGraphPos.y + initialGraphOffset.y;
            const screenPos = toScreenCoords(graphX, graphY, core);

            // Subtract container offset since FloatingWindowContainer is positioned relative to the same parent
            const containerRect = core.container().getBoundingClientRect();
            const initialScreenPos = {
              x: screenPos.x - containerRect.left,
              y: screenPos.y - containerRect.top
            };

            openWindowRef.current({
              nodeId: terminalId,
              title: `Terminal - ${nodeId}`,
              type: 'Terminal',
              content: '',
              position: initialScreenPos,
              graphAnchor: nodeGraphPos,  // Store node position in graph coords
              graphOffset: initialGraphOffset,  // Store initial offset in graph coords
              size: { width: 800, height: 400 },
              nodeMetadata: nodeMetadata  // Pass node metadata
            });
          } else {
            // Fallback if node not found
            openWindowRef.current({
              nodeId: terminalId,
              title: `Terminal - ${nodeId}`,
              type: 'Terminal',
              content: '',
              position: { x: 150, y: 150 },
              size: { width: 800, height: 400 },
              nodeMetadata: nodeMetadata  // Pass node metadata even in fallback
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
          openMarkdownEditor({
            nodeId,
            filePath,
            content,
            nodeGraphPos: event.target.position(),
            cy: event.cy,
            openWindow: openWindowRef.current
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
    console.log('VoiceTreeGraphVizLayout: Setting up onInitialFilesLoaded listener');
    window.electronAPI.onInitialFilesLoaded(handleBulkFilesAdded);
    console.log('VoiceTreeGraphVizLayout: onInitialFilesLoaded listener registered');
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
    if (window.electronAPI.onWatchingStarted) {
      window.electronAPI.onWatchingStarted(handleWatchingStarted);
    }

    return () => {
      // Cleanup listeners
      console.log('[DEBUG] VoiceTreeGraphVizLayout: Cleaning up file event listeners');
      window.electronAPI!.removeAllListeners('initial-files-loaded');
      window.electronAPI!.removeAllListeners('file-added');
      window.electronAPI!.removeAllListeners('file-changed');
      window.electronAPI!.removeAllListeners('file-deleted');
      window.electronAPI!.removeAllListeners('file-watching-stopped');
      if (window.electronAPI!.onWatchingStarted) {
        window.electronAPI!.removeAllListeners('watching-started');
      }
    };
  }, [handleBulkFilesAdded, handleFileAdded, handleFileChanged, handleFileDeleted, handleWatchingStopped, handleWatchingStarted]);

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
        isDarkMode={isDarkMode}
      />
    </div>
  );
}