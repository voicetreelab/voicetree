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
import type { FilePath } from '@vt/graph-model/graph';

// File watcher instance
let watcher: FSWatcher | null = null;

export const getWatcher: () => FSWatcher | null = (): FSWatcher | null => {
    return watcher;
};

export const setWatcher: (w: FSWatcher | null) => void = (w: FSWatcher | null): void => {
    watcher = w;
};

// Currently watched directory (the project root, not the vault path)
let projectRoot: FilePath | null = null;

export const getProjectRoot: () => FilePath | null = (): FilePath | null => {
    return projectRoot;
};

export const setProjectRoot: (dir: FilePath | null) => void = (dir: FilePath | null): void => {
    projectRoot = dir;
};

type ReadPathsChangedListener = (watchPaths: readonly FilePath[]) => void
const readPathListeners = new Set<ReadPathsChangedListener>()

export const onReadPathsChanged: (listener: ReadPathsChangedListener) => (() => void) = (
    listener: ReadPathsChangedListener,
): (() => void) => {
    readPathListeners.add(listener)
    return (): void => {
        readPathListeners.delete(listener)
    }
}

export const emitReadPathsChanged: (watchPaths: readonly FilePath[]) => void = (
    watchPaths: readonly FilePath[],
): void => {
    for (const listener of readPathListeners) {
        listener(watchPaths)
    }
}

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
    projectRoot = null;
    readPathListeners.clear();
    startupFolderOverride = null;
    onFolderSwitchCleanup = null;
};
