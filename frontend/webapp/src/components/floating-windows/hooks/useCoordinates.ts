import { useContext } from 'react';
import { CoordinateContext } from '@/components/floating-windows/context/CoordinateContextTypes';
import type { CoordinateContextType } from '@/components/floating-windows/context/CoordinateContextTypes';

export const useCoordinates = (): CoordinateContextType => {
  const context = useContext(CoordinateContext);
  if (!context) {
    throw new Error('useCoordinates must be used within a CoordinateProvider');
  }
  return context;
};