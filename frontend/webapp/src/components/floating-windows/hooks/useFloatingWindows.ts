import { useContext } from 'react';
import { FloatingWindowContext, type FloatingWindowManagerContextType } from '../context/FloatingWindowContext';

// Create the custom hook for easy context access
export const useFloatingWindows = (): FloatingWindowManagerContextType => {
  const context = useContext(FloatingWindowContext);
  if (!context) {
    throw new Error('useFloatingWindows must be used within a FloatingWindowManagerProvider');
  }
  return context;
};