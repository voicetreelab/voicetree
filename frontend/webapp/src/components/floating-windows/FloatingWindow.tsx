import React, { useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { Resizable } from 're-resizable';
import type { FloatingWindow as FloatingWindowType } from './types';
import { useFloatingWindows } from './hooks/useFloatingWindows';
import { MarkdownEditor } from './editors/MarkdownEditor';
import { Terminal } from './editors/Terminal';

interface FloatingWindowProps extends FloatingWindowType {
  onDragStop?: (position: { x: number; y: number }) => void;
}

/**
 * Renders a single, generic, draggable and resizable window frame.
 * It handles its own position, stacking order, resizing, and renders the specific content (editor/terminal).
 */
export const FloatingWindow: React.FC<FloatingWindowProps> = (props) => {
  const { id, title, type, position, size, zIndex, graphAnchor } = props;
  const { closeWindow, bringToFront, updateWindowPosition } = useFloatingWindows();
  const nodeRef = useRef(null);
  const [currentSize, setCurrentSize] = useState(size);

  // Debug position changes
  React.useEffect(() => {
    // console.log(`[DEBUG] FloatingWindow ${id} position changed to:`, position);
  }, [position, id]);

  const handleSave = async (newContent: string) => {
    if (props.onSave) {
      await props.onSave(newContent);
    } else {
      throw new Error('Save functionality not available');
    }
  };

  const renderContent = () => {
    switch (type) {
      case 'MarkdownEditor':
        return <MarkdownEditor windowId={id} content={props.content} onSave={handleSave} />;
      case 'Terminal':
        return <Terminal nodeMetadata={props.nodeMetadata} />;
      default:
        return null;
    }
  };

  return (
    <Draggable
      nodeRef={nodeRef}
      handle=".window-title-bar"
      position={position}
      onDrag={(_, data) => {
        // Update position during drag for smooth dragging
        const newPosition = { x: data.x, y: data.y };
        updateWindowPosition(id, newPosition);
      }}
      onStop={(_, data) => {
        const newPosition = { x: data.x, y: data.y };

        // If we have graph coordinates and a drag callback, notify parent to update graph offset
        if (props.onDragStop && graphAnchor) {
          props.onDragStop(newPosition);
        }
      }}
    >
      <div
        ref={nodeRef}
        className="floating-window"
        onMouseDown={() => bringToFront(id)}
        style={{
          position: 'absolute',
          zIndex,
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
            width: currentSize.width,
            boxSizing: 'border-box'
          }}
        >
          <span style={{
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {title}
          </span>
          <button
            onClick={() => closeWindow(id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: '16px',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            &times;
          </button>
        </div>

        {/* Content - resizable */}
        <Resizable
          size={{ width: currentSize.width, height: currentSize.height }}
          onResizeStop={(_e, _direction, _ref, d) => {
            setCurrentSize({
              width: currentSize.width + d.width,
              height: currentSize.height + d.height
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
        >
          <div className="window-content" style={{ flex: 1, overflow: 'auto' }}>
            {renderContent()}
          </div>
          {/* Resize handle visual indicator in bottom-right corner */}
          <div
            style={{
              position: 'absolute',
              bottom: '2px',
              right: '2px',
              width: '12px',
              height: '12px',
              opacity: 0.3,
              pointerEvents: 'none',
              userSelect: 'none'
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M11 11L1 1M11 6L6 1M11 1L11 11L1 11"
                stroke="#666"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </Resizable>
      </div>
    </Draggable>
  );
};