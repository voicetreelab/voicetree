import VoiceTreeTranscribe from "@/shell/UI/views/renderers/voicetree-transcribe";
import {useFolderWatcher} from "@/shell/UI/views/hooks/useFolderWatcher";
import {useEventSubscriptionConnection} from "@/shell/edge/renderer/live/useEventSubscriptionConnection";
import {VoiceTreeGraphView} from "@/shell/UI/views/graph-view/VoiceTreeGraphView";
import {attachDotGridBackground} from "@/shell/edge/UI-edge/graph/view/dotGridBackground";
import {AgentStatsPanel} from "@/shell/UI/views/ui-controls/AgentStatsPanel";
import {ProjectPathSelector} from "@/shell/UI/views/components/ProjectPathSelector";
import {ProjectSelectionScreen} from "@/shell/UI/ProjectSelectionScreen";
import {ViewSwitcher} from "@/shell/edge/UI-edge/components/ViewSwitcher";
import {useEffect, useRef, useState, useCallback} from "react";
import type { JSX } from "react/jsx-runtime";
import type { RefObject } from "react";
import type {} from "@/shell/electron";
import type { SavedProject } from "@vt/graph-model/project";
import type { VTSettings } from "@vt/graph-model/settings";
import type { ProjectedGraph } from "@vt/graph-state/contract";

type AppView = 'project-selection' | 'graph-view';

interface OpenedProjectState {
    readonly path: string;
    readonly sessionId: string;
}

function getProjectNameFromPath(projectPath: string): string {
    const parts: string[] = projectPath.split(/[/\\]/);
    return parts[parts.length - 1] ?? projectPath;
}

function createFallbackProject(projectPath: string): SavedProject {
    return {
        id: `auto:${projectPath}`,
        path: projectPath,
        name: getProjectNameFromPath(projectPath),
        type: 'folder',
        lastOpened: Date.now(),
    };
}

function isProjectedGraph(value: unknown): value is ProjectedGraph {
    return typeof value === 'object'
        && value !== null
        && Array.isArray((value as Partial<ProjectedGraph>).nodes)
        && Array.isArray((value as Partial<ProjectedGraph>).edges);
}

