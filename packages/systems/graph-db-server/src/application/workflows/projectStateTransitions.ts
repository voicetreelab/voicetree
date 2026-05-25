/**
 * Pure transitions over ProjectState.
 *
 * Encodes the design § D6 semantics matrix: the ternary {unloaded, collapsed,
 * expanded} cross the current state of each folder, plus the writeFolder
 * invariant. Returning `Error` rather than throwing keeps the transitions
 * pure and composable; the shell branches on the result.
 *
 * No I/O, no module state — these functions are tested as a black box.
 */

import type { FilePath } from '@vt/graph-model/graph';
import type {
    BoundProject,
    FolderAction,
    FolderTreeState,
} from './projectState';

export type FolderTransitionEffect =
    | { readonly kind: 'noop' }
    | { readonly kind: 'unload' }
    | { readonly kind: 'load'; readonly treeState: FolderTreeState }
    | { readonly kind: 'flip'; readonly treeState: FolderTreeState };

export type FolderTransitionError =
    | { readonly code: 'cannot-unload-writefolder' };

export interface FolderTransition {
    readonly nextState: BoundProject;
    readonly effect: FolderTransitionEffect;
}

function isWriteFolder(state: BoundProject, path: FilePath): boolean {
    return state.writeFolder === path;
}

function withFolders(
    state: BoundProject,
    folders: ReadonlyMap<FilePath, FolderTreeState>,
): BoundProject {
    return { ...state, folders };
}

function removeFolder(state: BoundProject, path: FilePath): BoundProject {
    const next = new Map(state.folders);
    next.delete(path);
    return withFolders(state, next);
}

function setFolder(
    state: BoundProject,
    path: FilePath,
    tree: FolderTreeState,
): BoundProject {
    const next = new Map(state.folders);
    next.set(path, tree);
    return withFolders(state, next);
}

/**
 * Pure transition for `setFolderState(path, action)`. See design § D6.
 *
 *                          'unloaded'   'collapsed'        'expanded'
 *   unloaded         →     no-op        load + collapsed   load + expanded
 *   collapsed        →     unload       no-op              flip to expanded
 *   expanded         →     unload       flip to collapsed  no-op
 *   IS writeFolder     →     ERROR        no-op              no-op
 */
export function transitionFolder(
    state: BoundProject,
    path: FilePath,
    action: FolderAction,
): FolderTransition | FolderTransitionError {
    if (isWriteFolder(state, path)) {
        if (action === 'unloaded') {
            return { code: 'cannot-unload-writefolder' };
        }
        return { nextState: state, effect: { kind: 'noop' } };
    }

    const current: FolderTreeState | undefined = state.folders.get(path);

    if (current === undefined) {
        // unloaded → ...
        if (action === 'unloaded') {
            return { nextState: state, effect: { kind: 'noop' } };
        }
        return {
            nextState: setFolder(state, path, action),
            effect: { kind: 'load', treeState: action },
        };
    }

    // loaded → ...
    if (action === 'unloaded') {
        return {
            nextState: removeFolder(state, path),
            effect: { kind: 'unload' },
        };
    }

    if (current === action) {
        return { nextState: state, effect: { kind: 'noop' } };
    }

    return {
        nextState: setFolder(state, path, action),
        effect: { kind: 'flip', treeState: action },
    };
}

export type PromoteWriteFolderPlan = {
    readonly nextState: BoundProject;
    /** True when newWriteFolder was not in the loaded set; caller must load it. */
    readonly needsLoad: boolean;
    /** The old writeFolder, demoted to 'collapsed' in `nextState.folders`. */
    readonly demotedFrom: FilePath;
};

/**
 * Pure transition for `setWriteFolder(newPath)`. The previous writeFolder is
 * demoted to 'collapsed' (a conservative default — keep loaded, hide from
 * sidebar). If newPath was unloaded it is added to the loaded set with
 * 'collapsed' and the caller is told `needsLoad: true` so it can run the
 * load effect.
 */
export function promoteWriteFolder(
    state: BoundProject,
    newWriteFolder: FilePath,
): PromoteWriteFolderPlan {
    const demotedFrom = state.writeFolder;

    if (newWriteFolder === demotedFrom) {
        return { nextState: state, needsLoad: false, demotedFrom };
    }

    const needsLoad = !state.folders.has(newWriteFolder);

    const folders = new Map(state.folders);
    folders.delete(newWriteFolder);
    folders.set(demotedFrom, 'collapsed');

    return {
        nextState: { ...state, writeFolder: newWriteFolder, folders },
        needsLoad,
        demotedFrom,
    };
}
