import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import cytoscape from 'cytoscape';
import MDEditor from '@uiw/react-md-editor';
import { MarkdownParser } from '@/graph-core/data/load_markdown/MarkdownParser';

// Define types for test window
interface TestWindow extends Window {
  electronAPI?: {
    saveFileContent: (filePath: string, content: string) => Promise<void>;
  };
  _test_savedPayload?: unknown;
  _test_logs?: string[];
  testGraphManager?: {
    graphData: { nodes: GraphNode[]; edges: GraphEdge[] };
    parsedNodesMap: Map<string, ParsedNode>;
  };
}

interface GraphNode {
  data: {
    id: string;
    label: string;
    linkedNodeIds: string[];
  };
}

interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
  };
}

interface ParsedNode {
  title?: string;
  links: Array<{ targetFile: string }>;
}

// Mock the electronAPI for the browser-based test
(window as TestWindow).electronAPI = {
  saveFileContent: async (filePath: string, content: string) => {
    console.log('Mock saveFileContent called with:', { filePath, content });
    // Store the payload in a global variable for the test to access
    (window as TestWindow)._test_savedPayload = { filePath, content };
  },
};

// Determine which mode to run based on URL parameter
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'standalone';

// Add test logging
(window as typeof window & { _test_logs: string[] })._test_logs = [];

const StandaloneEditor = () => {
  const [showEditor, setShowEditor] = useState(false);
  const [content, setContent] = useState('# Hello World');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const handleSave = async () => {
    setSaveStatus('saving');
    await ((window as typeof window & { electronAPI?: { saveFileContent: (path: string, content: string) => Promise<void> } }).electronAPI?.saveFileContent('test/file.md', content));
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
  };

  return (
    <div>
      <h1>Editor Test Harness</h1>
      <button onClick={() => setShowEditor(true)} disabled={showEditor}>
        Open Editor
      </button>

      {showEditor && (
        <div
          className="floating-window"
          style={{
            position: 'absolute',
            top: 50,
            left: 50,
            width: 400,
            height: 300,
            border: '1px solid #ccc',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
          }}
        >
          <div
            className="window-title-bar"
            style={{
              padding: '8px 12px',
              backgroundColor: '#f0f0f0',
              borderBottom: '1px solid #ccc',
              cursor: 'move',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>test/file.md</span>
            <button
              onClick={() => setShowEditor(false)}
              style={{ all: 'unset', cursor: 'pointer', fontSize: '16px' }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, padding: '10px', overflow: 'auto' }}>
            <MDEditor
              value={content}
              onChange={(val) => setContent(val || '')}
              height={200}
            />
            <button
              onClick={handleSave}
              style={{ marginTop: '10px' }}
            >
              {saveStatus === 'saving' ? 'Saving...' :
               saveStatus === 'saved' ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const CytoscapeEditor = () => {
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorPosition, setEditorPosition] = useState({ x: 100, y: 100 });
  const [content, setContent] = useState('# Node Content');
  const [currentNodeId, setCurrentNodeId] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const windowOffset = useRef({ x: 0, y: 0 }); // Track offset from node after dragging

  useEffect(() => {
    if (!cyRef.current) return;

    // Initialize Cytoscape
    cyInstance.current = cytoscape({
      container: cyRef.current,
      elements: [
        { data: { id: 'node1', label: 'Test Node' }, position: { x: 200, y: 200 } },
        { data: { id: 'node2', label: 'Another Node' }, position: { x: 400, y: 300 } },
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#666',
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'width': 60,
            'height': 60,
          }
        }
      ],
      layout: { name: 'preset' },
      pan: { x: 0, y: 0 },
      zoom: 1,
    });

    // Handle node clicks
    cyInstance.current.on('tap', 'node', (evt) => {
      const node = evt.target;
      const renderedPos = node.renderedPosition();
      setEditorPosition({ x: renderedPos.x, y: renderedPos.y });
      setContent(`# Content for ${node.id()}`);
      setCurrentNodeId(node.id());
      windowOffset.current = { x: 0, y: 0 }; // Reset offset when opening new window
      setShowEditor(true);
    });

    // Expose cy instance globally for testing
    (window as typeof window & { cy: unknown }).cy = cyInstance.current;

    return () => {
      cyInstance.current?.destroy();
    };
  }, []);

  // Update position when pan/zoom occurs (only if not dragging)
  useEffect(() => {
    if (!cyInstance.current || !showEditor) return;

    const updatePosition = () => {
      if (isDragging) return; // Don't update position while dragging

      const node = cyInstance.current!.$(`#${currentNodeId}`);
      if (node.length > 0) {
        const renderedPos = node.renderedPosition();
        setEditorPosition({
          x: renderedPos.x + windowOffset.current.x,
          y: renderedPos.y + windowOffset.current.y
        });
      }
    };

    cyInstance.current.on('pan zoom resize', updatePosition);

    return () => {
      cyInstance.current?.off('pan zoom resize', updatePosition);
    };
  }, [showEditor, currentNodeId, isDragging]);

  const handleSave = async () => {
    await ((window as typeof window & { electronAPI?: { saveFileContent: (path: string, content: string) => Promise<void> } }).electronAPI?.saveFileContent('test/node.md', content));
  };

  // Handle drag events on the window
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.window-title-bar')) {
      setIsDragging(true);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2
      };
      e.preventDefault();
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setEditorPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y
      });
    };

    const handleMouseUp = () => {
      // Calculate and store the offset from the node
      if (cyInstance.current && currentNodeId) {
        const node = cyInstance.current.$(`#${currentNodeId}`);
        if (node.length > 0) {
          const nodePos = node.renderedPosition();
          windowOffset.current = {
            x: editorPosition.x - nodePos.x,
            y: editorPosition.y - nodePos.y
          };
        }
      }
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, currentNodeId, editorPosition]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <h1 style={{ position: 'absolute', top: 10, left: 10, zIndex: 10 }}>
        Cytoscape Editor Test
      </h1>

      <div
        ref={cyRef}
        style={{ width: '100%', height: '100%' }}
        className="cytoscape-container"
      />

      {showEditor && (
        <div
          className="floating-window"
          data-window-id={currentNodeId}
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            top: editorPosition.y,
            left: editorPosition.x,
            width: 300,
            height: 250,
            border: '1px solid #ccc',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
            transform: 'translate(-50%, -50%)',
            cursor: isDragging ? 'grabbing' : 'default',
          }}
        >
          <div
            className="window-title-bar"
            style={{
              padding: '8px 12px',
              backgroundColor: '#f0f0f0',
              borderBottom: '1px solid #ccc',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'grab',
            }}
          >
            <span>Node Editor</span>
            <button
              onClick={() => setShowEditor(false)}
              aria-label="Close"
              style={{ all: 'unset', cursor: 'pointer', fontSize: '16px' }}
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, padding: '10px', overflow: 'auto' }}>
            <MDEditor
              value={content}
              onChange={(val) => setContent(val || '')}
              height={150}
            />
            <button onClick={handleSave} style={{ marginTop: '10px' }}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Simulate file watcher integration
