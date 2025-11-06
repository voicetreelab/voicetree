import VoiceTreeTranscribe from "./renderers/voicetree-transcribe";
import Sidebar from "./components/sidebar";
import { useFolderWatcher } from "./hooks/useFolderWatcher.tsx";
import { Button } from "./components/ui/button";
import { Alert, AlertDescription } from "./components/ui/alert";
import { VoiceTreeGraphView } from "./views/VoiceTreeGraphView";
import { ElectronMarkdownVault } from "./providers/ElectronMarkdownVault";
import { useEffect, useRef } from "react";

function App() {
  // Use the folder watcher hook for file watching
  const {
    isWatching,
    isLoading,
    watchDirectory,
    error,
    startWatching,
    stopWatching,
    clearError,
    isElectron
  } = useFolderWatcher();

  // Ref for graph container
  const graphContainerRef = useRef<HTMLDivElement>(null);

  // File Watching Control Panel Component
  const FileWatchingPanel = () => (
    <div className="border rounded-lg p-2 mt-2 bg-white shadow-sm">

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
            {/*<span className="font-medium">Directory:</span>*/}
            <span className="text-xs text-gray-600 ml-1 font-mono">
              {watchDirectory}
            </span>
          </div>
        )}

        {/* Graph data display removed - not available from useFolderWatcher */}
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

  // Listen for backend logs and display in dev console
  useEffect(() => {
    if (!window.electronAPI?.onBackendLog) return;

    window.electronAPI.onBackendLog((log: string) => {
      console.log('[Backend]', log);
    });
  }, []);

  // Initialize VoiceTreeGraphView when container is ready
  useEffect(() => {
    if (!graphContainerRef.current) return;

    console.log('[App] Initializing VoiceTreeGraphView');
    console.trace('[App] VoiceTreeGraphView initialization stack trace'); // DEBUG: Track if called multiple times
    const vaultProvider = new ElectronMarkdownVault();

    // Subscribe to watching-started event to store vault directory
    // This is critical for floating editors to work - they need the vault absolutePath
    const watchingSubscription = vaultProvider.onWatchingStarted((event) => {
      console.log('[App] Vault watching started:', event.directory);
    });

    const graphView = new VoiceTreeGraphView(graphContainerRef.current, vaultProvider, {
      initialDarkMode: false
    });

    // Cleanup on unmount
    return () => {
      console.log('[App] Disposing VoiceTreeGraphView');
      console.trace('[App] VoiceTreeGraphView disposal stack trace'); // DEBUG: Track cleanup
      watchingSubscription.dispose();
      graphView.dispose();
    };
  }, []); // Empty deps - only run once on mount

  // Always render the full app UI - no conditional rendering
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Top Section: Transcribe UI (auto height) */}
      <div className="flex-shrink-0 py-2 px-4">
        <div className="flex gap-4">
          {/* File Watching Panel - 1/6 width */}
          <div className="w-1/6">
            <FileWatchingPanel />
          </div>

          {/* Voice Transcribe Component - 5/6 width */}
          <div className="flex-1">
            <VoiceTreeTranscribe />
            {/*//            <VoiceInputViewWrapper /> broken*/}
          </div>
        </div>
      </div>

      {/*/!* Bottom Section: Graph (fills remaining space) *!/*/}
      {/*<div className="flex-1 min-h-0 border-r pr-4">*/}
      {/*  <Sidebar>*/}
      {/*    <div ref={graphContainerRef} className="h-full w-full" />*/}
      {/*  </Sidebar>*/}
      {/*</div>*/}
    </div>
  );
}

export default App;
