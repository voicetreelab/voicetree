/**
 * Project type enumeration.
 * - git: Directory contains .git folder
 * - obsidian: Directory contains .obsidian folder
 * - folder: Generic directory (manually added)
 */
export type ProjectType = 'git' | 'obsidian' | 'folder';

/**
 * A project that has been saved to the user's project list.
 * Persisted to projects.json in the app data directory.
 */
export interface SavedProject {
    readonly id: string;
    readonly path: string;
    readonly name: string;
    readonly type: ProjectType;
    readonly lastOpened: number;
    readonly voicetreeInitialized: boolean;
}

/**
 * A project discovered during filesystem scanning.
 * Not yet saved to the user's project list.
 */
export interface DiscoveredProject {
    readonly path: string;
    readonly name: string;
    readonly type: 'git' | 'obsidian';
    readonly lastActivity: number; // mtime of marker file (.git/index or .obsidian/workspace.json)
}
