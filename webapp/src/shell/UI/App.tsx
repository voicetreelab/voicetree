import VoiceTreeTranscribe from "@/shell/UI/views/renderers/voicetree-transcribe";
import {useFolderWatcher} from "@/shell/UI/views/hooks/useFolderWatcher";
import {VoiceTreeGraphView} from "@/shell/UI/views/VoiceTreeGraphView";
import {AgentStatsPanel} from "@/shell/UI/views/AgentStatsPanel";
import {VaultPathSelector} from "@/shell/UI/views/components/VaultPathSelector";
import {ProjectSelectionScreen} from "@/shell/UI/ProjectSelectionScreen";
import {useEffect, useRef, useState, useCallback} from "react";
import type { JSX } from "react/jsx-runtime";
import type { RefObject } from "react";
import type {} from "@/shell/electron";
import type { SavedProject } from "@/pure/project/types";

type AppView = 'project-selection' | 'graph-view';

function App(): JSX.Element {
    // App navigation state
    const [currentView, setCurrentView] = useState<AppView>('project-selection');
    const [currentProject, setCurrentProject] = useState<SavedProject | null>(null);

    // Use the folder watcher hook for file watching
    const {
        watchDirectory,
        isWatching: _isWatching,
        startWatching,
        stopWatching,
    } = useFolderWatcher();

    // Ref for graph container
    const graphContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
    // Ref for UI overlay container (sidebar, overlays, title bar, tabs)
    const uiContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

    // State for agent stats panel visibility
    const [isStatsPanelOpen, setIsStatsPanelOpen] = useState(false);

    // Handle project selection
    const handleProjectSelected: (project: SavedProject) => Promise<void> = useCallback(async (project: SavedProject): Promise<void> => {
        if (!window.electronAPI) return;

        // Initialize project if needed (creates /voicetree-{date} folder)
        if (!project.voicetreeInitialized) {
            try {
                // initializeProject returns voicetree path if created, or existing path if already exists
                await window.electronAPI.main.initializeProject(project.path);
                // Mark as initialized regardless of whether we created it or it existed
                const updatedProject: SavedProject = { ...project, voicetreeInitialized: true };
                await window.electronAPI.main.saveProject(updatedProject);
                setCurrentProject(updatedProject);
            } catch (err) {
                console.error('[App] Failed to initialize project:', err);
                setCurrentProject(project);
            }
        } else {
            setCurrentProject(project);
        }

        setCurrentView('graph-view');
    }, []);

    // Handle returning to project selection
    const handleBackToProjects: () => Promise<void> = useCallback(async (): Promise<void> => {
        // Stop watching the current folder
        await stopWatching();
        setCurrentProject(null);
        setCurrentView('project-selection');
    }, [stopWatching]);

    // Listen for stats panel toggle event from SpeedDial menu
    useEffect(() => {
        const handleToggleStats: () => void = (): void => setIsStatsPanelOpen(prev => !prev);
        window.addEventListener('toggle-stats-panel', handleToggleStats);
        return () => window.removeEventListener('toggle-stats-panel', handleToggleStats);
    }, []);

    // Listen for stats panel close event (dispatched when clicking on graph canvas)
    useEffect(() => {
        const handleCloseStats: () => void = (): void => setIsStatsPanelOpen(false);
        window.addEventListener('close-stats-panel', handleCloseStats);
        return () => window.removeEventListener('close-stats-panel', handleCloseStats);
    }, []);

    // Sync stats panel open state to <html> so CSS can shift the speed dial
    useEffect(() => {
        document.documentElement.toggleAttribute('data-stats-panel-open', isStatsPanelOpen);
    }, [isStatsPanelOpen]);

    // Listen for watching-started event from main process (e.g., when prettySetupAppForElectronDebugging loads a project)
    // This switches the UI to graph view when a project is loaded programmatically
    useEffect(() => {
        if (!window.electronAPI?.onWatchingStarted) return;

        const cleanup: (() => void) = window.electronAPI.onWatchingStarted((data: { directory: string; timestamp: string }) => {
            // Only switch view if we're still on project selection screen
            if (currentView === 'project-selection') {
                // Look up the saved project by path (prettySetup saves it before starting file watching)
                void (async () => {
                    const projects: SavedProject[] = await window.electronAPI!.main.loadProjects();
                    const matchingProject: SavedProject | undefined = projects.find((p: SavedProject) => p.path === data.directory);
                    if (matchingProject) {
                        setCurrentProject(matchingProject);
                        setCurrentView('graph-view');
                    } else {
                        console.warn('[App] watching-started for unknown project:', data.directory);
                    }
                })();
            }
        });

        return cleanup;
    }, [currentView]);

    // Start watching the project folder when entering graph view
    // Always call startFileWatching - loadFolder handles the reload case (e.g., after cmd-r)
    useEffect(() => {
        if (currentView === 'graph-view' && currentProject && window.electronAPI) {
            // Start file watching for the selected project
            void window.electronAPI.main.startFileWatching(currentProject.path);
        }
    }, [currentView, currentProject]);

    // File Watching Control Panel Component - compact inline style matching activity panel
    const FileWatchingPanel: () => JSX.Element = () => (
        <div className="flex items-center gap-1 font-mono text-xs shrink-0">
            {/* Back button */}
            <button
                onClick={() => void handleBackToProjects()}
                className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors"
                title="Back to project selection"
            >
                ←
            </button>
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

        window.electronAPI.onBackendLog((_log: string) => {
            //console.log('[Backend]', _log);
        });
    }, []);


    // Initialize VoiceTreeGraphView when container is ready and in graph view
    useEffect(() => {
        if (currentView !== 'graph-view' || !graphContainerRef.current || !uiContainerRef.current) return;

        console.trace('[App] VoiceTreeGraphView initialization stack trace'); // DEBUG: Track if called multiple times

        const graphView: VoiceTreeGraphView = new VoiceTreeGraphView(
            graphContainerRef.current,
            uiContainerRef.current,
            { initialDarkMode: false }
        );

        // Cleanup on unmount or view change
        return () => {
            console.trace('[App] VoiceTreeGraphView disposal stack trace'); // DEBUG: Track cleanup
            graphView.dispose();
        };
    }, [currentView]); // Reinitialize when view changes

    // Render project selection screen
    if (currentView === 'project-selection') {
        return <ProjectSelectionScreen onProjectSelected={(project) => void handleProjectSelected(project)} />;
    }

    // Render graph view
    return (
        <div className="h-screen relative bg-background">
            {/* Layer 1: Graph canvas - Cytoscape only, absolutely positioned so it never causes overflow */}
            <div ref={graphContainerRef} className="absolute inset-0 pb-14 overflow-hidden bg-background"/>
            {/* Layer 2: UI overlay - sidebar, overlays, title bar, tabs */}
            <div ref={uiContainerRef} className="absolute inset-0 pb-14 pointer-events-none [&>*]:pointer-events-auto"/>

            {/* Bottom bar: Fixed to viewport bottom to prevent dropdown-induced layout shifts */}
            <div className="fixed bottom-0 left-0 right-0 z-[1050] py-1 bg-background">
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
                    <div className="sticky top-0 bg-card border-b border-border p-2 flex items-center">
                        <h2 className="font-mono text-sm font-semibold text-foreground">Agent Statistics</h2>
                    </div>
                    <AgentStatsPanel/>
                </div>
            )}
        </div>
    );
}

export default App;
