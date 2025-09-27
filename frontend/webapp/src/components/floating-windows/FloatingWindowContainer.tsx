import React, { useEffect, useCallback } from 'react';
import { useFloatingWindows } from './hooks/useFloatingWindows';
import { FloatingWindow } from './FloatingWindow';

interface FloatingWindowContainerProps {
  onPositionUpdateCallback?: (callback: (positionUpdates: Map<string, { x: number; y: number }>) => void) => void;
  onDragStop?: (windowId: string, screenPosition: { x: number; y: number }) => void;
}

/**
 * Renders all active floating windows. It acts as the container layer for all floating elements.
 */
export const FloatingWindowContainer: React.FC<FloatingWindowContainerProps> = ({
  onPositionUpdateCallback,
  onDragStop
}) => {
  const { windows, updateWindowPosition } = useFloatingWindows();

  // Create the position update handler
  const handlePositionUpdates = useCallback((positionUpdates: Map<string, { x: number; y: number }>) => {
    console.log('[DEBUG] FloatingWindowContainer handlePositionUpdates called with', positionUpdates.size, 'updates');
    for (const [nodeId, newPosition] of positionUpdates) {
      // Find the window for this node and update its position
      const window = windows.find(w => w.nodeId === nodeId);
      if (window) {
        console.log(`[DEBUG] Updating window ${window.id} position to`, newPosition);
        updateWindowPosition(window.id, newPosition);
      } else {
        console.log(`[DEBUG] No window found for nodeId ${nodeId}`);
      }
    }
  }, [windows, updateWindowPosition]);

  // Register the position update callback with the parent
  useEffect(() => {
    if (onPositionUpdateCallback) {
      onPositionUpdateCallback(handlePositionUpdates);
    }
  }, [onPositionUpdateCallback, handlePositionUpdates]);

  return (
    <div
      className="floating-window-container"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none', // The container itself should not capture mouse events
      }}
    >
      {windows.map(window => (
        <FloatingWindow
          key={window.id}
          {...window}
          onDragStop={onDragStop ? (pos) => onDragStop(window.id, pos) : undefined}
        />
      ))}
    </div>
  );
};
