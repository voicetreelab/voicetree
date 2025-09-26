import { MockElectronAPI } from './mock-electron-api';

/**
 * Set up the browser environment for testing the file-to-graph pipeline
 * This file should be imported in the main app when running tests
 */

// Immediately execute setup to ensure window.electronAPI is available
console.log('setup-browser-tests.ts: Executing mock setup...');

// Check if we're in a browser environment and need the mock API
// Only set up in DEV mode when no real electronAPI exists
// OR when we're in test mode (includes Playwright tests)
if (typeof window !== 'undefined' &&
    (import.meta.env.DEV || import.meta.env.MODE === 'test') &&
    !window.electronAPI) {

  console.log('setup-browser-tests.ts: Setting up mock Electron API for browser tests');

  // Create and attach the mock API immediately
  const mockAPI = new MockElectronAPI();
  (window as typeof window & { electronAPI?: unknown }).electronAPI = mockAPI;

  // Make the mock API available for direct test manipulation
  (window as typeof window & { mockElectronAPI?: unknown }).mockElectronAPI = mockAPI;

  // Set up a global reference for Cytoscape instance (will be set by VoiceTreeLayout)
  (window as typeof window & { cytoscapeInstance?: unknown }).cytoscapeInstance = null;

  console.log('setup-browser-tests.ts: Mock Electron API successfully attached to window');
  console.log('setup-browser-tests.ts: window.electronAPI available:', !!window.electronAPI);
  console.log('setup-browser-tests.ts: Environment - DEV:', import.meta.env.DEV, 'MODE:', import.meta.env.MODE);
} else if (typeof window !== 'undefined' && window.electronAPI) {
  console.log('setup-browser-tests.ts: Real Electron API detected, skipping mock setup');
} else if (typeof window !== 'undefined' && !import.meta.env.DEV) {
  console.log('setup-browser-tests.ts: Production mode, skipping mock setup');
} else {
  console.log('setup-browser-tests.ts: Not in browser environment, skipping setup');
}

// Export for use in test files
export function getMockElectronAPI(): MockElectronAPI | null {
  return (window as typeof window & { mockElectronAPI?: MockElectronAPI }).mockElectronAPI || null;
}

export function getCytoscapeInstance(): unknown {
  return (window as typeof window & { cytoscapeInstance?: unknown }).cytoscapeInstance || null;
}