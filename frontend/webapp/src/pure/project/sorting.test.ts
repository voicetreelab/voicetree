import { describe, it, expect } from 'vitest';
import { sortProjectsByLastOpened } from './sorting';
import type { SavedProject } from './types';

describe('sortProjectsByLastOpened', () => {
    it('should return empty array for empty input', () => {
        const result: readonly SavedProject[] = sortProjectsByLastOpened([]);
        expect(result).toEqual([]);
    });

    it('should return single project unchanged', () => {
        const project: SavedProject = {
            id: '1',
            path: '/test/project',
            name: 'project',
            type: 'git',
            lastOpened: 1000,
            voicetreeInitialized: false,
        };
        const result: readonly SavedProject[] = sortProjectsByLastOpened([project]);
        expect(result).toEqual([project]);
    });

    it('should sort projects by lastOpened in descending order (most recent first)', () => {
        const oldest: SavedProject = {
            id: '1',
            path: '/test/oldest',
            name: 'oldest',
            type: 'git',
            lastOpened: 1000,
            voicetreeInitialized: false,
        };
        const middle: SavedProject = {
            id: '2',
            path: '/test/middle',
            name: 'middle',
            type: 'obsidian',
            lastOpened: 2000,
            voicetreeInitialized: true,
        };
        const newest: SavedProject = {
            id: '3',
            path: '/test/newest',
            name: 'newest',
            type: 'folder',
            lastOpened: 3000,
            voicetreeInitialized: false,
        };

        const result: readonly SavedProject[] = sortProjectsByLastOpened([oldest, middle, newest]);
        expect(result).toEqual([newest, middle, oldest]);
    });

    it('should handle projects with same lastOpened timestamp', () => {
        const projectA: SavedProject = {
            id: 'a',
            path: '/test/a',
            name: 'a',
            type: 'git',
            lastOpened: 1000,
            voicetreeInitialized: false,
        };
        const projectB: SavedProject = {
            id: 'b',
            path: '/test/b',
            name: 'b',
            type: 'git',
            lastOpened: 1000,
            voicetreeInitialized: false,
        };

        const result: readonly SavedProject[] = sortProjectsByLastOpened([projectA, projectB]);
        expect(result.length).toBe(2);
        expect(result[0].lastOpened).toBe(1000);
        expect(result[1].lastOpened).toBe(1000);
    });

    it('should not mutate the original array', () => {
        const oldest: SavedProject = {
            id: '1',
            path: '/test/oldest',
            name: 'oldest',
            type: 'git',
            lastOpened: 1000,
            voicetreeInitialized: false,
        };
        const newest: SavedProject = {
            id: '2',
            path: '/test/newest',
            name: 'newest',
            type: 'git',
            lastOpened: 2000,
            voicetreeInitialized: false,
        };

        const original: SavedProject[] = [oldest, newest];
        const originalCopy: SavedProject[] = [...original];
        sortProjectsByLastOpened(original);
        expect(original).toEqual(originalCopy);
    });
});
