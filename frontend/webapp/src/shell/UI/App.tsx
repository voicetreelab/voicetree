import VoiceTreeTranscribe from "@/shell/UI/views/renderers/voicetree-transcribe";
import {useFolderWatcher} from "@/shell/UI/views/hooks/useFolderWatcher";
import {VoiceTreeGraphView} from "@/shell/UI/views/VoiceTreeGraphView";
import {AgentStatsPanel} from "@/shell/UI/views/AgentStatsPanel";
import {VaultPathSelector} from "@/shell/UI/views/components/VaultPathSelector";
import {useEffect, useRef, useState} from "react";
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

    // State for agent stats panel visibility
    const [isStatsPanelOpen, setIsStatsPanelOpen] = useState(false);

    // Listen for stats panel toggle event from SpeedDial menu
    useEffect(() => {
        const handleToggleStats: () => void = (): void => setIsStatsPanelOpen(prev => !prev);
        window.addEventListener('toggle-stats-panel', handleToggleStats);
        return () => window.removeEventListener('toggle-stats-panel', handleToggleStats);
    }, []);

    // File Watching Control Panel Component - compact inline style matching activity panel
    const FileWatchingPanel: () => JSX.Element = () => (
        <div className="flex items-center gap-1 font-mono text-xs shrink-0">
            {watchDirectory && (
                <>
                    <button
                        onClick={() => void startWatching()}
                        className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors flex items-center gap-1"
                        title="Project root – agents spawn here by default"
                    >
                        {watchDirectory.split(/[/\\]/).pop()}
                        <span className="text-[10px] ml-1">▼</span>
                    </button>
                    <span className="text-muted-foreground">/</span>
                    <VaultPathSelector watchDirectory={watchDirectory} />
                </>
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

            {/* Bottom bar: Folder selector (left) | Transcription Panel (centered, includes SSE activity panel) | Stats toggle (right) */}
            <div className="flex-shrink-0 relative z-[1050] py-1 bg-background">
                {/* File watching panel - anchored bottom left, vertically centered */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2">
                    <FileWatchingPanel/>
                </div>
                {/* Transcription panel - centered, with right margin? for minimap */}
                <div className="flex justify-center">
                    <VoiceTreeTranscribe/>
                </div>
            </div>

            {/* Agent Stats Panel - slide out from right */}
            {isStatsPanelOpen && (
                <div
                    data-testid="agent-stats-panel-container"
                    className="fixed right-0 top-0 bottom-0 w-96 bg-card border-l border-border shadow-lg z-[1200] overflow-y-auto"
                >
                    <div className="sticky top-0 bg-card border-b border-border p-2 flex items-center justify-between">
                        <h2 className="font-mono text-sm font-semibold text-foreground">Agent Statistics</h2>
                        <button
                            data-testid="agent-stats-close-button"
                            onClick={() => setIsStatsPanelOpen(false)}
                            className="text-muted-foreground px-2 py-1 rounded bg-muted hover:bg-accent transition-colors font-mono text-xs"
                            title="Close panel"
                        >
                            ✕
                        </button>
                    </div>
                    <AgentStatsPanel/>
                </div>
            )}
        </div>
    );
}

export default App;
