import { describe, it, expect } from 'vitest';
import type { FilePath } from '@vt/graph-model/graph';
import type { BoundProject, FolderTreeState } from '../state/projectState';
import {
    transitionFolder,
    promoteWriteFolder,
    type FolderTransition,
    type FolderTransitionError,
} from '../state/projectStateTransitions';

const WRITE_FOLDER = '/vault/write' as FilePath;
const FOLDER_A = '/vault/a' as FilePath;

function makeState(
    folders: ReadonlyArray<readonly [FilePath, FolderTreeState]> = [],
): BoundProject {
    return {
        root: '/vault' as FilePath,
        writeFolder: WRITE_FOLDER,
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

    describe('writeFolder folder', () => {
        it('unloaded action errors with cannot-unload-writefolder', () => {
            const state = makeState();
            const result = transitionFolder(state, WRITE_FOLDER, 'unloaded');
            expect(result).toEqual({ code: 'cannot-unload-writefolder' });
        });

        it('collapsed action is no-op (already loaded as writeFolder)', () => {
            const state = makeState();
            const transition = asTransition(transitionFolder(state, WRITE_FOLDER, 'collapsed'));
            expect(transition.effect).toEqual({ kind: 'noop' });
            expect(transition.nextState).toBe(state);
        });

        it('expanded action is no-op (already loaded as writeFolder)', () => {
            const state = makeState();
            const transition = asTransition(transitionFolder(state, WRITE_FOLDER, 'expanded'));
            expect(transition.effect).toEqual({ kind: 'noop' });
            expect(transition.nextState).toBe(state);
        });
    });
});

describe('promoteWriteFolder', () => {
    it('demotes previous writeFolder to collapsed', () => {
        const state = makeState();
        const plan = promoteWriteFolder(state, FOLDER_A);
        expect(plan.nextState.writeFolder).toBe(FOLDER_A);
        expect(plan.nextState.folders.get(WRITE_FOLDER)).toBe('collapsed');
        expect(plan.demotedFrom).toBe(WRITE_FOLDER);
    });

    it('signals needsLoad when newWriteFolder was unloaded', () => {
        const state = makeState();
        const plan = promoteWriteFolder(state, FOLDER_A);
        expect(plan.needsLoad).toBe(true);
        expect(plan.nextState.folders.has(FOLDER_A)).toBe(false);
    });

    it('does not signal needsLoad when newWriteFolder was already loaded', () => {
        const state = makeState([[FOLDER_A, 'expanded']]);
        const plan = promoteWriteFolder(state, FOLDER_A);
        expect(plan.needsLoad).toBe(false);
        expect(plan.nextState.folders.has(FOLDER_A)).toBe(false);
    });

    it('is no-op when newWriteFolder equals current writeFolder', () => {
        const state = makeState([[FOLDER_A, 'collapsed']]);
        const plan = promoteWriteFolder(state, WRITE_FOLDER);
        expect(plan.nextState).toBe(state);
        expect(plan.needsLoad).toBe(false);
        expect(plan.demotedFrom).toBe(WRITE_FOLDER);
    });
});
