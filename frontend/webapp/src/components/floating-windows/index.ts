// Barrel file to export all floating window components for easy access.
// This simplifies imports in other parts of the application.
//
// Dependencies:
// - None
//
// Called by:
// - Potentially any UI component that needs a floating window.

export { FloatingWindow } from './FloatingWindow';
export { FloatingWindowContainer } from './FloatingWindowContainer';
export { FloatingWindowManagerProvider, useFloatingWindows } from './context/FloatingWindowManager';
