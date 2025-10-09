import { useState, useEffect, useRef } from "react";
// Removed voice-related imports - this component should only handle graph visualization
// Removed Token import - not needed for graph visualization
import SpeedDialMenu from "./speed-dial-menu";
import { CytoscapeCore } from "@/graph-core";
import { LayoutManager, IncrementalTidyLayoutStrategy } from '@/graph-core/graphviz/layout';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { StyleService } from '@/graph-core/services/StyleService';
// Import graph styles
import '@/graph-core/styles/graph.css';

// Note: Floating windows extension is registered in @/graph-core/index.ts at module load

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
  const [isDarkMode, setIsDarkMode] = useState(false);
  const cytoscapeRef = useRef<CytoscapeCore | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markdownFiles = useRef<Map<string, string>>(new Map());
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);

  // Store file change handler ref for manual graph updates after save
  const handleFileChangedRef = useRef<((data: { path: string; fullPath: string; content: string }) => void) | null>(null);

  // Track whether we're in initial bulk load phase or incremental phase
  // During initial scan: use TidyLayoutStrategy for hierarchical layout
  // After initial scan: use IncrementalTidyLayoutStrategy for incremental additions
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isInitialLoadRef = useRef(true);

  // Layout manager for positioning nodes
  const layoutManagerRef = useRef<LayoutManager | null>(null);

  // Helper function to create floating editor window
  const createFloatingEditor = (
    nodeId: string,
    filePath: string,
    content: string,
    nodePos: { x: number; y: number },
    cy: CytoscapeCore
  ) => {
    const editorId = `editor-${nodeId}`;

    console.log('[createFloatingEditor] Called for node:', nodeId, 'with cy:', cy);

    // Check if editor window already exists by checking for shadow node
    const existingNodes = cy.getCore().nodes(`#${editorId}`);
    if (existingNodes && existingNodes.length > 0) {
      console.log('[createFloatingEditor] Window already exists for:', editorId);
      return; // Already open
    }

    console.log('[createFloatingEditor] Calling cy.addFloatingWindow for:', editorId);

    try {
      // Use the new extension API
      const shadowNode = cy.addFloatingWindow({
        id: editorId,
        component: 'MarkdownEditor',
        title: `Editor: ${nodeId}`,
        position: {
          x: nodePos.x,
          y: nodePos.y + 50 // Offset below node
        },
        nodeData: {
          isFloatingWindow: true,
          parentNodeId: nodeId
        },
        resizable: true,
        initialContent: content,
        onSave: async (newContent: string) => {
          console.log('[onSave] Called with filePath:', filePath);
          if (window.electronAPI?.saveFileContent) {
            console.log('[onSave] Calling saveFileContent...');
            const result = await window.electronAPI.saveFileContent(filePath, newContent);
            console.log('[onSave] Result:', result);
            if (!result.success) {
              throw new Error(result.error || 'Failed to save file');
            }

            // Manually trigger graph update since file watcher doesn't detect editor saves
            // Call handleFileChanged directly to update the graph
            if (handleFileChangedRef.current) {
              console.log('[onSave] Manually triggering graph update');
              handleFileChangedRef.current({
                path: filePath,
                fullPath: filePath,
                content: newContent
              });
            }
          } else {
            console.error('[onSave] electronAPI.saveFileContent not available!');
            throw new Error('Save functionality not available');
          }
        }
      });
      console.log('[createFloatingEditor] Shadow node created:', shadowNode);

      // Trigger incremental layout for the new shadow node
      if (layoutManagerRef.current && !isInitialLoadRef.current) {
        console.log('[createFloatingEditor] Triggering incremental layout for:', editorId);
        layoutManagerRef.current.applyLayout(cy.getCore(), [editorId]);
      }
    } catch (error) {
      console.error('[createFloatingEditor] Error calling addFloatingWindow:', error);
    }
  };

  // Helper function to create floating terminal window
  const createFloatingTerminal = (
    nodeId: string,
    nodeMetadata: { id: string; name: string; filePath?: string },
    nodePos: { x: number; y: number },
    cy: CytoscapeCore
  ) => {
    const terminalId = `terminal-${nodeId}`;
    console.log('[createFloatingTerminal] Called for node:', nodeId, 'with metadata:', nodeMetadata);

    // Check if terminal window already exists by checking for shadow node
    const existingNodes = cy.getCore().nodes(`#${terminalId}`);
    if (existingNodes && existingNodes.length > 0) {
      console.log('[createFloatingTerminal] Window already exists for:', terminalId);
      return; // Already open
    }

    console.log('[createFloatingTerminal] Calling cy.addFloatingWindow for:', terminalId);
    try {
      // Use the new extension API
      const shadowNode = cy.addFloatingWindow({
        id: terminalId,
        component: 'Terminal',
        title: `Terminal: ${nodeId}`,
        position: {
          x: nodePos.x + 100, // Offset to the right
          y: nodePos.y
        },
        nodeData: {
          isFloatingWindow: true,
          parentNodeId: nodeId
        },
        resizable: true,
        nodeMetadata: nodeMetadata
      });

      console.log('[createFloatingTerminal] Shadow node created:', shadowNode);

      // Trigger incremental layout for the new shadow node
      console.log('[createFloatingTerminal] Layout check - layoutManagerRef.current:', !!layoutManagerRef.current, 'isInitialLoad:', isInitialLoadRef.current);
      if (layoutManagerRef.current && !isInitialLoadRef.current) {
        console.log('[createFloatingTerminal] Triggering incremental layout for:', terminalId);
        layoutManagerRef.current.applyLayout(cy.getCore(), [terminalId]);
      } else {
        console.log('[createFloatingTerminal] Skipping layout - layoutManagerRef:', !!layoutManagerRef.current, 'isInitialLoad:', isInitialLoadRef.current);
      }
    } catch (error) {
      console.error('[createFloatingTerminal] Error calling addFloatingWindow:', error);
    }
  };

  // Initialize layout manager once with incremental strategy (persists state)
  // The same strategy instance is reused for all layouts - cache persists
  useEffect(() => {
    const strategy = new IncrementalTidyLayoutStrategy();
    layoutManagerRef.current = new LayoutManager(strategy);
    console.log('[Layout] LayoutManager initialized with persistent IncrementalTidyLayoutStrategy');
  }, []); // Empty deps - run once only

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
    setIsInitialLoad
  });

  // Store handleFileChanged ref for manual updates after editor saves
  useEffect(() => {
    handleFileChangedRef.current = handleFileChanged;
  }, [handleFileChanged]);

  // Keep isInitialLoadRef in sync with isInitialLoad state
  useEffect(() => {
    isInitialLoadRef.current = isInitialLoad;
  }, [isInitialLoad]);

  // REMOVED: Voice transcription logic
  // This component should only handle graph visualization
  // Voice transcription is handled by VoiceTreeTranscribe component


  // Dark mode management - set DOM class synchronously BEFORE rendering
  useEffect(() => {
    const isDark = localStorage.getItem('darkMode') === 'true';
    // Set DOM class FIRST, before any state updates
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    setIsDarkMode(isDark);
  }, []);

  const toggleDarkMode = () => {
    const newDarkMode = !isDarkMode;
    // Update DOM class FIRST, before state update
    if (newDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    setIsDarkMode(newDarkMode);
    localStorage.setItem('darkMode', String(newDarkMode));
  };

  // Re-apply graph styles when dark mode changes
  useEffect(() => {
    if (!cytoscapeRef.current) return;

    // Recreate StyleService to pick up current DOM dark class state
    const styleService = new StyleService();
    const newStyles = styleService.getCombinedStylesheet();

    // Apply new stylesheet to existing graph
    cytoscapeRef.current.getCore().style(newStyles);
  }, [isDarkMode]);

  // Initialize Cytoscape on mount
  useEffect(() => {
    if (!containerRef.current || cytoscapeRef.current) return;

    const container = containerRef.current;

    // Prevent page scroll when zooming
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    container.addEventListener('wheel', handleWheel);

    try {
      // Create Cytoscape instance
      console.log('[VoiceTreeGraphVizLayout] Creating CytoscapeCore instance');
      cytoscapeRef.current = new CytoscapeCore(container);
      console.log('[VoiceTreeGraphVizLayout] CytoscapeCore created successfully');

      // Expose Cytoscape instance for testing
      const core = cytoscapeRef.current.getCore();
      console.log('[VoiceTreeGraphVizLayout] Got core from CytoscapeCore');
      if (typeof window !== 'undefined') {
        console.log('VoiceTreeGraphVizLayout: Initial cytoscapeInstance set on window');
        (window as unknown as { cytoscapeInstance: cytoscape.Core }).cytoscapeInstance = core;
        // Also expose CytoscapeCore for testing
        (window as unknown as { cytoscapeCore: CytoscapeCore | null }).cytoscapeCore = cytoscapeRef.current;
      }

      // Enable context menu
      console.log('[VoiceTreeGraphVizLayout] About to enable context menu');
      cytoscapeRef.current.enableContextMenu({
        onOpenEditor: (nodeId: string) => {
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

          if (content && filePath && cytoscapeRef.current) {
            const node = core.getElementById(nodeId);
            if (node.length > 0) {
              const nodePos = node.position();
              createFloatingEditor(nodeId, filePath, content, nodePos, cytoscapeRef.current);
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

          // Get node position and create terminal window
          if (cytoscapeRef.current) {
            const core = cytoscapeRef.current.getCore();
            const node = core.getElementById(nodeId);
            if (node.length > 0) {
              const nodePos = node.position();
              createFloatingTerminal(nodeId, nodeMetadata, nodePos, cytoscapeRef.current);
            }
          }
        }
      });

      // Add event listener for tapping on a node
      console.log('[VoiceTreeGraphVizLayout] Registering tap handler for floating windows');
      core.on('tap', 'node', (event) => {
        const nodeId = event.target.id();
        console.log('[VoiceTreeGraphVizLayout] Node tapped:', nodeId);

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

        console.log('[VoiceTreeGraphVizLayout] Found content?', !!content, 'filePath?', !!filePath, 'cytoscapeRef?', !!cytoscapeRef.current);

        if (content && filePath && cytoscapeRef.current) {
          const nodePos = event.target.position();
          console.log('[VoiceTreeGraphVizLayout] Calling createFloatingEditor');
          createFloatingEditor(nodeId, filePath, content, nodePos, cytoscapeRef.current);
        } else {
          console.log('[VoiceTreeGraphVizLayout] Not opening editor - missing requirements');
        }
      });

    } catch (error) {
      console.error('Failed to initialize Cytoscape:', error);
    }

    // Cleanup function
    return () => {
      console.log('VoiceTreeGraphVizLayout: Cleanup running, destroying Cytoscape');
      container.removeEventListener('wheel', handleWheel);

      if (cytoscapeRef.current) {
        cytoscapeRef.current.destroy();
        cytoscapeRef.current = null;
      }
    };
  }, []); // No dependencies needed

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

      {/* Speed Dial Menu */}
      <SpeedDialMenu
        onToggleDarkMode={toggleDarkMode}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}