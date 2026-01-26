import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { SavedProject } from '@/pure/project/types';

// Mock the electron app module
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(),
    },
}));

import { app } from 'electron';
import { loadProjects, saveProject, removeProject } from './project-store';

describe('project-store', () => {
    let testDir: string;
    let projectsFilePath: string;

    beforeEach(async () => {
        // Create a test directory to simulate app data directory
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-store-test-'));
        projectsFilePath = path.join(testDir, 'projects.json');

        // Mock app.getPath to return our test directory
        vi.mocked(app.getPath).mockReturnValue(testDir);
    });

    afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
        vi.resetAllMocks();
    });

    describe('loadProjects', () => {
        it('should return empty array when projects.json does not exist', async () => {
            const projects: SavedProject[] = await loadProjects();
            expect(projects).toEqual([]);
        });

        it('should load projects from existing projects.json', async () => {
            // Create real directories so they pass existence check
            const project1Dir: string = await fs.mkdtemp(
                path.join(os.tmpdir(), 'voicetree-project1-')
            );
            const project2Dir: string = await fs.mkdtemp(
                path.join(os.tmpdir(), 'voicetree-project2-')
            );

            try {
                const savedProjects: SavedProject[] = [
                    {
                        id: 'test-id-1',
                        path: project1Dir,
                        name: 'project1',
                        type: 'git',
                        lastOpened: 1700000000000,
                        voicetreeInitialized: false,
                    },
                    {
                        id: 'test-id-2',
                        path: project2Dir,
                        name: 'project2',
                        type: 'obsidian',
                        lastOpened: 1700000001000,
                        voicetreeInitialized: true,
                    },
                ];

                await fs.writeFile(projectsFilePath, JSON.stringify(savedProjects), 'utf-8');

                const projects: SavedProject[] = await loadProjects();

                expect(projects).toHaveLength(2);
                expect(projects[0].name).toBe('project1');
                expect(projects[1].name).toBe('project2');
            } finally {
                await fs.rm(project1Dir, { recursive: true, force: true });
                await fs.rm(project2Dir, { recursive: true, force: true });
            }
        });

        it('should mark projects as missing when path no longer exists', async () => {
            const nonExistentPath: string = path.join(os.tmpdir(), 'non-existent-path-12345');
            const savedProjects: SavedProject[] = [
                {
                    id: 'missing-id',
                    path: nonExistentPath,
                    name: 'missing-project',
                    type: 'git',
                    lastOpened: 1700000000000,
                    voicetreeInitialized: false,
                },
            ];

            await fs.writeFile(projectsFilePath, JSON.stringify(savedProjects), 'utf-8');

            const projects: SavedProject[] = await loadProjects();

            // Projects with missing paths should be filtered out or marked
            // Implementation decision: filter out missing projects
            expect(projects).toHaveLength(0);
        });

        it('should keep projects that exist on disk', async () => {
            // Create a real directory to simulate existing project
            const existingProjectDir: string = await fs.mkdtemp(
                path.join(os.tmpdir(), 'voicetree-existing-')
            );

            try {
                const savedProjects: SavedProject[] = [
                    {
                        id: 'existing-id',
                        path: existingProjectDir,
                        name: 'existing-project',
                        type: 'git',
                        lastOpened: 1700000000000,
                        voicetreeInitialized: false,
                    },
                ];

                await fs.writeFile(projectsFilePath, JSON.stringify(savedProjects), 'utf-8');

                const projects: SavedProject[] = await loadProjects();

                expect(projects).toHaveLength(1);
                expect(projects[0].path).toBe(existingProjectDir);
            } finally {
                await fs.rm(existingProjectDir, { recursive: true, force: true });
            }
        });
    });

    describe('saveProject', () => {
        it('should save a new project to projects.json', async () => {
            const newProject: SavedProject = {
                id: 'new-id',
                path: '/Users/test/new-project',
                name: 'new-project',
                type: 'git',
                lastOpened: Date.now(),
                voicetreeInitialized: false,
            };

            await saveProject(newProject);

            const fileContent: string = await fs.readFile(projectsFilePath, 'utf-8');
            const savedProjects: SavedProject[] = JSON.parse(fileContent) as SavedProject[];

            expect(savedProjects).toHaveLength(1);
            expect(savedProjects[0].id).toBe('new-id');
            expect(savedProjects[0].name).toBe('new-project');
        });

        it('should update existing project with same id', async () => {
            const existingProjects: SavedProject[] = [
                {
                    id: 'update-id',
                    path: '/Users/test/project',
                    name: 'old-name',
                    type: 'git',
                    lastOpened: 1700000000000,
                    voicetreeInitialized: false,
                },
            ];

            await fs.writeFile(projectsFilePath, JSON.stringify(existingProjects), 'utf-8');

            const updatedProject: SavedProject = {
                id: 'update-id',
                path: '/Users/test/project',
                name: 'new-name',
                type: 'git',
                lastOpened: 1700000001000,
                voicetreeInitialized: true,
            };

            await saveProject(updatedProject);

            const fileContent: string = await fs.readFile(projectsFilePath, 'utf-8');
            const savedProjects: SavedProject[] = JSON.parse(fileContent) as SavedProject[];

            expect(savedProjects).toHaveLength(1);
            expect(savedProjects[0].name).toBe('new-name');
            expect(savedProjects[0].lastOpened).toBe(1700000001000);
            expect(savedProjects[0].voicetreeInitialized).toBe(true);
        });

        it('should create projects.json if it does not exist', async () => {
            const newProject: SavedProject = {
                id: 'create-id',
                path: '/Users/test/project',
                name: 'project',
                type: 'git',
                lastOpened: Date.now(),
                voicetreeInitialized: false,
            };

            await saveProject(newProject);

            const fileExists: boolean = await fs.access(projectsFilePath).then(
                () => true,
                () => false
            );
            expect(fileExists).toBe(true);
        });
    });

    describe('removeProject', () => {
        it('should remove project with given id', async () => {
            const existingProjects: SavedProject[] = [
                {
                    id: 'keep-id',
                    path: '/Users/test/keep',
                    name: 'keep',
                    type: 'git',
                    lastOpened: 1700000000000,
                    voicetreeInitialized: false,
                },
                {
                    id: 'remove-id',
                    path: '/Users/test/remove',
                    name: 'remove',
                    type: 'git',
                    lastOpened: 1700000000000,
                    voicetreeInitialized: false,
                },
            ];

            await fs.writeFile(projectsFilePath, JSON.stringify(existingProjects), 'utf-8');

            await removeProject('remove-id');

            const fileContent: string = await fs.readFile(projectsFilePath, 'utf-8');
            const savedProjects: SavedProject[] = JSON.parse(fileContent) as SavedProject[];

            expect(savedProjects).toHaveLength(1);
            expect(savedProjects[0].id).toBe('keep-id');
        });

        it('should do nothing if project id does not exist', async () => {
            const existingProjects: SavedProject[] = [
                {
                    id: 'existing-id',
                    path: '/Users/test/project',
                    name: 'project',
                    type: 'git',
                    lastOpened: 1700000000000,
                    voicetreeInitialized: false,
                },
            ];

            await fs.writeFile(projectsFilePath, JSON.stringify(existingProjects), 'utf-8');

            await removeProject('non-existent-id');

            const fileContent: string = await fs.readFile(projectsFilePath, 'utf-8');
            const savedProjects: SavedProject[] = JSON.parse(fileContent) as SavedProject[];

            expect(savedProjects).toHaveLength(1);
        });
    });
});
