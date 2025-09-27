import { MockElectronAPI } from './mock-electron-api';

/**
 * Set up the browser environment for testing the file-to-graph pipeline
 * This file should be imported in the main app when running tests
 */

// Check if we're in a browser environment and need the mock API
// Set up mock API whenever there's no real electronAPI
if (typeof window !== 'undefined' && !window.electronAPI) {

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
}

// Export for use in test files
export function getMockElectronAPI(): MockElectronAPI | null {
  try {
    return (window as typeof window & { mockElectronAPI?: MockElectronAPI }).mockElectronAPI || null;
  } catch {
    return null; // No window object available (Node environment)
  }
}

export function getCytoscapeInstance(): unknown {
  try {
    return (window as typeof window & { cytoscapeInstance?: unknown }).cytoscapeInstance || null;
  } catch {
    return null; // No window object available (Node environment)
  }
}