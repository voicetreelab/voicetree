import { useState, useEffect, useRef, useCallback } from "react";
import useVoiceTreeClient from "@/hooks/useVoiceTreeClient";
import getAPIKey from "@/utils/get-api-key";
import { type Token } from "@soniox/speech-to-text-web";
import SpeedDialMenu from "./speed-dial-menu";
import { CytoscapeCore } from "@/graph-core";
import { DEFAULT_NODE_COLOR, DEFAULT_EDGE_COLOR, HOVER_COLOR } from "@/graph-core/constants";
import cytoscape from 'cytoscape';
import { useFloatingWindows } from '@/components/floating-windows/hooks/useFloatingWindows';
import { FloatingWindowContainer } from '@/components/floating-windows/FloatingWindowContainer';
// @ts-expect-error - cytoscape-cola doesn't have proper TypeScript definitions
import cola from 'cytoscape-cola';

// Register cola extension with cytoscape
cytoscape.use(cola);

interface HistoryEntry {
  id: string;
  text: string;
  timestamp: Date;
  source: 'speech' | 'text';
}

const MAX_HISTORY_ENTRIES = 50;
const HISTORY_STORAGE_KEY = 'voicetree-history';

interface VoiceTreeLayoutProps {
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

// Get Cytoscape stylesheet
function getCytoscapeStylesheet() {
  return [
    {
      selector: 'node',
      style: {
        'background-color': DEFAULT_NODE_COLOR,
        'label': 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': 120,
        'text-valign': 'center',
        'text-halign': 'center',
        'color': '#ffffff',
        'font-size': '12px',
        'font-weight': 'bold',
        'width': 60,
        'height': 60,
        'overlay-opacity': 0
      } as cytoscape.Css.Node
    },
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': DEFAULT_EDGE_COLOR,
        'target-arrow-color': DEFAULT_EDGE_COLOR,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.8
      } as cytoscape.Css.Edge
    },
    {
      selector: 'node.hover',
      style: {
        'background-color': HOVER_COLOR,
        'transition-property': 'background-color',
        'transition-duration': '0.2s'
      } as cytoscape.Css.Node
    },
    {
      selector: 'node.unhover',
      style: {
        'opacity': 0.3
      } as cytoscape.Css.Node
    },
    {
      selector: 'edge.connected-hover',
      style: {
        'line-color': HOVER_COLOR,
        'target-arrow-color': HOVER_COLOR,
        'opacity': 1.0
      } as cytoscape.Css.Edge
    }
  ] as cytoscape.Stylesheet[];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function VoiceTreeLayout(_props: VoiceTreeLayoutProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const lastSentText = useRef<string>("");
  const cytoscapeRef = useRef<CytoscapeCore | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markdownFiles = useRef<Map<string, string>>(new Map());
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const { openWindow, windows, closeWindow, updateWindowContent } = useFloatingWindows();
  const openWindowRef = useRef(openWindow);

  // State management for tracking open editors
  const [openEditors, setOpenEditors] = useState<Map<string, {
    windowId: string;
    nodeId: string;
    filePath: string;
    content: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>>(new Map());
  const openEditorsRef = useRef(openEditors);

  // Ref to store the position update callback from FloatingWindowContainer
  const positionUpdateCallbackRef = useRef<((positionUpdates: Map<string, { x: number; y: number }>) => void) | null>(null);

  // RAF throttling for position updates
  const rafIdRef = useRef<number | null>(null);

  const {
    finalTokens,
  } = useVoiceTreeClient({
    apiKey: getAPIKey,
  });

  // Update ref when openWindow changes
  useEffect(() => {
    openWindowRef.current = openWindow;
  }, [openWindow]);

  // Update ref when openEditors changes
  useEffect(() => {
    openEditorsRef.current = openEditors;
  }, [openEditors]);

  // Helper functions for editor state management
  const getOpenEditorInfo = useCallback((nodeId: string) => {
    return openEditors.get(nodeId);
  }, [openEditors]);

  const getOpenEditorCount = useCallback(() => {
    return openEditors.size;
  }, [openEditors]);

  const getAllOpenEditors = useCallback(() => {
    return Array.from(openEditors.values());
  }, [openEditors]);

  const isEditorOpen = useCallback((nodeId: string) => {
    return openEditors.has(nodeId);
  }, [openEditors]);

  // Function to update positions of all open editors based on their node positions
  const updateEditorPositions = useCallback(() => {
    if (!positionUpdateCallbackRef.current || !cytoscapeRef.current) {
      return;
    }

    const cy = cytoscapeRef.current.getCore();
    const positionUpdates = new Map<string, { x: number; y: number }>();

    // Get current positions for all open editors
    for (const [nodeId] of openEditorsRef.current) {
      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        const renderedPos = node.renderedPosition();
        // Position the editor slightly offset from the node
        positionUpdates.set(nodeId, {
          x: renderedPos.x - 50,
          y: renderedPos.y - 50
        });
      }
    }

    if (positionUpdates.size > 0) {
      positionUpdateCallbackRef.current(positionUpdates);
    }
  }, []);

  // Throttled version using requestAnimationFrame
  const throttledUpdateEditorPositions = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      updateEditorPositions();
      rafIdRef.current = null;
    });
  }, [updateEditorPositions]);

  // Callback to register the position update function from FloatingWindowContainer
  const handlePositionUpdateCallback = useCallback((callback: (positionUpdates: Map<string, { x: number; y: number }>) => void) => {
    positionUpdateCallbackRef.current = callback;
  }, []);

  // Sync openEditors state with floating windows state
  useEffect(() => {
    setOpenEditors(prev => {
      const newMap = new Map(prev);
      let hasChanges = false;

      // Remove editors for windows that have been closed
      for (const [nodeId, editorInfo] of prev) {
        const windowExists = windows.some(w => w.nodeId === nodeId);
        if (!windowExists) {
          newMap.delete(nodeId);
          hasChanges = true;
          console.log(`VoiceTreeLayout: Editor closed for node ${nodeId}, remaining editors: ${newMap.size}`);
        }
      }

      // Update positions and content for existing windows
      for (const window of windows) {
        if (window.type === 'MarkdownEditor' && newMap.has(window.nodeId)) {
          const editorInfo = newMap.get(window.nodeId)!;
          newMap.set(window.nodeId, {
            ...editorInfo,
            position: window.position,
            size: window.size,
            content: window.content
          });
          hasChanges = true;
        }
      }

      if (hasChanges) {
        console.log(`VoiceTreeLayout: Editor state synced, total open editors: ${newMap.size}`);
      }

      return newMap;
    });
  }, [windows]);

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

  // Extract text from tokens for display
  const getTranscriptText = (tokens: Token[]): string => {
    return tokens
      .filter(token => token.text !== "<end>")
      .map(token => token.text)
      .join("");
  };

  // Add entry to history with limit management
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

  // Send text to VoiceTree
  const sendToVoiceTree = useCallback(async (text: string, source: 'speech' | 'text' = 'text') => {
    if (!text.trim() || text === lastSentText.current) return;

    lastSentText.current = text;

    // Always add to history, regardless of server status
    addToHistory(text, source);

    try {
      const response = await fetch("http://localhost:8000/send-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        await response.json(); // Server response handled but result not used to avoid warnings
      } else {
        console.error(`Server error: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error("Error sending to VoiceTree:", err);
      console.error("Cannot connect to VoiceTree server (http://localhost:8000)");
    }
  }, [addToHistory]);

  // File event handlers
  const handleFileAdded = useCallback((data: { path: string; content?: string }) => {
    if (!data.path.endsWith('.md') || !data.content) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Store file content
    markdownFiles.current.set(data.path, data.content);

    // Add node if it doesn't exist
    const nodeId = normalizeFileId(data.path);
    if (!cy.getElementById(nodeId).length) {
      cy.add({
        data: {
          id: nodeId,
          label: nodeId.replace(/_/g, ' ')
        }
      });
    }

    // Parse and add edges
    const linkMatches = data.content.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of linkMatches) {
      const targetId = normalizeFileId(match[1]);
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

    // Run layout
    cy.layout({ name: 'cola', animate: true }).run();

    // Update window reference for tests
    if (typeof window !== 'undefined') {
      (window as any).cytoscapeInstance = cy;
      (window as any).voiceTreeEditorState = {
        getOpenEditors: () => openEditors,
        getOpenEditorCount: () => openEditors.size,
        getAllOpenEditors: () => Array.from(openEditors.values()),
        isEditorOpen: (nodeId: string) => openEditors.has(nodeId)
      };
    }
  }, []);

  const handleFileChanged = useCallback((data: { path: string; content?: string }) => {
    if (!data.path.endsWith('.md') || !data.content) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Update stored content
    markdownFiles.current.set(data.path, data.content);

    const nodeId = normalizeFileId(data.path);

    // Remove old edges from this node
    cy.edges(`[source = "${nodeId}"]`).remove();

    // Parse and add new edges
    const linkMatches = data.content.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of linkMatches) {
      const targetId = normalizeFileId(match[1]);
      const edgeId = `${nodeId}->${targetId}`;

      cy.add({
        data: {
          id: edgeId,
          source: nodeId,
          target: targetId
        }
      });
    }

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    // Run layout
    cy.layout({ name: 'cola', animate: true }).run();

    // Update any open editors for this file
    const editorInfo = openEditorsRef.current.get(nodeId);
    if (editorInfo) {
      console.log(`VoiceTreeLayout: Updating editor content for node ${nodeId} due to external file change`);

      // Find the corresponding window and update its content
      const window = windows.find(w => w.nodeId === nodeId);
      if (window) {
        updateWindowContent(window.id, data.content);

        // Also update the openEditors state to keep it in sync
        setOpenEditors(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(nodeId);
          if (existing) {
            newMap.set(nodeId, {
              ...existing,
              content: data.content
            });
          }
          return newMap;
        });
      }
    }
  }, [windows, updateWindowContent]);

  const handleFileDeleted = useCallback((data: { path: string }) => {
    if (!data.path.endsWith('.md')) return;

    const cy = cytoscapeRef.current?.getCore();
    if (!cy) return;

    // Remove from stored files
    markdownFiles.current.delete(data.path);

    // Remove node and its edges
    const nodeId = normalizeFileId(data.path);
    cy.getElementById(nodeId).remove();

    // Update counts
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    // Run layout
    if (cy.nodes().length > 0) {
      cy.layout({ name: 'cola', animate: true }).run();
    }
  }, []);

  // Initialize Cytoscape on mount
  useEffect(() => {
    console.log('VoiceTreeLayout: Init effect running', {
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
        console.log('VoiceTreeLayout: Initial cytoscapeInstance set on window');
        (window as any).cytoscapeInstance = core;
      }

      // Apply stylesheet
      core.style(getCytoscapeStylesheet());

      // Add event listener for tapping on a node
      core.on('tap', 'node', (event) => {
        const nodeId = event.target.id();

        // Check if editor is already open for this node
        if (openEditorsRef.current.has(nodeId)) {
          // Editor already open, no need to open another
          return;
        }

        // Look up by full path that matches the nodeId
        let content: string | undefined;
        let filePath: string | undefined;
        for (const [path, fileContent] of markdownFiles.current) {
          if (normalizeFileId(path) === nodeId) {
            content = fileContent;
            filePath = path;
            break;
          }
        }

        if (typeof content !== 'undefined' && filePath) {
          // Get the node's rendered position
          const nodePosition = event.target.renderedPosition();
          const position = { x: nodePosition.x - 50, y: nodePosition.y - 50 };
          const size = { width: 700, height: 500 };

          // Generate a unique window ID
          const windowId = `window_${nodeId}_${Date.now()}`;

          // Create the save callback for this specific file
          const onSave = async (newContent: string) => {
            if (window.electronAPI?.saveFileContent) {
              const result = await window.electronAPI.saveFileContent(filePath, newContent);
              if (!result.success) {
                throw new Error(result.error || 'Failed to save file');
              }
            } else {
              throw new Error('Save functionality not available');
            }
          };

          // Add to our editor tracking state
          setOpenEditors(prev => {
            const newMap = new Map(prev);
            newMap.set(nodeId, {
              windowId,
              nodeId,
              filePath,
              content,
              position,
              size
            });
            console.log(`VoiceTreeLayout: Editor opened for node ${nodeId}, total open editors: ${newMap.size}`);
            return newMap;
          });

          // Open the window through the floating window system
          openWindowRef.current({
            nodeId: nodeId,
            title: nodeId, // Use file path as title
            type: 'MarkdownEditor',
            content: content,
            position,
            size,
            onSave,
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
      console.log('VoiceTreeLayout: Cleanup running, destroying Cytoscape');
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
  }, []); // Empty deps - initialize once

  // Set up file event listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    // Set up event listeners
    console.log('VoiceTreeLayout: Setting up file event listeners');
    window.electronAPI.onFileAdded(handleFileAdded);
    window.electronAPI.onFileChanged(handleFileChanged);
    window.electronAPI.onFileDeleted(handleFileDeleted);

    // Handle watching stopped - clear everything
    const handleWatchingStopped = () => {
      markdownFiles.current.clear();
      const cy = cytoscapeRef.current?.getCore();
      if (cy) {
        cy.elements().remove();
        setNodeCount(0);
        setEdgeCount(0);
      }
    };
    window.electronAPI.onFileWatchingStopped(handleWatchingStopped);

    return () => {
      // Cleanup listeners
      window.electronAPI!.removeAllListeners('file-added');
      window.electronAPI!.removeAllListeners('file-changed');
      window.electronAPI!.removeAllListeners('file-deleted');
      window.electronAPI!.removeAllListeners('file-watching-stopped');
    };
  }, [handleFileAdded, handleFileChanged, handleFileDeleted]);

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

  // Continuously send final tokens to server
  useEffect(() => {
    const currentText = getTranscriptText(finalTokens);
    if (currentText && currentText !== lastSentText.current) {
      sendToVoiceTree(currentText, 'speech');
    }
  }, [finalTokens, sendToVoiceTree]);

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
      <div className="pt-28 h-full relative">
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
      <FloatingWindowContainer onPositionUpdateCallback={handlePositionUpdateCallback} />

      {/* Speed Dial Menu */}
      <SpeedDialMenu
        onToggleDarkMode={toggleDarkMode}
        onClearHistory={clearHistory}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}