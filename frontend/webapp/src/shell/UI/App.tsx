import VoiceTreeTranscribe from "@/shell/UI/views/renderers/voicetree-transcribe";
import {useFolderWatcher} from "@/shell/UI/views/hooks/useFolderWatcher";
import {Alert, AlertDescription} from "@/shell/UI/views/components/ui/alert";
import {Button} from "@/shell/UI/views/components/ui/button";
import {VoiceTreeGraphView} from "@/shell/UI/views/VoiceTreeGraphView";
import {useEffect, useRef} from "react";
import type { JSX } from "react/jsx-runtime";
import type { RefObject } from "react";
import "@/shell/UI/sse-status-panel/status-panel.css";
import type {} from "@/shell/electron";

function App(): JSX.Element {
    // Use the folder watcher hook for file watching
    const {
        isWatching,
        isLoading,
        watchDirectory,
        error,
        clearError,
    } = useFolderWatcher();

    // Ref for graph container
    const graphContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);


    // File Watching Control Panel Component
    const FileWatchingPanel: () => JSX.Element = () => (
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
                        <span
                            className="text-xs text-gray-600 ml-1 font-mono cursor-default"
                            title={watchDirectory}
                        >
                            {watchDirectory.split('/').pop()}
                        </span>
                    </div>
                )}

                {/* Graph data display removed - not available from useFolderWatcher */}
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

        const graphView: VoiceTreeGraphView = new VoiceTreeGraphView(graphContainerRef.current, {
            initialDarkMode: false
        });

        // Cleanup on unmount
        return () => {
            console.log('[App] Disposing VoiceTreeGraphView');
            console.trace('[App] VoiceTreeGraphView disposal stack trace'); // DEBUG: Track cleanup
            graphView.dispose();
        };
    }, []); // Empty deps - only run once on mount


    // Always render the full app UI-edge - no conditional rendering
    return (
        <div className="h-screen flex flex-col overflow-hidden bg-background">
            {/* Graph Section (fills remaining space) */}
            <div className="flex-1 min-h-0 border-r pr-4">
                {/* Relative positioning context for floating windows */}
                <div className="h-full w-full relative">
                    <div ref={graphContainerRef} className="h-full w-full"/>
                </div>
            </div>
            {/* Top Section: Transcribe UI-edge (auto height) - z-index above floating windows (1000) */}
            <div className="flex-shrink-0 py-2 px-4" style={{ position: 'relative', zIndex: 1050 }}>
                <div className="flex gap-4">
                    {/* Left Column: File Watching Panel */}
                    <div className="w-1/4 flex flex-col gap-2">
                        <FileWatchingPanel/>
                    </div>

                    {/* Voice Transcribe Component - reduced width to leave room for minimap */}
                    <div className="flex-1 mr-[140px]">
                        <VoiceTreeTranscribe/>
                    </div>
                </div>
            </div>

            {/* Bottom: Server Activity Panel - window-width horizontal bar */}
            <div id="sse-status-panel-mount" className="flex-shrink-0 mr-[140px] relative z-[1050]" />
        </div>
    );
}

export default App;
