/**
 * Hybrid entry point - React for UI, Vanilla for Graph
 *
 * This demonstrates that:
 * - React components (top bar UI) work fine
 * - Graph is pure vanilla TypeScript (no React dependency)
 */

import './index.css';
import { createRoot } from 'react-dom/client';
import { useGraphManager } from './hooks/useGraphManager';
import { Button } from './components/ui/button';
import { Alert, AlertDescription } from './components/ui/alert';
import VoiceTreeTranscribe from './renderers/voicetree-transcribe';
import { VoiceTreeGraphView } from './views/VoiceTreeGraphView';
import { useEffect, useRef } from 'react';

// React component for the top bar only
function TopBar() {
  const {
    isWatching,
    isLoading,
    watchDirectory,
    error,
    startWatching,
    stopWatching,
    clearError,
    isElectron
  } = useGraphManager();

  // File Watching Panel Component
  const FileWatchingPanel = () => (
    <div className="border rounded-lg p-2 bg-white shadow-sm">
      {/* Status Display */}
      <div className="mb-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs ${
            isWatching
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {isLoading
              ? 'Loading...'
              : isWatching
                ? 'Watching'
                : 'Not watching'
            }
          </span>
        </div>

        {watchDirectory && (
          <div className="mt-1">
            <span className="text-xs text-gray-600 ml-1 font-mono">
              {watchDirectory}
            </span>
          </div>
        )}
      </div>

      {/* Control Button */}
      <div className="flex gap-2 mb-2">
        {isElectron ? (
          <Button
            onClick={isWatching ? stopWatching : startWatching}
            disabled={isLoading}
            size="sm"
            variant={isWatching ? "destructive" : "default"}
          >
            {isLoading
              ? (isWatching ? 'Stopping...' : 'Starting...')
              : (isWatching ? 'Stop Watching' : 'Open Folder')
            }
          </Button>
        ) : (
          <div className="text-xs text-gray-500">
            File watching available in Electron app only
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive" className="mb-2">
          <AlertDescription className="flex justify-between items-center">
            <span>{error}</span>
            <Button
              onClick={clearError}
              size="sm"
              variant="ghost"
              className="h-auto p-1 ml-2"
            >
              ×
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );

  return (
    <div className="flex-shrink-0 py-2 px-4 bg-background">
      <div className="flex gap-4">
        {/* File Watching Panel - 1/6 width */}
        <div className="w-1/6">
          <FileWatchingPanel />
        </div>

        {/* Voice Transcribe Component - 5/6 width */}
        <div className="flex-1">
          <VoiceTreeTranscribe />
        </div>
      </div>
    </div>
  );
}

// Initialize the hybrid app
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Hybrid] Initializing React top bar + vanilla graph...');

  const root = document.getElementById('root');
  if (!root) {
    console.error('[Hybrid] Root element not found!');
    return;
  }

  // Set up layout
  root.style.width = '100vw';
  root.style.height = '100vh';
  root.style.overflow = 'hidden';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';

  // Create top bar container (React)
  const topBarContainer = document.createElement('div');
  topBarContainer.id = 'top-bar';
  topBarContainer.style.flexShrink = '0';
  root.appendChild(topBarContainer);

  // Create graph wrapper (flex child) with relative positioning
  const graphWrapper = document.createElement('div');
  graphWrapper.id = 'graph-wrapper';
  graphWrapper.style.flex = '1';
  graphWrapper.style.minHeight = '0'; // Important for flex child with overflow
  graphWrapper.style.position = 'relative'; // Required for floating windows
  graphWrapper.style.overflow = 'hidden';
  root.appendChild(graphWrapper);

  // Create graph container inside wrapper (VoiceTreeGraphView will style this)
  const graphContainer = document.createElement('div');
  graphContainer.style.width = '100%';
  graphContainer.style.height = '100%';
  graphWrapper.appendChild(graphContainer);

  // Mount React top bar
  console.log('[Hybrid] Mounting React top bar...');
  const reactRoot = createRoot(topBarContainer);
  reactRoot.render(<TopBar />);

  // Initialize vanilla graph
  console.log('[Hybrid] Initializing vanilla graph...');
  const graphView = new VoiceTreeGraphView(graphContainer, {
    initialDarkMode: false
  });

  // Cleanup
  window.addEventListener('beforeunload', () => {
    console.log('[Hybrid] Cleaning up...');
    reactRoot.unmount();
    graphView.dispose();
  });

  // Expose for debugging
  (window as any).graphView = graphView;
  (window as any).reactRoot = reactRoot;
});
