import VoiceTreeGraphVizLayout from "./components/voice-tree-graph-viz-layout.tsx";
import VoiceTreeTranscribe from "./renderers/voicetree-transcribe";
import Sidebar from "./components/sidebar";
import { useGraphManager } from "./hooks/useGraphManager";
import { Button } from "./components/ui/button";
import { Alert, AlertDescription } from "./components/ui/alert";
import { FloatingWindowManagerProvider } from "./components/floating-windows/context/FloatingWindowManager";
import { MockElectronAPI } from "./test/mock-electron-api";

// Use real Electron API if available, otherwise fall back to mock
if (!window.electronAPI) {
  const mockAPI = new MockElectronAPI();
  window.electronAPI = mockAPI;
  window.mockElectronAPI = mockAPI;
  // console.log('App: No Electron API found, using mock as fallback');
} else {
  // console.log('App: Using real Electron API');
}

function App() {
  // Use the graph manager hook for file watching
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

  // File Watching Control Panel Component
  const FileWatchingPanel = () => (
    <div className="border rounded-lg p-4 mt-11 bg-white shadow-sm">

      {/* Status Display */}
      <div className="mb-3 text-sm">
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
            <span className="font-medium">Directory:</span>
            <span className="text-xs text-gray-600 ml-1 font-mono">
              {watchDirectory}
            </span>
          </div>
        )}

        {/* Graph data display removed - not available from useGraphManager */}
      </div>

      {/* Control Button */}
      <div className="flex gap-2 mb-3">
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
        <Alert variant="destructive" className="mb-3">
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

  // Always render the full app UI - no conditional rendering
  return (
    <div className="min-h-screen bg-background">
      <FloatingWindowManagerProvider>
        <div className="grid grid-cols-1 p-4">
          {/* Side by side layout - FileWatching (1/6) and VoiceTranscribe (5/6) */}
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

          {/* Main Graph Visualization with Sidebar */}
          <div className="border-r pr-4">
            <Sidebar>
              <VoiceTreeGraphVizLayout
                isWatching={isWatching}
                isLoading={isLoading}
                watchDirectory={watchDirectory}
                error={error}
                startWatching={startWatching}
                stopWatching={stopWatching}
                clearError={clearError}
              />
            </Sidebar>
          </div>
        </div>
      </FloatingWindowManagerProvider>
    </div>
  );
}

export default App;
