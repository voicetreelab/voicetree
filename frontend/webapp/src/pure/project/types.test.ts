import { describe, it, expect } from 'vitest';
import type { SavedProject, DiscoveredProject, ProjectType } from './types';

describe('Project types', () => {
    describe('SavedProject', () => {
        it('should have all required fields', () => {
            const project: SavedProject = {
                id: 'test-uuid',
                path: '/Users/test/repos/my-project',
                name: 'my-project',
                type: 'git',
                lastOpened: Date.now(),
                voicetreeInitialized: false,
            };

            expect(project.id).toBe('test-uuid');
            expect(project.path).toBe('/Users/test/repos/my-project');
            expect(project.name).toBe('my-project');
            expect(project.type).toBe('git');
            expect(typeof project.lastOpened).toBe('number');
            expect(project.voicetreeInitialized).toBe(false);
        });

        it('should support all project types', () => {
            const types: ProjectType[] = ['git', 'obsidian', 'folder'];

            types.forEach((type) => {
                const project: SavedProject = {
                    id: `${type}-project`,
                    path: `/test/${type}`,
                    name: `${type}-project`,
                    type,
                    lastOpened: 0,
                    voicetreeInitialized: true,
                };
                expect(project.type).toBe(type);
            });
        });
    });

    describe('DiscoveredProject', () => {
        it('should have all required fields', () => {
            const project: DiscoveredProject = {
                path: '/Users/test/repos/discovered',
                name: 'discovered',
                type: 'git',
            };

            expect(project.path).toBe('/Users/test/repos/discovered');
            expect(project.name).toBe('discovered');
            expect(project.type).toBe('git');
        });

        it('should only allow git or obsidian types', () => {
            const gitProject: DiscoveredProject = {
                path: '/test/git',
                name: 'git-repo',
                type: 'git',
            };
            expect(gitProject.type).toBe('git');

            const obsidianProject: DiscoveredProject = {
                path: '/test/obsidian',
                name: 'vault',
                type: 'obsidian',
            };
            expect(obsidianProject.type).toBe('obsidian');
        });
    });
});
