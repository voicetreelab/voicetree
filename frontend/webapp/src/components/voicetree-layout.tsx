import { useState, useEffect, useRef, useCallback } from "react";
import useVoiceTreeClient from "@/hooks/useVoiceTreeClient";
import getAPIKey from "@/utils/get-api-key";
import { type Token } from "@soniox/speech-to-text-web";
import SpeedDialMenu from "./speed-dial-menu";
import { type GraphData } from "@/graph-core/data";
import { CytoscapeCore, type NodeDefinition, type EdgeDefinition } from "@/graph-core";
import { DEFAULT_NODE_COLOR, DEFAULT_EDGE_COLOR, HOVER_COLOR } from "@/graph-core/constants";
import cytoscape from 'cytoscape';
// @ts-ignore - cytoscape-cola doesn't have proper TypeScript definitions
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
  graphData?: GraphData | null;
}

// Transform GraphData to Cytoscape format
function transformGraphDataToCytoscape(graphData: GraphData): (NodeDefinition | EdgeDefinition)[] {
  const elements: (NodeDefinition | EdgeDefinition)[] = [];

  // Transform nodes
  graphData.nodes.forEach(node => {
    elements.push({
      data: {
        id: node.data.id,
        label: node.data.label || node.data.id,
        linkedNodeIds: node.data.linkedNodeIds || []
      }
    });
  });

  // Transform edges
  graphData.edges.forEach(edge => {
    elements.push({
      data: {
        id: edge.data.id,
        source: edge.data.source,
        target: edge.data.target
      }
    });
  });

  return elements;
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
      } as any
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
      } as any
    },
    {
      selector: 'node.hover',
      style: {
        'background-color': HOVER_COLOR,
        'transition-property': 'background-color',
        'transition-duration': '0.2s'
      } as any
    },
    {
      selector: 'node.unhover',
      style: {
        'opacity': 0.3
      } as any
    },
    {
      selector: 'edge.connected-hover',
      style: {
        'line-color': HOVER_COLOR,
        'target-arrow-color': HOVER_COLOR,
        'opacity': 1.0
      } as any
    }
  ] as any;
}

export default function VoiceTreeLayout({ graphData }: VoiceTreeLayoutProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const lastSentText = useRef<string>("");
  const cytoscapeRef = useRef<CytoscapeCore | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isGraphInitialized, setIsGraphInitialized] = useState(false);

  const {
    finalTokens,
  } = useVoiceTreeClient({
    apiKey: getAPIKey,
  });

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

  // Initialize Cytoscape when container is ready
  useEffect(() => {
    if (!containerRef.current || isGraphInitialized) return;

    try {
      // Create Cytoscape instance
      cytoscapeRef.current = new CytoscapeCore(containerRef.current);

      // Apply stylesheet
      const core = cytoscapeRef.current.getCore();
      core.style(getCytoscapeStylesheet());

      // Set up default layout options (will be applied when data is added)
      // We don't run layout here since there's no data yet

      setIsGraphInitialized(true);
    } catch (error) {
      console.error('Failed to initialize Cytoscape:', error);
    }

    // Cleanup function
    return () => {
      if (cytoscapeRef.current) {
        cytoscapeRef.current.destroy();
        cytoscapeRef.current = null;
        setIsGraphInitialized(false);
      }
    };
  }, [isGraphInitialized]);

  // Update graph when graphData changes
  useEffect(() => {
    if (!cytoscapeRef.current || !graphData || graphData.nodes.length === 0) {
      return;
    }

    try {
      const core = cytoscapeRef.current.getCore();

      // Clear existing elements
      core.elements().remove();

      // Transform and add new elements
      const elements = transformGraphDataToCytoscape(graphData);
      core.add(elements);

      // Apply layout to new nodes using cola layout
      const layout = core.layout({
        name: 'cola',
        animate: true,
        animationDuration: 1000,
        fit: true,
        padding: 50,
        nodeSpacing: 100,
        edgeLengthVal: 150,
        convergenceThreshold: 0.01
      } as any);
      layout.run();

      // Fit the view after a brief delay to allow layout to settle
      setTimeout(() => {
        cytoscapeRef.current?.fitView();
      }, 500);

    } catch (error) {
      console.error('Failed to update graph:', error);
    }
  }, [graphData]);

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
            opacity: graphData && graphData.nodes.length > 0 ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out'
          }}
        />

        {/* Empty state overlay */}
        {(!graphData || graphData.nodes.length === 0) && (
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
        {graphData && graphData.nodes.length > 0 && (
          <div className="absolute bottom-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-muted-foreground pointer-events-none">
            {graphData.nodes.length} nodes • {graphData.edges.length} edges
          </div>
        )}
      </div>

      {/* Speed Dial Menu */}
      <SpeedDialMenu
        onToggleDarkMode={toggleDarkMode}
        onClearHistory={clearHistory}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}