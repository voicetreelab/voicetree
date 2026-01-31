/**
 * State store for file watching functionality.
 *
 * Contains the mutable state needed for watching markdown files:
 * - File watcher instance (chokidar)
 * - Currently watched directory path
 * - Startup folder override (CLI arg)
 * - Folder switch cleanup callback
 */

import type { FSWatcher } from "chokidar";
import type { FilePath } from "@/pure/graph";

// File watcher instance
let watcher: FSWatcher | null = null;

export const getWatcher: () => FSWatcher | null = (): FSWatcher | null => {
    return watcher;
};

export const setWatcher: (w: FSWatcher | null) => void = (w: FSWatcher | null): void => {
    watcher = w;
};

// Currently watched directory (the project root, not the vault path)
let projectRootWatchedDirectory: FilePath | null = null;

export const getProjectRootWatchedDirectory: () => FilePath | null = (): FilePath | null => {
    return projectRootWatchedDirectory;
};

export const setProjectRootWatchedDirectory: (dir: FilePath | null) => void = (dir: FilePath | null): void => {
    projectRootWatchedDirectory = dir;
};

// CLI argument override for opening a specific folder on startup (used by "Open Folder in New Instance")
let startupFolderOverride: string | null = null;

export const getStartupFolderOverride: () => string | null = (): string | null => {
    return startupFolderOverride;
};

export const setStartupFolderOverride: (folderPath: string | null) => void = (folderPath: string | null): void => {
    startupFolderOverride = folderPath;
};

// Cleanup callback for resources that need to be disposed when switching folders (e.g., terminals)
let onFolderSwitchCleanup: (() => void) | null = null;

export const getOnFolderSwitchCleanup: () => (() => void) | null = (): (() => void) | null => {
    return onFolderSwitchCleanup;
};

export const setOnFolderSwitchCleanup: (cleanup: (() => void) | null) => void = (cleanup: (() => void) | null): void => {
    onFolderSwitchCleanup = cleanup;
};

/**
 * Clear all watch folder state (for testing or cleanup).
 */
export const clearWatchFolderState: () => void = (): void => {
    watcher = null;
    projectRootWatchedDirectory = null;
    startupFolderOverride = null;
    onFolderSwitchCleanup = null;
};
