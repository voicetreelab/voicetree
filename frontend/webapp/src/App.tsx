import VoiceTreeLayout from "./components/voicetree-layout";
import VoiceTreeTranscribe from "./renderers/voicetree-transcribe";
import Sidebar from "./components/sidebar";
import FileWatcherDemo from "./components/file-watcher-demo";
import { useGraphManager } from "./hooks/useGraphManager";
import { Button } from "./components/ui/button";
import { Alert, AlertDescription } from "./components/ui/alert";
import { FloatingWindowManagerProvider } from "./components/floating-windows/context/FloatingWindowManager";

// Import mock setup synchronously
import "./test/setup-browser-tests";

function App() {
  // Use the graph manager hook for file watching
  const {
    graphData,
    isWatching,
    isLoading,
    watchDirectory,
    error,
    startWatching,
    stopWatching,
    clearError,
    isElectron
  } = useGraphManager();

  // Show both components so we can compare them
  const showBoth = true;

  // File Watching Control Panel Component
  const FileWatchingPanel = () => (
    <div className="border rounded-lg p-4 bg-white shadow-sm">
      <h3 className="text-md font-semibold mb-3">Live File Watching</h3>

      {/* Status Display */}
      <div className="mb-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Status:</span>
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

        {graphData && (
          <div className="mt-1">
            <span className="font-medium">Nodes:</span>
            <span className="text-xs text-gray-600 ml-1">
              {graphData.nodes.length} | Edges: {graphData.edges.length}
            </span>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex gap-2 mb-3">
        {isElectron ? (
          <>
            <Button
              onClick={startWatching}
              disabled={isLoading || isWatching}
              size="sm"
              variant="default"
            >
              {isLoading ? 'Starting...' : 'Open Folder'}
            </Button>
            <Button
              onClick={stopWatching}
              disabled={isLoading || !isWatching}
              size="sm"
              variant="secondary"
            >
              {isLoading ? 'Stopping...' : 'Stop Watching'}
            </Button>
          </>
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
            <span>{typeof error === 'string' ? error : error.message}</span>
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

  if (showBoth) {
    return (
      <div className="min-h-screen bg-background">
        <FloatingWindowManagerProvider>
          <div className="grid grid-cols-1 gap-4 p-4">
              {/* File Watching Panel - New Feature */}
              <div>
                  <h2 className="text-lg font-bold mb-2">Live Graph From Files</h2>
                  <FileWatchingPanel />
              </div>

              {/* File Watcher Demo - For comparison */}
              <div>
                  <h2 className="text-lg font-bold mb-2">File Watcher Demo</h2>
                  <FileWatcherDemo />
              </div>

              {/* Above - VoiceTreeTranscribe */}
              <div>
                  <h2 className="text-lg font-bold mb-2">VoiceTreeTranscribe Component</h2>
                  <VoiceTreeTranscribe />
              </div>

            {/* Left side - Original with Sidebar */}
            <div className="border-r pr-4">
              <Sidebar>
                <VoiceTreeLayout graphData={graphData} fileData={markdownFiles.current} />
              </Sidebar>
            </div>
          </div>
        </FloatingWindowManagerProvider>
      </div>
    );
  }

  // Original code - Enhanced with file watching
  return (
    <FloatingWindowManagerProvider>
      <Sidebar>
        <VoiceTreeLayout graphData={graphData} fileData={markdownFiles.current} />
      </Sidebar>
    </FloatingWindowManagerProvider>
  );
}

export default App;