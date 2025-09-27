import React, { useRef } from 'react';
import Draggable from 'react-draggable';
import type { FloatingWindow as FloatingWindowType } from './types';
import { useFloatingWindows } from './hooks/useFloatingWindows';
import { MarkdownEditor } from './editors/MarkdownEditor';
import { Terminal } from './editors/Terminal';

interface FloatingWindowProps extends FloatingWindowType {
  onDragStop?: (position: { x: number; y: number }) => void;
}

/**
 * Renders a single, generic, draggable window frame.
 * It handles its own position, stacking order, and renders the specific content (editor/terminal).
 */
export const FloatingWindow: React.FC<FloatingWindowProps> = (props) => {
  const { id, title, type, position, size, zIndex, graphAnchor } = props;
  const { closeWindow, bringToFront, updateWindowPosition, updateWindowGraphOffset } = useFloatingWindows();
  const nodeRef = useRef(null);

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
        return <Terminal />;
      default:
        return null;
    }
  };

  return (
    <Draggable
      nodeRef={nodeRef}
      handle=".window-title-bar"
      defaultPosition={position}
      onStop={(_, data) => {
        const newPosition = { x: data.x, y: data.y };
        updateWindowPosition(id, newPosition);

        // If we have graph coordinates and a drag callback, notify parent
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
          width: `${size.width}px`,
          height: `${size.height}px`,
          border: '1px solid #ccc',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          background: 'white',
          display: 'flex',
          flexDirection: 'column',
          zIndex,
          pointerEvents: 'auto', // Re-enable mouse events for the window itself
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
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          <button
            onClick={() => closeWindow(id)}
            style={{ all: 'unset', cursor: 'pointer', fontSize: '16px' }}
          >
            &times;
          </button>
        </div>
        <div className="window-content" style={{ flex: 1, overflow: 'hidden' }}>
          {renderContent()}
        </div>
      </div>
    </Draggable>
  );
};
