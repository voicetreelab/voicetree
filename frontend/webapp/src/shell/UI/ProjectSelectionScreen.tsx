import { useState, useEffect, useCallback } from 'react';
import type { JSX } from 'react';
import type { SavedProject, DiscoveredProject } from '@/pure/project/types';
import { sortProjectsByLastOpened, filterDiscoveredProjects } from '@/pure/project';
import type {} from '@/shell/electron';

/**
 * Extracts folder name from a path (cross-platform).
 * Handles both forward slashes (Unix/macOS) and backslashes (Windows).
 */
function getFolderName(folderPath: string): string {
    // Split on both / and \ to handle all platforms
    const parts: string[] = folderPath.split(/[/\\]/);
    return parts[parts.length - 1] ?? folderPath;
}

interface ProjectSelectionScreenProps {
    readonly onProjectSelected: (project: SavedProject) => void;
}

/**
 * Formats a timestamp as a relative time string (e.g., "2 hours ago")
 */
function formatRelativeTime(timestamp: number): string {
    const now: number = Date.now();
    const diffMs: number = now - timestamp;
    const diffSeconds: number = Math.floor(diffMs / 1000);
    const diffMinutes: number = Math.floor(diffSeconds / 60);
    const diffHours: number = Math.floor(diffMinutes / 60);
    const diffDays: number = Math.floor(diffHours / 24);

    if (diffDays > 0) {
        return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
    }
    if (diffHours > 0) {
        return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    }
    if (diffMinutes > 0) {
        return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
    }
    return 'Just now';
}

/**
 * Returns an icon character based on project type
 */
function getProjectTypeIcon(type: SavedProject['type'] | DiscoveredProject['type']): string {
    switch (type) {
        case 'git':
            return '⌥'; // Git branch symbol
        case 'obsidian':
            return '◈'; // Diamond for Obsidian
        case 'folder':
            return '📁';
        default:
            return '📁';
    }
}

/**
 * Generates a UUID for new projects
 */
function generateId(): string {
    return crypto.randomUUID();
}

