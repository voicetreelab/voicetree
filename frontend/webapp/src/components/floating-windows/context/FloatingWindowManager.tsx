
import React, { useState, useCallback } from 'react';
import type { PropsWithChildren } from 'react';
import type { FloatingWindow } from '@/components/floating-windows/types';
import { FloatingWindowContext, type FloatingWindowManagerContextType } from './FloatingWindowContext';

// Counter for generating unique window IDs
let windowIdCounter = 0;

// Create the provider component
export const FloatingWindowManagerProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [windows, setWindows] = useState<FloatingWindow[]>([]);

  const getHighestZIndex = useCallback((windowsArray: FloatingWindow[]) => {
    if (windowsArray.length === 0) return 100; // Start at a base z-index
    return Math.max(...windowsArray.map(w => w.zIndex)) + 1;
  }, []);

  const openWindow = useCallback((config: Omit<FloatingWindow, 'id' | 'zIndex' | 'content'> & { content?: string; onSave?: (newContent: string) => Promise<void> }) => {
    setWindows(prev => {
      // Prevent opening multiple windows for the same node
      if (prev.some(w => w.nodeId === config.nodeId)) {
        // Bring existing window to front instead
        const existing = prev.find(w => w.nodeId === config.nodeId);
        if (existing) {
          const highestZIndex = getHighestZIndex(prev);
          return prev.map(w => (w.id === existing.id ? { ...w, zIndex: highestZIndex } : w));
        }
        return prev;
      }

      const newWindow: FloatingWindow = {
        ...config,
        id: `window_${++windowIdCounter}`,
        content: config.content || '',
        zIndex: getHighestZIndex(prev),
      };
      return [...prev, newWindow];
    });
  }, [getHighestZIndex]);

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const updateWindowContent = useCallback((id: string, newContent: string) => {
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, content: newContent } : w))
    );
  }, []);

  const updateWindowPosition = useCallback((id: string, newPosition: { x: number; y: number }) => {
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, position: newPosition } : w))
    );
  }, []);

  const updateWindowGraphOffset = useCallback((id: string, graphOffset: { x: number; y: number }) => {
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, graphOffset } : w))
    );
  }, []);

  const bringToFront = useCallback((id: string) => {
    setWindows(prev => {
      const highestZIndex = getHighestZIndex(prev);
      return prev.map(w => (w.id === id ? { ...w, zIndex: highestZIndex } : w));
    });
  }, [getHighestZIndex]);

  const value: FloatingWindowManagerContextType = {
    windows,
    openWindow,
    closeWindow,
    updateWindowContent,
    updateWindowPosition,
    updateWindowGraphOffset,
    bringToFront,
  };

  return (
    <FloatingWindowContext.Provider value={value}>
      {children}
    </FloatingWindowContext.Provider>
  );
};

