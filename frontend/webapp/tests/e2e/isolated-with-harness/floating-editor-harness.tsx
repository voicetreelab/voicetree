import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import cytoscape from 'cytoscape';
import MDEditor from '@uiw/react-md-editor';

// Mock the electronAPI for the browser-based test
(window as typeof window & { electronAPI: unknown, _test_savedPayload?: unknown }).electronAPI = {
  saveFileContent: async (filePath: string, content: string) => {
    console.log('Mock saveFileContent called with:', { filePath, content });
    // Store the payload in a global variable for the test to access
    (window as typeof window & { _test_savedPayload?: unknown })._test_savedPayload = { filePath, content };
  },
};

// Determine which mode to run based on URL parameter
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode') || 'standalone';

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
      setShowEditor(true);
    });

    // Handle pan events to update editor position
    cyInstance.current.on('pan', () => {
      if (showEditor && cyInstance.current) {
        // Get the node's rendered position after pan
        const node = cyInstance.current.$('#node1');
        if (node.length > 0) {
          const renderedPos = node.renderedPosition();
          setEditorPosition({ x: renderedPos.x, y: renderedPos.y });
        }
      }
    });

    // Expose cy instance globally for testing
    (window as typeof window & { cy: unknown }).cy = cyInstance.current;

    return () => {
      cyInstance.current?.destroy();
    };
  }, [showEditor]);

  // Update position when pan occurs
  useEffect(() => {
    if (!cyInstance.current || !showEditor) return;

    const handlePan = () => {
      const node = cyInstance.current!.$('#node1');
      if (node.length > 0) {
        const renderedPos = node.renderedPosition();
        setEditorPosition({ x: renderedPos.x, y: renderedPos.y });
      }
    };

    cyInstance.current.on('pan zoom', handlePan);

    return () => {
      cyInstance.current?.off('pan zoom', handlePan);
    };
  }, [showEditor]);

  const handleSave = async () => {
    await ((window as typeof window & { electronAPI?: { saveFileContent: (path: string, content: string) => Promise<void> } }).electronAPI?.saveFileContent('test/node.md', content));
  };

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

const App = () => {
  return mode === 'cytoscape' ? <CytoscapeEditor /> : <StandaloneEditor />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export default App;