export function ProjectSelectionScreen({ onProjectSelected }: ProjectSelectionScreenProps): JSX.Element {
    const [savedProjects, setSavedProjects] = useState<readonly SavedProject[]>([]);
    const [discoveredProjects, setDiscoveredProjects] = useState<readonly DiscoveredProject[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Load saved projects on mount
    const loadSavedProjects: () => Promise<void> = useCallback(async (): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            const projects: SavedProject[] = await window.electronAPI.main.loadProjects();
            setSavedProjects(sortProjectsByLastOpened(projects));
        } catch (err) {
            console.error('[ProjectSelectionScreen] Failed to load projects:', err);
            setError('Failed to load saved projects');
        }
    }, []);

    // Scan for projects
    const scanForProjects: () => Promise<void> = useCallback(async (): Promise<void> => {
        if (!window.electronAPI) return;

        setIsScanning(true);
        setError(null);

        try {
            // Get default search directories from main process (cross-platform, validated)
            const searchDirs: string[] = await window.electronAPI.main.getDefaultSearchDirectories();

            const discovered: DiscoveredProject[] = await window.electronAPI.main.scanForProjects(searchDirs);

            // Filter out already-saved projects
            const filtered: readonly DiscoveredProject[] = filterDiscoveredProjects(discovered, savedProjects);
            setDiscoveredProjects(filtered);
        } catch (err) {
            console.error('[ProjectSelectionScreen] Failed to scan for projects:', err);
            setError('Failed to scan for projects');
        } finally {
            setIsScanning(false);
        }
    }, [savedProjects]);

    // Initial load
    useEffect(() => {
        const initialize: () => Promise<void> = async (): Promise<void> => {
            setIsLoading(true);
            await loadSavedProjects();
            setIsLoading(false);
        };
        void initialize();
    }, [loadSavedProjects]);

    // Scan after saved projects are loaded
    useEffect(() => {
        if (!isLoading && savedProjects !== undefined) {
            void scanForProjects();
        }
    }, [isLoading, scanForProjects, savedProjects]);

    // Handle adding a discovered project to saved
    const handleAddDiscovered: (discovered: DiscoveredProject) => Promise<void> = async (
        discovered: DiscoveredProject
    ): Promise<void> => {
        if (!window.electronAPI) return;

        const newProject: SavedProject = {
            id: generateId(),
            path: discovered.path,
            name: discovered.name,
            type: discovered.type,
            lastOpened: Date.now(),
            voicetreeInitialized: false,
        };

        try {
            await window.electronAPI.main.saveProject(newProject);
            setSavedProjects((prev) => sortProjectsByLastOpened([...prev, newProject]));
            setDiscoveredProjects((prev) => prev.filter((p) => p.path !== discovered.path));
            onProjectSelected(newProject);
        } catch (err) {
            console.error('[ProjectSelectionScreen] Failed to add project:', err);
            setError('Failed to add project');
        }
    };

    // Handle selecting a saved project
    const handleSelectSaved: (project: SavedProject) => Promise<void> = async (
        project: SavedProject
    ): Promise<void> => {
        if (!window.electronAPI) return;

        // Update lastOpened
        const updated: SavedProject = { ...project, lastOpened: Date.now() };

        try {
            await window.electronAPI.main.saveProject(updated);
            onProjectSelected(updated);
        } catch (err) {
            console.error('[ProjectSelectionScreen] Failed to update project:', err);
            // Still open the project even if update fails
            onProjectSelected(project);
        }
    };

    // Handle browsing for a folder
    const handleBrowseFolder: () => Promise<void> = async (): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            const result: { success: boolean; path?: string; error?: string } =
                await window.electronAPI.main.showFolderPicker();

            if (!result.success || !result.path) {
                return;
            }

            const folderName: string = getFolderName(result.path);
            const newProject: SavedProject = {
                id: generateId(),
                path: result.path,
                name: folderName,
                type: 'folder',
                lastOpened: Date.now(),
                voicetreeInitialized: false,
            };

            await window.electronAPI.main.saveProject(newProject);
            onProjectSelected(newProject);
        } catch (err) {
            console.error('[ProjectSelectionScreen] Failed to browse folder:', err);
            setError('Failed to open folder');
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-background">
                <div className="text-muted-foreground">Loading projects...</div>
            </div>
        );
    }

    const hasSavedProjects: boolean = savedProjects.length > 0;
    const hasDiscoveredProjects: boolean = discoveredProjects.length > 0;
    const isEmpty: boolean = !hasSavedProjects && !hasDiscoveredProjects && !isScanning;

    return (
        <div className="h-screen flex flex-col bg-background p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-semibold text-foreground">VoiceTree</h1>
                <p className="text-muted-foreground mt-1">Select a project to open</p>
            </div>

            {/* Error display */}
            {error && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive text-sm">
                    {error}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {/* Empty state */}
                {isEmpty && (
                    <div className="text-center py-12">
                        <p className="text-muted-foreground mb-4">No projects yet</p>
                        <p className="text-sm text-muted-foreground mb-6">
                            Browse for a folder or scan for existing projects
                        </p>
                    </div>
                )}

                {/* Saved Projects */}
                {hasSavedProjects && (
                    <div className="mb-8">
                        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                            Recent Projects
                        </h2>
                        <div className="space-y-2">
                            {savedProjects.map((project) => (
                                <button
                                    key={project.id}
                                    onClick={() => void handleSelectSaved(project)}
                                    className="w-full text-left p-4 bg-card hover:bg-accent border border-border rounded-lg transition-colors group"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg" title={project.type}>
                                            {getProjectTypeIcon(project.type)}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-foreground truncate">
                                                {project.name}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {project.path}
                                            </div>
                                        </div>
                                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                                            {formatRelativeTime(project.lastOpened)}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Discovered Projects */}
                {(hasDiscoveredProjects || isScanning) && (
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                                Discovered Projects
                            </h2>
                            <button
                                onClick={() => void scanForProjects()}
                                disabled={isScanning}
                                className="text-xs text-primary hover:text-primary/80 disabled:text-muted-foreground"
                            >
                                {isScanning ? 'Scanning...' : 'Scan Again'}
                            </button>
                        </div>

                        {isScanning && !hasDiscoveredProjects && (
                            <div className="p-4 text-center text-muted-foreground text-sm">
                                Scanning for projects...
                            </div>
                        )}

                        {hasDiscoveredProjects && (
                            <div className="space-y-2">
                                {discoveredProjects.map((project) => (
                                    <div
                                        key={project.path}
                                        className="flex items-center gap-3 p-4 bg-card border border-border rounded-lg"
                                    >
                                        <span className="text-lg" title={project.type}>
                                            {getProjectTypeIcon(project.type)}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-foreground truncate">
                                                {project.name}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {project.path}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => void handleAddDiscovered(project)}
                                            className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                                        >
                                            + Add
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer actions */}
            <div className="flex gap-3 pt-4 border-t border-border">
                <button
                    onClick={() => void handleBrowseFolder()}
                    className="flex-1 py-3 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors"
                >
                    Browse folders...
                </button>
                {!isScanning && !hasDiscoveredProjects && (
                    <button
                        onClick={() => void scanForProjects()}
                        className="py-3 px-4 bg-muted text-foreground font-medium rounded-lg hover:bg-accent transition-colors"
                    >
                        Scan for Projects
                    </button>
                )}
            </div>
        </div>
    );
}

export default ProjectSelectionScreen;
