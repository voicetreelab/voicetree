/**
 * MINIMAL TERMINAL TEST - Vanilla TypeScript
 *
 * This is the absolute bare minimum terminal implementation:
 * - No React
 * - No DOM manipulation beyond container
 * - No graph
 * - No floating windows
 * - Just xterm.js in a div
 *
 * Purpose: Isolate the scrolling issue to determine if it's caused by:
 * - React
 * - DOM manipulation
 * - Cytoscape/graph interactions
 * - Or xterm.js itself in Electron
 */

import '@xterm/xterm/css/xterm.css';
import { TerminalNoAutoScroll } from '@/floating-windows/TerminalNoAutoScroll';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Terminal Test] Initializing minimal terminal...');

  // Get the container
  const container = document.getElementById('terminal-container');
  if (!container) {
    console.error('[Terminal Test] Container not found!');
    return;
  }

  // Create terminal instance - EXPERIMENTAL: blocks programmatic scrolls
  const terminal = new TerminalNoAutoScroll({
    container: container
  });

  console.log('[Terminal Test] Terminal initialized');

  // Cleanup on window unload
  window.addEventListener('beforeunload', () => {
    console.log('[Terminal Test] Disposing terminal');
    terminal.dispose();
  });

  // Expose for debugging
  (window as any).terminal = terminal;
});
