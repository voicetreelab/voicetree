
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { PropsWithChildren } from 'react';
import type { FloatingWindow } from '../types';

// Define the shape of the context value
interface FloatingWindowManagerContextType {
  windows: FloatingWindow[];
  openWindow: (config: Omit<FloatingWindow, 'id' | 'zIndex' | 'content'> & { content?: string }) => void;
  closeWindow: (id: string) => void;
  updateWindowContent: (id: string, newContent: string) => void;
  updateWindowPosition: (id: string, newPosition: { x: number; y: number }) => void;
  bringToFront: (id: string) => void;
}

// Create the context
const FloatingWindowContext = createContext<FloatingWindowManagerContextType | null>(null);

// Create the provider component
export const FloatingWindowManagerProvider: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const [windows, setWindows] = useState<FloatingWindow[]>([]);

  const getHighestZIndex = useCallback(() => {
    if (windows.length === 0) return 100; // Start at a base z-index
    return Math.max(...windows.map(w => w.zIndex)) + 1;
  }, [windows]);

  const openWindow = useCallback((config: Omit<FloatingWindow, 'id' | 'zIndex' | 'content'> & { content?: string }) => {
    // Prevent opening multiple windows for the same node
    if (windows.some(w => w.nodeId === config.nodeId)) {
        // Optional: Bring existing window to front instead
        const existing = windows.find(w => w.nodeId === config.nodeId);
        if (existing) bringToFront(existing.id);
        return;
    }

    const newWindow: FloatingWindow = {
      ...config,
      id: `window_${Date.now().toString()}`,
      content: config.content || '',
      zIndex: getHighestZIndex(),
    };
    setWindows(prev => [...prev, newWindow]);
  }, [windows, getHighestZIndex]);

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

  const bringToFront = useCallback((id: string) => {
    const highestZIndex = getHighestZIndex();
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, zIndex: highestZIndex } : w))
    );
  }, [getHighestZIndex]);

  const value = {
    windows,
    openWindow,
    closeWindow,
    updateWindowContent,
    updateWindowPosition,
    bringToFront,
  };

  return (
    <FloatingWindowContext.Provider value={value}>
      {children}
    </FloatingWindowContext.Provider>
  );
};

// Create the custom hook for easy context access
export const useFloatingWindows = (): FloatingWindowManagerContextType => {
  const context = useContext(FloatingWindowContext);
  if (!context) {
    throw new Error('useFloatingWindows must be used within a FloatingWindowManagerProvider');
  }
  return context;
};
