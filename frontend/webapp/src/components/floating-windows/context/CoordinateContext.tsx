import React, { createContext, useContext, useRef } from 'react';
import type { Core } from 'cytoscape';
import type { PropsWithChildren } from 'react';
import { toGraphCoords, toScreenCoords, graphToScreen, screenToGraph } from '@/utils/coordinate-conversions';

interface CoordinateContextType {
  getCyInstance: () => Core | null;
  toGraphCoords: (screenX: number, screenY: number) => { x: number; y: number } | null;
  toScreenCoords: (graphX: number, graphY: number) => { x: number; y: number } | null;
  graphToScreen: (value: number) => number | null;
  screenToGraph: (value: number) => number | null;
}

const CoordinateContext = createContext<CoordinateContextType | null>(null);

interface CoordinateProviderProps extends PropsWithChildren {
  cyInstance: Core | null;
}

export const CoordinateProvider: React.FC<CoordinateProviderProps> = ({ children, cyInstance }) => {
  const cyRef = useRef<Core | null>(cyInstance);

  // Update ref when cyInstance changes
  React.useEffect(() => {
    cyRef.current = cyInstance;
  }, [cyInstance]);

  const value: CoordinateContextType = {
    getCyInstance: () => cyRef.current,

    toGraphCoords: (screenX: number, screenY: number) => {
      if (!cyRef.current) return null;
      return toGraphCoords(screenX, screenY, cyRef.current);
    },

    toScreenCoords: (graphX: number, graphY: number) => {
      if (!cyRef.current) return null;
      return toScreenCoords(graphX, graphY, cyRef.current);
    },

    graphToScreen: (value: number) => {
      if (!cyRef.current) return null;
      return graphToScreen(value, cyRef.current.zoom());
    },

    screenToGraph: (value: number) => {
      if (!cyRef.current) return null;
      return screenToGraph(value, cyRef.current.zoom());
    }
  };

  return (
    <CoordinateContext.Provider value={value}>
      {children}
    </CoordinateContext.Provider>
  );
};

export const useCoordinates = (): CoordinateContextType => {
  const context = useContext(CoordinateContext);
  if (!context) {
    throw new Error('useCoordinates must be used within a CoordinateProvider');
  }
  return context;
};