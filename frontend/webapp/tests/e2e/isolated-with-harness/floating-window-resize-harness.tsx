/**
 * Minimal test harness for floating window resizing functionality.
 * This creates a standalone page with a single resizable floating window.
 */

import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { FloatingWindow } from '../../../src/components/floating-windows/FloatingWindow';
import { FloatingWindowManagerProvider, useFloatingWindows } from '../../../src/components/floating-windows/context/FloatingWindowManager';
import '../../../src/index.css';

function TestHarness() {
  const { openWindow, windows, closeWindow, bringToFront, updateWindowPosition } = useFloatingWindows();
  const [sizeInfo, setSizeInfo] = useState({ width: 400, height: 300 });

  React.useEffect(() => {
    // Open a test window on mount
    openWindow({
      nodeId: 'test-node',
      title: 'Resizable Test Window',
      type: 'MarkdownEditor',
      content: '# Test Content\n\nThis window should be resizable.\n\n- Drag the edges to resize\n- Drag the corner for diagonal resize\n- Minimum size should be 300x200',
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 }
    });
  }, [openWindow]);

  // Create window props for each window
  const windowProps = windows.map(window => ({
    ...window,
    onDragStop: (position: { x: number; y: number }) => {
      updateWindowPosition(window.id, position);
    }
  }));

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#f5f5f5',
      position: 'relative',
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h1>Floating Window Resize Test Harness</h1>
        <div id="size-display" style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
          <p>Instructions:</p>
          <ul>
            <li>The window should be resizable by dragging edges and corners</li>
            <li>Right edge: horizontal resize</li>
            <li>Bottom edge: vertical resize</li>
            <li>Bottom-right corner: diagonal resize</li>
            <li>Minimum size: 300x200 pixels</li>
          </ul>
        </div>
        <div style={{ marginTop: '10px' }}>
          <button
            id="reset-window"
            onClick={() => {
              // Close all windows
              windows.forEach(w => closeWindow(w.id));
              // Open a new one
              setTimeout(() => {
                openWindow({
                  nodeId: 'test-node-2',
                  title: 'Reset Test Window',
                  type: 'MarkdownEditor',
                  content: '# Reset Window\n\nThis is a fresh window.',
                  position: { x: 150, y: 150 },
                  size: { width: 400, height: 300 }
                });
              }, 100);
            }}
            style={{
              padding: '8px 16px',
              background: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reset Window
          </button>
        </div>
      </div>

      {/* Render floating windows */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
          {windowProps.map((props) => (
            <FloatingWindow key={props.id} {...props} />
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <FloatingWindowManagerProvider>
      <TestHarness />
    </FloatingWindowManagerProvider>
  );
}

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);