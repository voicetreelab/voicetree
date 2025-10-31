/**
 * Vanilla TypeScript entry point - NO REACT
 *
 * This file demonstrates that the graph functionality works
 * completely independently of React.
 */

import './index.css';
import { VoiceTreeGraphView } from './views/VoiceTreeGraphView';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Vanilla] Initializing VoiceTree without React...');

  // Get the root container
  const root = document.getElementById('root');
  if (!root) {
    console.error('[Vanilla] Root element not found!');
    return;
  }

  // Set root to full screen to provide height context for h-full
  root.style.width = '100vw';
  root.style.height = '100vh';
  root.style.overflow = 'hidden';

  // Create graph container - VoiceTreeGraphView will set its own classes
  const graphContainer = document.createElement('div');
  graphContainer.style.width = '100%';
  graphContainer.style.height = '100%';
  root.appendChild(graphContainer);

  // Initialize VoiceTreeGraphView (vanilla class, no React!)
  const graphView = new VoiceTreeGraphView(graphContainer, {
    initialDarkMode: false
  });

  console.log('[Vanilla] VoiceTreeGraphView initialized');

  // Cleanup on window unload
  window.addEventListener('beforeunload', () => {
    console.log('[Vanilla] Disposing VoiceTreeGraphView');
    graphView.dispose();
  });

  // Expose for debugging
  (window as any).graphView = graphView;
});