function App(): JSX.Element {
    const [electronReady, setElectronReady] = useState<boolean>(() => window.electronAPI !== undefined);
    // App navigation state
    const [currentView, setCurrentView] = useState<AppView>('project-selection');
    const [currentProject, setCurrentProject] = useState<SavedProject | null>(null);
    const [openedProject, setOpenedProject] = useState<OpenedProjectState | null>(null);
    const pendingInitialProjectedGraphRef = useRef<ProjectedGraph | null>(null);
    const [projectSwitching, setProjectSwitching] = useState<boolean>(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const hasBootstrappedStartupProjectRef = useRef(false);
    const lastKnownProjectPathRef = useRef<string | null>(null);

    // Use the folder watcher hook for file watching
    const {
        watchDirectory,
        isWatching: _isWatching,
        startWatching,
        stopWatching,
    } = useFolderWatcher();

    // Step 9 §8.1: renderer subscribes to /events directly; isConnected
    // gates renderer mutations (point 7 of the 9e brief).
    const { isConnected: _daemonConnected } = useEventSubscriptionConnection();

    // Ref for graph container
    const graphContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
    // Ref for UI overlay container (sidebar, overlays, title bar, tabs)
    const uiContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
    // Ref for dot-grid underlay (sits behind the transparent Cytoscape canvas)
    const dotGridRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

    // State for agent stats panel visibility
    const [isStatsPanelOpen, setIsStatsPanelOpen] = useState(false);

    const loadProjectForDirectory: (directory: string) => Promise<SavedProject> = useCallback(async (directory: string): Promise<SavedProject> => {
        if (!window.electronAPI) throw new Error('Electron API unavailable');

        const projects: SavedProject[] = await window.electronAPI.main.loadProjects();
        const matchingProject: SavedProject | undefined = projects.find((project) => project.path === directory);

        return matchingProject ?? createFallbackProject(directory);
    }, []);

    const syncProjectFromDirectory: (directory: string) => Promise<void> = useCallback(async (directory: string): Promise<void> => {
        const project: SavedProject = await loadProjectForDirectory(directory);
        setCurrentProject(project);
        setCurrentView('graph-view');
    }, [loadProjectForDirectory]);

    const openProjectForProject: (project: SavedProject) => Promise<void> = useCallback(async (project: SavedProject): Promise<void> => {
        if (!window.electronAPI) return;

        const response = await window.electronAPI.main.openProject(project.path);
        const projectRoot: string = response.projectState.projectRoot;
        const openedProject: SavedProject = {
            ...project,
            path: projectRoot,
            lastOpened: Date.now(),
        };

        try {
            await window.electronAPI.main.saveProject(openedProject);
        } catch (err) {
            console.error('[App] Failed to save opened project metadata:', err);
        }

        lastKnownProjectPathRef.current = projectRoot;
        pendingInitialProjectedGraphRef.current = isProjectedGraph(response.initialProjectedGraph)
            ? response.initialProjectedGraph
            : null;
        setOpenedProject({
            path: projectRoot,
            sessionId: response.sessionId,
        });
        setProjectError(null);
        setCurrentProject(openedProject);
        setCurrentView('graph-view');
    }, []);

    // Handle project selection
    const handleProjectSelected: (project: SavedProject) => Promise<void> = useCallback(async (project: SavedProject): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            await openProjectForProject(project);
        } catch (err) {
            console.error('[App] Failed to open project:', err);
            setProjectError(err instanceof Error ? err.message : String(err));
        }
    }, [openProjectForProject]);

    const retryLastKnownProject: () => Promise<void> = useCallback(async (): Promise<void> => {
        if (!lastKnownProjectPathRef.current) return;
        const project: SavedProject = await loadProjectForDirectory(lastKnownProjectPathRef.current);
        await openProjectForProject(project);
    }, [loadProjectForDirectory, openProjectForProject]);

    // Handle returning to project selection
    const handleBackToProjects: () => Promise<void> = useCallback(async (): Promise<void> => {
        // Stop watching the current folder
        await stopWatching();
        setCurrentProject(null);
        setOpenedProject(null);
        setCurrentView('project-selection');
    }, [stopWatching]);

    // Listen for stats panel toggle event from SpeedDial menu
    useEffect(() => {
        const handleToggleStats: () => void = (): void => setIsStatsPanelOpen(prev => !prev);
        window.addEventListener('toggle-stats-panel', handleToggleStats);
        return () => window.removeEventListener('toggle-stats-panel', handleToggleStats);
    }, []);

    useEffect(() => {
        if (electronReady) return;

        if (window.electronAPI !== undefined) {
            setElectronReady(true);
            return;
        }

        const intervalId: number = window.setInterval(() => {
            if (window.electronAPI !== undefined) {
                setElectronReady(true);
                window.clearInterval(intervalId);
            }
        }, 50);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [electronReady]);

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

    // Recover programmatic loads even if they happened before React attached IPC listeners.
    useEffect(() => {
        if (!electronReady || !window.electronAPI || hasBootstrappedStartupProjectRef.current) return;
        const getStartupProjectHint = window.electronAPI.main.getStartupProjectHint;
        if (typeof getStartupProjectHint !== 'function') return;

        hasBootstrappedStartupProjectRef.current = true;
        let cancelled = false;

        void (async () => {
            try {
                const startupHint = await getStartupProjectHint();

                if (cancelled) return;
                if (startupHint.kind === 'open-folder') {
                    const project: SavedProject = await loadProjectForDirectory(startupHint.projectPath);
                    if (!cancelled) await openProjectForProject(project);
                }
            } catch (err) {
                console.error('[App] Failed to bootstrap startup project:', err);
                setProjectError(err instanceof Error ? err.message : String(err));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [electronReady, loadProjectForDirectory, openProjectForProject]);

    useEffect(() => {
        if (!electronReady || !window.electronAPI) return;

        const cleanupSwitching = window.electronAPI.onProjectSwitching?.((data: { path: string }) => {
            lastKnownProjectPathRef.current = data.path;
            setProjectSwitching(true);
            setProjectError(null);
        }) ?? (() => {});
        const cleanupReady = window.electronAPI.onProjectReady?.((data: { path: string }) => {
            lastKnownProjectPathRef.current = data.path;
            setProjectSwitching(false);
            setProjectError(null);
            void syncProjectFromDirectory(data.path);
            // Reopen / project-switch re-primes the registry but never replays
            // the spawn-time launch events; rehydrate so panels for already-
            // running agents reappear. Idempotent with the mount-time trigger.
            void window.electronAPI?.terminal?.rehydrate?.();
        }) ?? (() => {});
        const cleanupLost = window.electronAPI.onProjectLost?.((data: { path?: string; error?: string }) => {
            if (data.path) lastKnownProjectPathRef.current = data.path;
            setProjectSwitching(false);
            setProjectError(data.error ?? 'Project unavailable');
        }) ?? (() => {});

        return () => {
            cleanupSwitching();
            cleanupReady();
            cleanupLost();
        };
    }, [electronReady, syncProjectFromDirectory]);

    // File Watching Control Panel Component - compact inline style matching activity panel
    const FileWatchingPanel: () => JSX.Element = () => {
        const displayedDirectory: string | undefined = watchDirectory ?? currentProject?.path;

        return (
            <div className="flex items-center gap-1 font-mono text-xs shrink-0">
                {/* Back button */}
                <button
                    onClick={() => void handleBackToProjects()}
                    className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors"
                    title="Back to project selection"
                >
                    ←
                </button>
                {displayedDirectory && (
                    <>
                        <button
                            onClick={() => void startWatching()}
                            className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors flex items-center gap-1"
                            title="Project root – agents spawn here by default"
                        >
                            {displayedDirectory.split(/[/\\]/).pop()}
                            <span className="text-[10px] ml-1">▼</span>
                        </button>
                        <span className="text-muted-foreground">/</span>
                        <ProjectPathSelector />
                    </>
                )}
            </div>
        );
    };

    // Listen for backend logs and display in dev console
    useEffect(() => {
        if (!window.electronAPI?.onBackendLog) return;

        window.electronAPI.onBackendLog((_log: string) => {
            //console.log('[Backend]', _log);
        });
    }, []);


    // Initialize VoiceTreeGraphView when container is ready and in graph view
    // Settings loaded async before init so showFps can be passed to the WebGL renderer at creation time
    useEffect(() => {
        if (currentView !== 'graph-view' || !graphContainerRef.current || !uiContainerRef.current) return;

        console.trace('[App] VoiceTreeGraphView initialization stack trace'); // DEBUG: Track if called multiple times

        let graphView: VoiceTreeGraphView | null = null;
        let disposed: boolean = false;
        const initialProjectedGraph: ProjectedGraph | null = pendingInitialProjectedGraphRef.current;
        pendingInitialProjectedGraphRef.current = null;

        void (async () => {
            const settings: VTSettings | null = await window.electronAPI?.main?.loadSettings() ?? null;
            if (disposed) return; // View changed before settings loaded

            graphView = new VoiceTreeGraphView(
                graphContainerRef.current!,
                uiContainerRef.current!,
                {
                    initialDarkMode: false,
                    showFps: settings?.showFps ?? false,
                    initialProjectedGraph: initialProjectedGraph ?? undefined,
                }
            );

            // The constructor sets the cytoscape instance synchronously, so the
            // launchTerminalOntoUI calls this triggers (via getCyInstance) are now
            // safe. Ask main to re-launch a floating panel for every live terminal
            // in the registry. This runs on every fresh renderer mount — crucially
            // including a Cmd+R reload, after which the spawn-time
            // `terminal-ui-launch` events are never replayed — so panels for
            // still-running agents reappear instead of vanishing. Idempotent; the
            // project:ready handler triggers the same path for reopen and the
            // cold-boot race where the registry is primed after this point.
            void window.electronAPI?.terminal?.rehydrate?.();
        })();

        // Cleanup on unmount or view change
        return () => {
            console.trace('[App] VoiceTreeGraphView disposal stack trace'); // DEBUG: Track cleanup
            disposed = true;
            graphView?.dispose();
        };
    }, [currentView, openedProject?.sessionId]); // Reinitialize when the active project session changes

    // Attach dot-grid background subscriber when in graph view
    useEffect(() => {
        if (currentView !== 'graph-view' || !dotGridRef.current) return;
        return attachDotGridBackground(dotGridRef.current);
    }, [currentView]);

    // Render project selection screen
    if (currentView === 'project-selection') {
        return <ProjectSelectionScreen onProjectSelected={(project) => void handleProjectSelected(project)} />;
    }

    // Render graph view
    return (
        <div className="fixed inset-0 overflow-clip bg-background">
            {/* Layer 0: Dot-grid underlay - sits behind the transparent Cytoscape canvas */}
            <div ref={dotGridRef} className="absolute inset-0 pb-14 dot-grid pointer-events-none"/>
            {/* Layer 1: Graph canvas - Cytoscape only, absolutely positioned so it never causes overflow.
                `isolate` makes this an isolated stacking context: DOM overlays appended into the cy
                container (the folder-handle chevron/eye chips) are confined to the graph layer and can
                never paint over Layer 2 chrome, regardless of their own z-index. */}
            <div ref={graphContainerRef} className="absolute inset-0 pb-14 overflow-hidden isolate"/>
            {/* Layer 2: UI overlay - sidebar, overlays, title bar, tabs */}
            <div ref={uiContainerRef} className="absolute inset-0 pb-14 pointer-events-none [&>*]:pointer-events-auto"/>

            {(projectSwitching || projectError) && (
                <div className="fixed top-3 left-1/2 z-[1300] -translate-x-1/2 rounded border border-border bg-background px-3 py-2 text-sm shadow-lg">
                    {projectSwitching ? (
                        <span className="text-foreground">Opening project...</span>
                    ) : (
                        <div className="flex items-center gap-3">
                            <span className="text-destructive">{projectError}</span>
                            <button
                                onClick={() => void retryLastKnownProject()}
                                className="rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-accent"
                                type="button"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Bottom bar: Fixed to viewport bottom to prevent dropdown-induced layout shifts */}
            <div className="fixed bottom-0 left-0 right-0 z-[1050] py-1 bg-background">
                {/* File watching panel + view switcher - anchored bottom left, vertically centered */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <FileWatchingPanel/>
                    <ViewSwitcher/>
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
