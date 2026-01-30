import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { scanForProjects } from './project-scanner';
import type { DiscoveredProject } from '@/pure/project/types';

describe('scanForProjects', () => {
    let testDir: string;

    beforeAll(async () => {
        // Create a test directory structure simulating a dev environment
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-scanner-test-'));

        // Create a git repository with marker file
        const gitRepo: string = path.join(testDir, 'my-git-project');
        await fs.mkdir(path.join(gitRepo, '.git'), { recursive: true });
        await fs.writeFile(path.join(gitRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

        // Create an Obsidian vault with marker file
        const obsidianVault: string = path.join(testDir, 'my-notes');
        await fs.mkdir(path.join(obsidianVault, '.obsidian'), { recursive: true });
        await fs.writeFile(path.join(obsidianVault, '.obsidian', 'app.json'), '{}');

        // Create a nested git repo at depth 3 with marker file
        const nestedRepo: string = path.join(testDir, 'level1', 'level2', 'nested-project');
        await fs.mkdir(path.join(nestedRepo, '.git'), { recursive: true });
        await fs.writeFile(path.join(nestedRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

        // Create a repo at depth 5 (should be skipped with maxDepth=4)
        const deepRepo: string = path.join(testDir, 'a', 'b', 'c', 'd', 'too-deep');
        await fs.mkdir(path.join(deepRepo, '.git'), { recursive: true });
        await fs.writeFile(path.join(deepRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

        // Create a git repo inside node_modules (should be skipped)
        const nodeModulesRepo: string = path.join(testDir, 'node_modules', 'some-package');
        await fs.mkdir(path.join(nodeModulesRepo, '.git'), { recursive: true });
        await fs.writeFile(path.join(nodeModulesRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

        // Create a repo inside target directory (should be skipped)
        const targetRepo: string = path.join(testDir, 'target', 'some-build');
        await fs.mkdir(path.join(targetRepo, '.git'), { recursive: true });
        await fs.writeFile(path.join(targetRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

        // Create a plain directory (not a project)
        const plainDir: string = path.join(testDir, 'plain-folder');
        await fs.mkdir(plainDir, { recursive: true });
    });

    afterAll(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
    });

    it('should detect git repository by .git directory', async () => {
        const results: DiscoveredProject[] = await scanForProjects([testDir]);

        const gitProject: DiscoveredProject | undefined = results.find(
            (p) => p.name === 'my-git-project'
        );

        expect(gitProject).toBeDefined();
        expect(gitProject?.type).toBe('git');
        expect(gitProject?.path).toBe(path.join(testDir, 'my-git-project'));
    });

    it('should detect Obsidian vault by .obsidian directory', async () => {
        const results: DiscoveredProject[] = await scanForProjects([testDir]);

        const obsidianProject: DiscoveredProject | undefined = results.find(
            (p) => p.name === 'my-notes'
        );

        expect(obsidianProject).toBeDefined();
        expect(obsidianProject?.type).toBe('obsidian');
        expect(obsidianProject?.path).toBe(path.join(testDir, 'my-notes'));
    });

    it('should skip node_modules directory', async () => {
        const results: DiscoveredProject[] = await scanForProjects([testDir]);

        const skippedProject: DiscoveredProject | undefined = results.find((p) =>
            p.path.includes('node_modules')
        );

        expect(skippedProject).toBeUndefined();
    });

    it('should skip target directory', async () => {
        const results: DiscoveredProject[] = await scanForProjects([testDir]);

        const skippedProject: DiscoveredProject | undefined = results.find((p) =>
            p.path.includes('target')
        );

        expect(skippedProject).toBeUndefined();
    });

    it('should respect max depth of 4', async () => {
        const results: DiscoveredProject[] = await scanForProjects([testDir]);

        // too-deep is at depth 5, should not be found
        const deepProject: DiscoveredProject | undefined = results.find(
            (p) => p.name === 'too-deep'
        );

        expect(deepProject).toBeUndefined();
    });

    it('should find projects in nested directories within depth limit', async () => {
        const results: DiscoveredProject[] = await scanForProjects([testDir]);

        // nested-project is at depth 3, should be found
        const nestedProject: DiscoveredProject | undefined = results.find(
            (p) => p.name === 'nested-project'
        );

        expect(nestedProject).toBeDefined();
        expect(nestedProject?.type).toBe('git');
    });

    it('should not include plain directories without .git or .obsidian', async () => {
        const results: DiscoveredProject[] = await scanForProjects([testDir]);

        const plainFolder: DiscoveredProject | undefined = results.find(
            (p) => p.name === 'plain-folder'
        );

        expect(plainFolder).toBeUndefined();
    });

    it('should scan multiple directories', async () => {
        // Create a second test directory
        const secondDir: string = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-scanner-test2-')
        );
        const secondRepo: string = path.join(secondDir, 'second-project');
        await fs.mkdir(path.join(secondRepo, '.git'), { recursive: true });
        await fs.writeFile(path.join(secondRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

        try {
            const results: DiscoveredProject[] = await scanForProjects([testDir, secondDir]);

            const firstProject: DiscoveredProject | undefined = results.find(
                (p) => p.name === 'my-git-project'
            );
            const secondProject: DiscoveredProject | undefined = results.find(
                (p) => p.name === 'second-project'
            );

            expect(firstProject).toBeDefined();
            expect(secondProject).toBeDefined();
        } finally {
            await fs.rm(secondDir, { recursive: true, force: true });
        }
    });

    it('should return empty array when no projects found', async () => {
        const emptyDir: string = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-scanner-empty-')
        );

        try {
            const results: DiscoveredProject[] = await scanForProjects([emptyDir]);
            expect(results).toEqual([]);
        } finally {
            await fs.rm(emptyDir, { recursive: true, force: true });
        }
    });
});
