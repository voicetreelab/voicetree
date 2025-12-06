import VoiceTreeTranscribe from "@/shell/UI/views/renderers/voicetree-transcribe";
import {useFolderWatcher} from "@/shell/UI/views/hooks/useFolderWatcher";
import {VoiceTreeGraphView} from "@/shell/UI/views/VoiceTreeGraphView";
import {useEffect, useRef} from "react";
import type { JSX } from "react/jsx-runtime";
import type { RefObject } from "react";
import type {} from "@/shell/electron";

function App(): JSX.Element {
    // Use the folder watcher hook for file watching
    const {
        watchDirectory,
        startWatching,
    } = useFolderWatcher();

    // Ref for graph container
    const graphContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);


    // File Watching Control Panel Component - compact inline style matching activity panel
    const FileWatchingPanel: () => JSX.Element = () => (
        <div className="flex items-center gap-1 font-mono text-xs shrink-0">
            {watchDirectory && (
                <button
                    onClick={() => void startWatching()}
                    className="text-gray-600 px-1.5 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors flex items-center gap-1"
                    title={watchDirectory}
                >
                    {watchDirectory.split('/').pop()}
                    <span className="text-[10px] ml-1">▼</span>
                </button>
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
            {/* Graph Section (fills all space) */}
            <div className="flex-1 min-h-0 border-r pr-4 relative">
                {/* Graph container */}
                <div className="h-full w-full relative">
                    <div ref={graphContainerRef} className="h-full w-full"/>
                </div>
            </div>

            {/* Bottom bar: Folder selector | Activity Log (narrow) | Transcription Panel */}
            <div className="flex-shrink-0 flex items-center gap-3 px-2 py-1 mr-[140px] relative z-[1050]">
                <FileWatchingPanel/>
                {/* Activity log - width for ~4 items, expands on hover via CSS */}
                <div id="sse-status-panel-mount" className="w-[420px] shrink-0 overflow-visible" />
                {/* Transcription panel - takes remaining space */}
                <div className="flex-1 min-w-0">
                    <VoiceTreeTranscribe/>
                </div>
            </div>
        </div>
    );
}

export default App;