const FileWatcherEditor = () => {
  const [openEditors, setOpenEditors] = useState<Map<string, {
    windowId: string;
    nodeId: string;
    filePath: string;
    content: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>>(new Map());

  const [windowCounter, setWindowCounter] = useState(0);

  // Mock file content map
  const fileContentMap = useRef<Map<string, string>>(new Map([
    ['test/test.md', '# Old Content'],
    ['test/other.md', '# Other Content']
  ]));

  // Graph state management - simulates useGraphManager functionality
  const [parsedNodesMap, setParsedNodesMap] = useState<Map<string, ParsedNode>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[], edges: GraphEdge[] }>({ nodes: [], edges: [] });

  // Initialize graph data from file content map
  useEffect(() => {
    const initialParsedNodes = new Map();
    for (const [filePath, content] of fileContentMap.current) {
      const parsedNode = MarkdownParser.parseMarkdownFile(content, filePath);
      initialParsedNodes.set(filePath, parsedNode);
    }
    setParsedNodesMap(initialParsedNodes);
  }, []);

  // Transform parsed nodes to graph data (simulates useMemo in useGraphManager)
  useEffect(() => {
    const testLogs = (window as TestWindow)._test_logs || [];
    testLogs.push(`Transforming parsed nodes to graph data, node count: ${parsedNodesMap.size}`);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const [filePath, parsedNode] of parsedNodesMap) {
      const linkedNodeIds: string[] = [];

      // Create edges from the parsed links
      for (const link of parsedNode.links) {
        linkedNodeIds.push(link.targetFile);
        edges.push({
          data: {
            id: `${filePath}->${link.targetFile}`,
            source: filePath,
            target: link.targetFile
          }
        });
      }

      // Create node with parsed data
      nodes.push({
        data: {
          id: filePath,
          label: parsedNode.title || filePath.replace('.md', '').replace(/_/g, ' '),
          linkedNodeIds
        }
      });
    }

    const newGraphData = { nodes, edges };
    setGraphData(newGraphData);

    // Expose graph data for testing
    (window as TestWindow).testGraphManager = {
      graphData: newGraphData,
      parsedNodesMap
    };
  }, [parsedNodesMap]);

  // Function to update window content (simulates updateWindowContent from FloatingWindowManager)
  const updateWindowContent = (nodeId: string, newContent: string) => {
    setOpenEditors(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(nodeId);
      if (existing) {
        const testLogs = (window as TestWindow)._test_logs || [];
        testLogs.push(`VoiceTreeLayout: Updating editor content for node ${nodeId} due to external file change`);

        newMap.set(nodeId, {
          ...existing,
          content: newContent
        });
      }
      return newMap;
    });
  };

  // Mock normalizeFileId function
  const normalizeFileId = (filename: string): string => {
    let id = filename.replace(/\.md$/i, '');
    const lastSlash = id.lastIndexOf('/');
    if (lastSlash >= 0) {
      id = id.substring(lastSlash + 1);
    }
    return id;
  };

  // Handle file change simulation
  const handleFileChanged = useRef((data: { path: string; content: string }) => {
    if (!data.path.endsWith('.md') || !data.content) return;

    const testLogs = (window as TestWindow)._test_logs || [];
    testLogs.push(`File changed: ${data.path}`);

    // Update stored content (simulate markdownFiles.current.set)
    fileContentMap.current.set(data.path, data.content);

    // Parse the markdown file and update the parsed nodes map
    const parsedNode = MarkdownParser.parseMarkdownFile(data.content, data.path);
    setParsedNodesMap(prevMap => {
      const newMap = new Map(prevMap);
      newMap.set(data.path, parsedNode);
      return newMap;
    });

    const nodeId = normalizeFileId(data.path);

    // Update any open editors for this file (simulates the new logic we added)
    setOpenEditors(currentEditors => {
      const editorInfo = currentEditors.get(nodeId);
      if (editorInfo) {
        updateWindowContent(nodeId, data.content);
      }
      return currentEditors;
    });
  });

  // Set up event listener for file change simulation
  useEffect(() => {
    const handleSimulateFileChange = (event: CustomEvent) => {
      handleFileChanged.current(event.detail);
    };

    window.addEventListener('simulateFileChange', handleSimulateFileChange as EventListener);

    return () => {
      window.removeEventListener('simulateFileChange', handleSimulateFileChange as EventListener);
    };
  }, []);

  const openEditor = (nodeId: string, filePath: string) => {
    if (openEditors.has(nodeId)) {
      return; // Already open
    }

    const content = fileContentMap.current.get(filePath) || '# No content';
    const windowId = `window_${nodeId}_${windowCounter}`;
    setWindowCounter(prev => prev + 1);

    setOpenEditors(prev => {
      const newMap = new Map(prev);
      newMap.set(nodeId, {
        windowId,
        nodeId,
        filePath,
        content,
        position: { x: 100 + newMap.size * 50, y: 150 + newMap.size * 50 },
        size: { width: 400, height: 300 }
      });
      return newMap;
    });
  };

  const closeEditor = (nodeId: string) => {
    setOpenEditors(prev => {
      const newMap = new Map(prev);
      newMap.delete(nodeId);
      return newMap;
    });
  };

  return (
    <div style={{ padding: '20px', minHeight: '100vh', position: 'relative' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'white', padding: '20px', zIndex: 1000, borderBottom: '1px solid #ccc' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>File Watcher Editor Test</h1>

        <button onClick={() => openEditor('test', 'test/test.md')}>
          Open Editor for Test Node
        </button>

        <button onClick={() => openEditor('other', 'test/other.md')} style={{ marginLeft: '10px' }}>
          Open Editor for Other Node
        </button>
      </div>

      {Array.from(openEditors.values()).map((editor, index) => (
        <div
          key={editor.windowId}
          className="floating-window"
          style={{
            position: 'absolute',
            top: editor.position.y,
            left: editor.position.x,
            width: editor.size.width,
            height: editor.size.height,
            border: '1px solid #ccc',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100 + index,
          }}
        >
          <div
            className="window-title-bar"
            style={{
              padding: '8px 12px',
              backgroundColor: '#f0f0f0',
              borderBottom: '1px solid #ccc',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{editor.filePath}</span>
            <button
              onClick={() => closeEditor(editor.nodeId)}
              aria-label="Close"
              style={{ all: 'unset', cursor: 'pointer', fontSize: '16px' }}
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, padding: '10px', overflow: 'auto' }}>
            <MDEditor
              value={editor.content}
              onChange={(val) => {
                const newContent = val || '';
                setOpenEditors(prev => {
                  const newMap = new Map(prev);
                  const existing = newMap.get(editor.nodeId);
                  if (existing) {
                    newMap.set(editor.nodeId, {
                      ...existing,
                      content: newContent
                    });
                  }
                  return newMap;
                });
              }}
              height={150}
            />
            <button
              data-editor-id={editor.nodeId}
              onClick={async (e) => {
                const button = e.currentTarget as HTMLButtonElement;
                try {
                  await (window as TestWindow).electronAPI?.saveFileContent(editor.filePath, editor.content);
                  // Show "Saved!" temporarily
                  const originalText = button.textContent;
                  button.textContent = 'Saved!';
                  setTimeout(() => {
                    button.textContent = originalText;
                  }, 2000);
                } catch (error) {
                  console.error('Save failed:', error);
                }
              }}
              style={{
                marginTop: '10px',
                padding: '6px 12px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Save
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const App = () => {
  return mode === 'file-watcher' ? <FileWatcherEditor /> :
         mode === 'cytoscape' ? <CytoscapeEditor /> :
         <StandaloneEditor />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export default App;