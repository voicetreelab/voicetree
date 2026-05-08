import type { FSWatcher } from "chokidar";
import type { FilePath } from '@vt/graph-model/graph';

let watcher: FSWatcher | null = null;

export const getWatcher: () => FSWatcher | null = (): FSWatcher | null => {
    return watcher;
};

export const setWatcher: (w: FSWatcher | null) => void = (w: FSWatcher | null): void => {
    watcher = w;
};

let projectRootWatchedDirectory: FilePath | null = null;

export const getProjectRootWatchedDirectory: () => FilePath | null = (): FilePath | null => {
    return projectRootWatchedDirectory;
};

export const setProjectRootWatchedDirectory: (dir: FilePath | null) => void = (dir: FilePath | null): void => {
    projectRootWatchedDirectory = dir;
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

let startupFolderOverride: string | null = null;

export const getStartupFolderOverride: () => string | null = (): string | null => {
    return startupFolderOverride;
};

export const setStartupFolderOverride: (folderPath: string | null) => void = (folderPath: string | null): void => {
    startupFolderOverride = folderPath;
};

let onFolderSwitchCleanup: (() => void) | null = null;

export const getOnFolderSwitchCleanup: () => (() => void) | null = (): (() => void) | null => {
    return onFolderSwitchCleanup;
};

export const setOnFolderSwitchCleanup: (cleanup: (() => void) | null) => void = (cleanup: (() => void) | null): void => {
    onFolderSwitchCleanup = cleanup;
};

export const clearWatchFolderState: () => void = (): void => {
    watcher = null;
    projectRootWatchedDirectory = null;
    readPathListeners.clear();
    startupFolderOverride = null;
    onFolderSwitchCleanup = null;
};
