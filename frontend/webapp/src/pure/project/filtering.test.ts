import { describe, it, expect } from 'vitest';
import { filterDiscoveredProjects } from './filtering';
import type { DiscoveredProject, SavedProject } from './types';

describe('filterDiscoveredProjects', () => {
    it('should return empty array for empty discovered list', () => {
        const discovered: readonly DiscoveredProject[] = [];
        const saved: readonly SavedProject[] = [];
        const result: readonly DiscoveredProject[] = filterDiscoveredProjects(discovered, saved);
        expect(result).toEqual([]);
    });

    it('should return all discovered projects when saved list is empty', () => {
        const discovered: readonly DiscoveredProject[] = [
            { path: '/test/project1', name: 'project1', type: 'git' },
            { path: '/test/project2', name: 'project2', type: 'obsidian' },
        ];
        const saved: readonly SavedProject[] = [];
        const result: readonly DiscoveredProject[] = filterDiscoveredProjects(discovered, saved);
        expect(result).toEqual(discovered);
    });

    it('should filter out discovered projects that match saved paths', () => {
        const discovered: readonly DiscoveredProject[] = [
            { path: '/test/project1', name: 'project1', type: 'git' },
            { path: '/test/project2', name: 'project2', type: 'obsidian' },
            { path: '/test/project3', name: 'project3', type: 'git' },
        ];
        const saved: readonly SavedProject[] = [
            {
                id: '1',
                path: '/test/project1',
                name: 'project1',
                type: 'git',
                lastOpened: 1000,
                voicetreeInitialized: false,
            },
            {
                id: '2',
                path: '/test/project3',
                name: 'project3',
                type: 'git',
                lastOpened: 2000,
                voicetreeInitialized: true,
            },
        ];
        const result: readonly DiscoveredProject[] = filterDiscoveredProjects(discovered, saved);
        expect(result).toEqual([{ path: '/test/project2', name: 'project2', type: 'obsidian' }]);
    });

    it('should return empty array when all discovered projects are already saved', () => {
        const discovered: readonly DiscoveredProject[] = [
            { path: '/test/project1', name: 'project1', type: 'git' },
        ];
        const saved: readonly SavedProject[] = [
            {
                id: '1',
                path: '/test/project1',
                name: 'already-saved',
                type: 'folder',
                lastOpened: 1000,
                voicetreeInitialized: false,
            },
        ];
        const result: readonly DiscoveredProject[] = filterDiscoveredProjects(discovered, saved);
        expect(result).toEqual([]);
    });

    it('should match paths exactly (case-sensitive)', () => {
        const discovered: readonly DiscoveredProject[] = [
            { path: '/test/Project1', name: 'Project1', type: 'git' },
        ];
        const saved: readonly SavedProject[] = [
            {
                id: '1',
                path: '/test/project1',
                name: 'project1',
                type: 'git',
                lastOpened: 1000,
                voicetreeInitialized: false,
            },
        ];
        const result: readonly DiscoveredProject[] = filterDiscoveredProjects(discovered, saved);
        expect(result).toEqual([{ path: '/test/Project1', name: 'Project1', type: 'git' }]);
    });

    it('should not mutate the original arrays', () => {
        const discovered: DiscoveredProject[] = [
            { path: '/test/project1', name: 'project1', type: 'git' },
        ];
        const saved: SavedProject[] = [
            {
                id: '1',
                path: '/test/project1',
                name: 'project1',
                type: 'git',
                lastOpened: 1000,
                voicetreeInitialized: false,
            },
        ];
        const discoveredCopy: DiscoveredProject[] = [...discovered];
        const savedCopy: SavedProject[] = [...saved];

        filterDiscoveredProjects(discovered, saved);

        expect(discovered).toEqual(discoveredCopy);
        expect(saved).toEqual(savedCopy);
    });
});
