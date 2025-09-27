import { createContext } from 'react';
import type { Core } from 'cytoscape';

export interface CoordinateContextType {
  getCyInstance: () => Core | null;
  toGraphCoords: (screenX: number, screenY: number) => { x: number; y: number } | null;
  toScreenCoords: (graphX: number, graphY: number) => { x: number; y: number } | null;
  graphToScreen: (value: number) => number | null;
  screenToGraph: (value: number) => number | null;
}

export const CoordinateContext = createContext<CoordinateContextType | null>(null);