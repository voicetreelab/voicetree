import { describe, it, expect } from 'vitest';
import type { FilePath } from '@vt/graph-model/graph';
import type { BoundProject, FolderTreeState } from '../projectState';
import {
    transitionFolder,
    promoteWritePath,
    type FolderTransition,
    type FolderTransitionError,
} from '../projectStateTransitions';

const WRITE_PATH = '/vault/write' as FilePath;
const FOLDER_A = '/vault/a' as FilePath;

function makeState(
    folders: ReadonlyArray<readonly [FilePath, FolderTreeState]> = [],
): BoundProject {
    return {
        root: '/vault' as FilePath,
        writePath: WRITE_PATH,
        folders: new Map(folders),
        watcher: null,
        cleanups: [],
        folderVisibility: null,
        readPathsListener: null,
        folderStateUnsubscribe: null,
        viewSwitchedUnsubscribe: null,
    };
}

function asTransition(result: FolderTransition | FolderTransitionError): FolderTransition {
    if ('code' in result) {
        throw new Error(`expected transition, got error ${result.code}`);
    }
    return result;
}

describe('transitionFolder — D6 semantics matrix', () => {
    describe('unloaded folder (absent from map)', () => {
        it('unloaded action is no-op', () => {
            const state = makeState();
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'unloaded'));
            expect(transition.effect).toEqual({ kind: 'noop' });
            expect(transition.nextState).toBe(state);
        });

        it('collapsed action loads with collapsed tree-state', () => {
            const state = makeState();
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'collapsed'));
            expect(transition.effect).toEqual({ kind: 'load', treeState: 'collapsed' });
            expect(transition.nextState.folders.get(FOLDER_A)).toBe('collapsed');
        });

        it('expanded action loads with expanded tree-state', () => {
            const state = makeState();
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'expanded'));
            expect(transition.effect).toEqual({ kind: 'load', treeState: 'expanded' });
            expect(transition.nextState.folders.get(FOLDER_A)).toBe('expanded');
        });
    });

    describe('collapsed folder', () => {
        it('unloaded action unloads', () => {
            const state = makeState([[FOLDER_A, 'collapsed']]);
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'unloaded'));
            expect(transition.effect).toEqual({ kind: 'unload' });
            expect(transition.nextState.folders.has(FOLDER_A)).toBe(false);
        });

        it('collapsed action is no-op', () => {
            const state = makeState([[FOLDER_A, 'collapsed']]);
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'collapsed'));
            expect(transition.effect).toEqual({ kind: 'noop' });
            expect(transition.nextState).toBe(state);
        });

        it('expanded action flips tree-state', () => {
            const state = makeState([[FOLDER_A, 'collapsed']]);
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'expanded'));
            expect(transition.effect).toEqual({ kind: 'flip', treeState: 'expanded' });
            expect(transition.nextState.folders.get(FOLDER_A)).toBe('expanded');
        });
    });

    describe('expanded folder', () => {
        it('unloaded action unloads', () => {
            const state = makeState([[FOLDER_A, 'expanded']]);
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'unloaded'));
            expect(transition.effect).toEqual({ kind: 'unload' });
            expect(transition.nextState.folders.has(FOLDER_A)).toBe(false);
        });

        it('collapsed action flips tree-state', () => {
            const state = makeState([[FOLDER_A, 'expanded']]);
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'collapsed'));
            expect(transition.effect).toEqual({ kind: 'flip', treeState: 'collapsed' });
            expect(transition.nextState.folders.get(FOLDER_A)).toBe('collapsed');
        });

        it('expanded action is no-op', () => {
            const state = makeState([[FOLDER_A, 'expanded']]);
            const transition = asTransition(transitionFolder(state, FOLDER_A, 'expanded'));
            expect(transition.effect).toEqual({ kind: 'noop' });
            expect(transition.nextState).toBe(state);
        });
    });

    describe('writePath folder', () => {
        it('unloaded action errors with cannot-unload-writepath', () => {
            const state = makeState();
            const result = transitionFolder(state, WRITE_PATH, 'unloaded');
            expect(result).toEqual({ code: 'cannot-unload-writepath' });
        });

        it('collapsed action is no-op (already loaded as writePath)', () => {
            const state = makeState();
            const transition = asTransition(transitionFolder(state, WRITE_PATH, 'collapsed'));
            expect(transition.effect).toEqual({ kind: 'noop' });
            expect(transition.nextState).toBe(state);
        });

        it('expanded action is no-op (already loaded as writePath)', () => {
            const state = makeState();
            const transition = asTransition(transitionFolder(state, WRITE_PATH, 'expanded'));
            expect(transition.effect).toEqual({ kind: 'noop' });
            expect(transition.nextState).toBe(state);
        });
    });
});

describe('promoteWritePath', () => {
    it('demotes previous writePath to collapsed', () => {
        const state = makeState();
        const plan = promoteWritePath(state, FOLDER_A);
        expect(plan.nextState.writePath).toBe(FOLDER_A);
        expect(plan.nextState.folders.get(WRITE_PATH)).toBe('collapsed');
        expect(plan.demotedFrom).toBe(WRITE_PATH);
    });

    it('signals needsLoad when newWritePath was unloaded', () => {
        const state = makeState();
        const plan = promoteWritePath(state, FOLDER_A);
        expect(plan.needsLoad).toBe(true);
        expect(plan.nextState.folders.has(FOLDER_A)).toBe(false);
    });

    it('does not signal needsLoad when newWritePath was already loaded', () => {
        const state = makeState([[FOLDER_A, 'expanded']]);
        const plan = promoteWritePath(state, FOLDER_A);
        expect(plan.needsLoad).toBe(false);
        expect(plan.nextState.folders.has(FOLDER_A)).toBe(false);
    });

    it('is no-op when newWritePath equals current writePath', () => {
        const state = makeState([[FOLDER_A, 'collapsed']]);
        const plan = promoteWritePath(state, WRITE_PATH);
        expect(plan.nextState).toBe(state);
        expect(plan.needsLoad).toBe(false);
        expect(plan.demotedFrom).toBe(WRITE_PATH);
    });
});
