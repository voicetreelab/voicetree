import { createContext } from 'react';

// We need to define the type here to avoid circular dependency
import type { FloatingWindow } from '@/components/floating-windows/types';

export interface FloatingWindowManagerContextType {
  windows: FloatingWindow[];
  openWindow: (config: Omit<FloatingWindow, 'id' | 'zIndex' | 'content'> & { content?: string }) => void;
  closeWindow: (id: string) => void;
  updateWindowContent: (id: string, newContent: string) => void;
  updateWindowPosition: (id: string, newPosition: { x: number; y: number }) => void;
  bringToFront: (id: string) => void;
}

// Create the context
export const FloatingWindowContext = createContext<FloatingWindowManagerContextType | null>(null);