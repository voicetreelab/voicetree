/**
 * ProjectState — the single cohesive value modelling "a project is open and
 * each of its folders is in one of three states".
 *
 * Replaces the ~9 module-mutables previously scattered across
 * watch-folder-store, vaultLifecycle, watcherRebuild, and
 * folderVisibilityResource with one encapsulated mutation point.
 *
 * Per design § D2, this is the intermediate step between "ten scattered lets"
 * and the eventual pattern-2 value-threading end-state. Mutation is hidden
 * behind getProject / updateProject so the call sites of legacy verbs do not
 * need to change.
 */

import type { FilePath } from '@vt/graph-model/graph';
import type { FSWatcher } from 'chokidar';

/**
 * Tree-view state of a loaded folder. Absence from the folders map means
 * "unloaded" — the union of loaded folders is the keyset.
 */
export type FolderTreeState = 'collapsed' | 'expanded';

/**
 * Action that may be taken on a folder relative to the project. The "unloaded"
 * action removes the folder from the watch set; "collapsed" and "expanded"
 * load it (if not already loaded) and set its tree-view state.
 */
export type FolderAction = 'unloaded' | 'collapsed' | 'expanded';

/**
 * Opaque handle to a folder-visibility sqlite database. Typed as unknown so
 * this layer does not need to depend on the concrete sqlite driver.
 */
export type FolderVisibilityHandle = {
    readonly projectRoot: FilePath;
    readonly db: unknown;
};

/**
 * Receiver of read-path-set changes. The daemon's path-diff watcher
 * subscribes by installing itself here; only one subscriber is required
 * today.
 */
export type ReadPathsListener = (watchPaths: readonly FilePath[]) => void;

/**
 * Shape of an open project. Always carries a root; writeFolderPath is null only
 * during the brief window between `setProjectRoot` (root binding) and
 * `setWriteFolderPath` (writeFolderPath binding) in the legacy vault-open flow.
 */
export interface ProjectState {
    readonly root: FilePath | null;
    readonly writeFolderPath: FilePath | null;
    readonly version: number;
    readonly vaultVersion: number;
    readonly folders: ReadonlyMap<FilePath, FolderTreeState>;
    readonly watcher: FSWatcher | null;
    readonly cleanups: readonly (() => void)[];
    readonly folderVisibility: FolderVisibilityHandle | null;
    readonly readPathsListener: ReadPathsListener | null;
    readonly folderStateUnsubscribe: (() => void) | null;
    readonly viewSwitchedUnsubscribe: (() => void) | null;
}

/**
 * Project that has a bound root and writeFolderPath. Pure transitions over folder
 * state require both — the writeFolderPath invariant referenced by D6 implies a
 * root is set.
 */
export type BoundProject = ProjectState & {
    readonly root: FilePath;
    readonly writeFolderPath: FilePath;
};

/**
 * The single encapsulated mutable for the watch-folder subsystem.
 *
 * Per package-boundaries.test.ts scanner: this `let` counts as one
 * module-level mutable. By design, it replaces ~9 scattered lets / Sets /
 * arrays across watch-folder-store, vaultLifecycle, watcherRebuild, and
 * folderVisibilityResource.
 */
let projectState: ProjectState | null = null;

export function getProject(): ProjectState | null {
    return projectState;
}

/**
 * Update the project value. The transform receives the previous state (or
 * null when no project is open) and returns the next state (or null to
 * close).
 */
export function updateProject(
    transform: (prev: ProjectState | null) => ProjectState | null,
): void {
    projectState = transform(projectState);
}

/**
 * Mutate an existing open project. No-op when no project is open. This is
 * the common case for setters that only meaningfully operate on an already-
 * open project (`setWatcher`, `registerCleanup`, …).
 */
export function mutateProject(
    transform: (prev: ProjectState) => ProjectState,
): void {
    if (projectState !== null) {
        projectState = transform(projectState);
    }
}

/**
 * Construct a fresh ProjectState. Callers pass null for `root` when a
 * sub-field setter arrives before root has been bound (e.g. tests calling
 * `onReadPathsChanged` before any `setProjectRoot`).
 */
export function freshProject(root: FilePath | null = null): ProjectState {
    return {
        root,
        writeFolderPath: null,
        version: 0,
        vaultVersion: 0,
        folders: new Map(),
        watcher: null,
        cleanups: [],
        folderVisibility: null,
        readPathsListener: null,
        folderStateUnsubscribe: null,
        viewSwitchedUnsubscribe: null,
    };
}

/**
 * Reset the project to null. Used by closeProject and by tests.
 */
export function resetProjectState(): void {
    projectState = null;
}
