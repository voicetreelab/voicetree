/**
 * Thin shim over the single ProjectState singleton.
 *
 * Legacy callers continue to use these named getters/setters; each
 * delegates to `getProject` / `updateProject` in
 * `application/workflows/state/projectState.ts`. The five separate `let`s and
 * one `Set` that used to live here are now properties of one cohesive
 * value (per design § D8 of `watch-folder-verb-consolidation`).
 */

import type { FSWatcher } from "chokidar";
import type { FilePath } from '@vt/graph-model/graph';
import {
    freshProject,
    getProject,
    mutateProject,
    resetProjectState,
    updateProject,
    type ProjectState,
    type ReadPathsListener,
} from '../application/workflows/state/projectState';

export const getWatcher: () => FSWatcher | null = (): FSWatcher | null => {
    return getProject()?.watcher ?? null;
};

export const setWatcher: (w: FSWatcher | null) => void = (w: FSWatcher | null): void => {
    updateProject((prev: ProjectState | null): ProjectState => ({
        ...(prev ?? freshProject()),
        watcher: w,
    }));
};

export const getProjectRoot: () => FilePath | null = (): FilePath | null => {
    return getProject()?.root ?? null;
};

export const setProjectRoot: (dir: FilePath | null) => void = (dir: FilePath | null): void => {
    if (dir === null) {
        resetProjectState();
        return;
    }
    updateProject((prev: ProjectState | null): ProjectState => (
        prev === null
            ? { ...freshProject(dir), version: 1, vaultVersion: 1 }
            : { ...prev, root: dir, version: prev.version + 1, vaultVersion: prev.vaultVersion + 1 }
    ));
};

export const clearProjectRoot: () => void = (): void => {
    resetProjectState();
};

export const onReadPathsChanged: (listener: ReadPathsListener) => (() => void) = (
    listener: ReadPathsListener,
): (() => void) => {
    updateProject((prev: ProjectState | null): ProjectState => ({
        ...(prev ?? freshProject()),
        readPathsListener: listener,
    }));
    return (): void => {
        mutateProject((prev: ProjectState): ProjectState => (
            prev.readPathsListener === listener
                ? { ...prev, readPathsListener: null }
                : prev
        ));
    };
};

export const emitReadPathsChanged: (watchPaths: readonly FilePath[]) => void = (
    watchPaths: readonly FilePath[],
): void => {
    mutateProject((prev: ProjectState): ProjectState => ({
        ...prev,
        version: prev.version + 1,
        vaultVersion: prev.vaultVersion + 1,
    }));
    getProject()?.readPathsListener?.(watchPaths);
};

/**
 * Clear all watch folder state (for testing or cleanup).
 */
export const clearWatchFolderState: () => void = (): void => {
    resetProjectState();
};
