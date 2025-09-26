import React from 'react';
import { useFloatingWindows } from './context/FloatingWindowManager';
import { FloatingWindow } from './FloatingWindow';

/**
 * Renders all active floating windows. It acts as the container layer for all floating elements.
 */
export const FloatingWindowContainer: React.FC = () => {
  const { windows } = useFloatingWindows();

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
        <FloatingWindow key={window.id} {...window} />
      ))}
    </div>
  );
};
