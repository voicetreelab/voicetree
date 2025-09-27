import React, { useRef } from 'react';
import type { Core } from 'cytoscape';
import type { PropsWithChildren } from 'react';
import { toGraphCoords, toScreenCoords, graphToScreen, screenToGraph } from '@/utils/coordinate-conversions';
import { CoordinateContext } from '@/components/floating-windows/context/CoordinateContextTypes';
import type { CoordinateContextType } from '@/components/floating-windows/context/CoordinateContextTypes';

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