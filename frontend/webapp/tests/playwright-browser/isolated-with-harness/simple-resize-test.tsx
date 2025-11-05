import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import Draggable from 'react-draggable';
import { Resizable } from 're-resizable';

export function SimpleResizeTest() {
  const [size, setSize] = useState({ width: 400, height: 300 });
  const nodeRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ padding: '20px', height: '100vh', background: '#f0f0f0' }}>
      <h1>Simple Resize Test - Same structure as FloatingWindow</h1>

      <Draggable
        nodeRef={nodeRef}
        handle=".window-title-bar"
        defaultPosition={{ x: 100, y: 100 }}
      >
        <div
          ref={nodeRef}
          className="floating-window"
          style={{
            position: 'absolute',
            zIndex: 1000,
            pointerEvents: 'auto'
          }}
        >
          {/* Title bar - outside resizable for independent dragging */}
          <div
            className="window-title-bar"
            style={{
              padding: '8px 12px',
              backgroundColor: '#f0f0f0',
              border: '1px solid #ccc',
              borderBottom: 'none',
              cursor: 'move',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              userSelect: 'none',
              width: size.width,
              boxSizing: 'border-box'
            }}
          >
            <span>Test Window - Drag Here</span>
            <button>&times;</button>
          </div>

          {/* Content - resizable */}
          <Resizable
            size={{ width: size.width, height: size.height }}
            onResizeStop={(e, direction, ref, d) => {
              setSize({
                width: size.width + d.width,
                height: size.height + d.height
              });
            }}
            minWidth={300}
            minHeight={200}
            enable={{
              top: false,
              right: true,
              bottom: true,
              left: false,
              topRight: false,
              bottomRight: true,
              bottomLeft: false,
              topLeft: false
            }}
            style={{
              border: '1px solid #ccc',
              borderTop: 'none',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              background: 'white',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              overflow: 'hidden'
            }}
            className="resizable-content"
          >
            <div style={{ padding: '20px' }}>
              <h2>Resizable Content</h2>
              <p>Size: {size.width} x {size.height}</p>
              <p>Try resizing from the right edge, bottom edge, or corner!</p>
            </div>
          </Resizable>
        </div>
      </Draggable>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<SimpleResizeTest />);