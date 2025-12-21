import VoiceTreeTranscribe from "@/shell/UI/views/renderers/voicetree-transcribe";
import {useFolderWatcher} from "@/shell/UI/views/hooks/useFolderWatcher";
import {VoiceTreeGraphView} from "@/shell/UI/views/VoiceTreeGraphView";
import {useEffect, useRef, useState} from "react";
import type { JSX } from "react/jsx-runtime";
import type { RefObject, KeyboardEvent, FocusEvent, ChangeEvent } from "react";
import type {} from "@/shell/electron";

function App(): JSX.Element {
    // Use the folder watcher hook for file watching
    const {
        watchDirectory,
        vaultSuffix,
        startWatching,
        setVaultSuffix,
    } = useFolderWatcher();

    // Ref for graph container
    const graphContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

    // State for inline editing of vault suffix
    const [isEditingSuffix, setIsEditingSuffix] = useState(false);
    const [editedSuffix, setEditedSuffix] = useState(vaultSuffix ?? 'voicetree');

    // Sync editedSuffix when vaultSuffix changes from external sources
    useEffect(() => {
        if (!isEditingSuffix) {
            setEditedSuffix(vaultSuffix ?? '');
        }
    }, [vaultSuffix, isEditingSuffix]);

    const handleSuffixClick: () => void = () => {
        setIsEditingSuffix(true);
        setEditedSuffix(vaultSuffix ?? '');
    };

    const handleSuffixBlur: (e: FocusEvent<HTMLInputElement>) => void = (e: FocusEvent<HTMLInputElement>) => {
        setIsEditingSuffix(false);
        const newSuffix: string = e.target.value.trim();
        // Allow empty suffix, only update if changed
        if (newSuffix !== vaultSuffix) {
            void setVaultSuffix(newSuffix);
        }
    };

    const handleSuffixKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            setEditedSuffix(vaultSuffix ?? 'voicetree');
            setIsEditingSuffix(false);
        }
    };

    const handleSuffixChange: (e: ChangeEvent<HTMLInputElement>) => void = (e: ChangeEvent<HTMLInputElement>) => {
        setEditedSuffix(e.target.value);
    };

    // File Watching Control Panel Component - compact inline style matching activity panel
    const FileWatchingPanel: () => JSX.Element = () => (
        <div className="flex items-center gap-1 font-mono text-xs shrink-0">
            {watchDirectory && (
                <>
                    <button
                        onClick={() => void startWatching()}
                        className="text-gray-600 px-1.5 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors flex items-center gap-1"
                        title="Project root – agents spawn here by default"
                    >
                        {watchDirectory.split('/').pop()}
                        <span className="text-[10px] ml-1">▼</span>
                    </button>
                    {(vaultSuffix ?? isEditingSuffix) && <span className="text-gray-400">/</span>}
                    {isEditingSuffix ? (
                        <input
                            type="text"
                            value={editedSuffix}
                            onChange={handleSuffixChange}
                            onBlur={handleSuffixBlur}
                            onKeyDown={handleSuffixKeyDown}
                            autoFocus
                            placeholder="(no subfolder)"
                            className="text-gray-600 px-1.5 py-1 rounded bg-white border border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 w-24"
                        />
                    ) : (
                        <button
                            onClick={handleSuffixClick}
                            className="text-gray-600 px-1.5 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                            title="Vault – .md file storage for graph nodes"
                        >
                            {vaultSuffix ?? <span className="text-gray-400 italic">(edit)</span>}
                        </button>
                    )}
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

            {/* Bottom bar: Folder selector (left) | Transcription Panel (centered, includes SSE activity panel) */}
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
        </div>
    );
}

export default App;
