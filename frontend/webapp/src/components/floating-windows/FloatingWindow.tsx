import React from 'react';
import Draggable from 'react-draggable';
import { FloatingWindowState } from './types';
import { useFloatingWindows } from './context/FloatingWindowManager';
import { MarkdownEditor } from './editors/MarkdownEditor';
import { Terminal } from './editors/Terminal';

/**
 * Renders a single, generic, draggable window frame.
 * It handles its own position, stacking order, and renders the specific content (editor/terminal).
 */
export const FloatingWindow: React.FC<FloatingWindowState> = (props) => {
  const { id, title, type, position, size, zIndex } = props;
  const { closeWindow, bringToFront, updateWindowPosition } = useFloatingWindows();

  const renderContent = () => {
    switch (type) {
      case 'MarkdownEditor':
        return <MarkdownEditor windowId={id} nodeId={props.nodeId} initialContent={props.content} />;
      case 'Terminal':
        return <Terminal />;
      default:
        return null;
    }
  };

  return (
    <Draggable
      handle=".window-title-bar"
      defaultPosition={position}
      onStop={(_, data) => {
        updateWindowPosition(id, { x: data.x, y: data.y });
      }}
    >
      <div
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
