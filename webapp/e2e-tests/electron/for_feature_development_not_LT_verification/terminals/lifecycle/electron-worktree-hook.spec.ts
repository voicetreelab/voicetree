/**
 * E2E tests for worktree creation hook execution
 *
 * BEHAVIORAL SPEC:
 * Tests that the hooks.onWorktreeCreated setting triggers a shell script
 * after createWorktree() completes, through the full IPC stack:
 * renderer -> preload -> main -> api.ts -> gitWorktreeCommands.ts -> runHook
 *
 * 1. Hook executes with correct arguments (worktreePath, worktreeName)
 * 2. Hook failure doesn't block worktree creation
 * 3. No hook configured still creates worktree successfully
 *
 * IMPORTANT: This test requires a git repository as the vault.
 * A temporary git repo is created in test setup.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { execSync } from 'child_process';
import { realpathSync } from 'fs';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
    cytoscapeInstance?: unknown;
    electronAPI?: ElectronAPI;
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    tempGitRepoPath: string;
}>({
    // Create a temporary git repo for worktree testing
    tempGitRepoPath: async ({}, use) => {
        // Resolve symlinks to avoid macOS /tmp -> /private/tmp mismatch
        // (git stores resolved paths, but mkdtemp returns the symlink path)
        const tempDir = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hook-e2e-')));

        // Initialize git repo with initial commit (required for worktree creation)
        execSync('git init', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });

        // Create a markdown file (needed for graph loading)
        await fs.writeFile(
            path.join(tempDir, 'test-node.md'),
            '# Test Node\n\nA test node for hook e2e testing.'
        );

        execSync('git add .', { cwd: tempDir, stdio: 'pipe' });
        execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });

        console.log(`[Setup] Created temp git repo at: ${tempDir}`);

        await use(tempDir);

        // Cleanup: remove worktrees first, then temp directory
        try {
            const result = execSync('git worktree list --porcelain', {
                cwd: tempDir, encoding: 'utf-8'
            });
            const worktreePaths = result.split('\n')
                .filter(line => line.startsWith('worktree '))
                .map(line => line.slice('worktree '.length).trim())
                .filter(p => p !== tempDir);
            for (const wtPath of worktreePaths) {
                execSync(`git worktree remove --force "${wtPath}"`, {
                    cwd: tempDir, stdio: 'pipe'
                });
            }
        } catch {
            console.log('[Cleanup] Could not clean up worktrees via git');
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ tempGitRepoPath }, use) => {
        const tempUserDataPath = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-hook-e2e-userdata-')
        );

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                '--open-folder',
                tempGitRepoPath,
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
            },
            timeout: 15000
        });

        await use(electronApp);

        // Graceful shutdown
        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) await api.main.stopFileWatching();
            });
            await window.waitForTimeout(300);
        } catch {
            console.log('[Cleanup] Could not stop file watching');
        }

        await electronApp.close();
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp, tempGitRepoPath }, use) => {
        const window = await electronApp.firstWindow({ timeout: 15000 });

        window.on('console', msg => {
            console.log(`BROWSER [${msg.type()}]:`, msg.text());
        });
        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');

        // Set up vault: save project + start file watching on the temp git repo
        await window.evaluate(async (vaultPath: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.saveProject({
                id: 'test-hook-e2e',
                path: vaultPath,
                name: 'test-hook-e2e',
                type: 'folder' as const,
                lastOpened: Date.now(),
                voicetreeInitialized: true,
            });
            await api.main.startFileWatching(vaultPath);
        }, tempGitRepoPath);

        // No cytoscape wait needed — these tests only use IPC calls
        // (createWorktree and saveSettings), not the graph UI.
        // Brief wait for main process initialization to settle.
        await window.waitForTimeout(1000);

        await use(window);
    }
});

test.describe('Worktree Hook E2E', () => {

    test('hook executes with correct arguments after worktree creation', async ({ appWindow, tempGitRepoPath }) => {
        test.setTimeout(30000);

        const markerFile = path.join(tempGitRepoPath, 'hook-marker.txt');
        const hookScript = path.join(tempGitRepoPath, 'test-hook.sh');

        // Create hook script that writes "$1 $2" to marker file
        await fs.writeFile(hookScript, `#!/bin/sh\necho "$1 $2" > "${markerFile}"\n`);
        await fs.chmod(hookScript, 0o755);

        console.log('=== STEP 1: Save settings with hook path ===');
        await appWindow.evaluate(async (scriptPath: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            const updated = JSON.parse(JSON.stringify(settings));
            updated.hooks = { onWorktreeCreated: scriptPath };
            await api.main.saveSettings(updated);
        }, hookScript);

        console.log('=== STEP 2: Create worktree via IPC ===');
        const worktreeName = 'wt-hook-test-args';
        const worktreePath = await appWindow.evaluate(
            async (params: { repoRoot: string; name: string }) => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.createWorktree(params.repoRoot, params.name);
            },
            { repoRoot: tempGitRepoPath, name: worktreeName }
        );
        console.log(`createWorktree returned: ${worktreePath}`);

        console.log('=== STEP 3: Verify hook executed with correct arguments ===');
        // Small wait for hook script to complete writing
        await appWindow.waitForTimeout(500);

        const markerContent = (await fs.readFile(markerFile, 'utf-8')).trim();
        console.log(`Marker file content: "${markerContent}"`);

        const expectedWorktreePath = path.join(tempGitRepoPath, '.worktrees', worktreeName);
        expect(markerContent).toBe(`${expectedWorktreePath} ${worktreeName}`);

        // Also verify the worktree itself was created
        const stat = await fs.stat(worktreePath);
        expect(stat.isDirectory()).toBe(true);

        console.log('');
        console.log('PASSED: Hook executes with correct arguments after worktree creation');
    });

    test('hook failure does not block worktree creation', async ({ appWindow, tempGitRepoPath }) => {
        test.setTimeout(30000);

        const nonExistentScript = path.join(tempGitRepoPath, 'does-not-exist.sh');

        console.log('=== STEP 1: Save settings with non-existent hook script ===');
        await appWindow.evaluate(async (scriptPath: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            const updated = JSON.parse(JSON.stringify(settings));
            updated.hooks = { onWorktreeCreated: scriptPath };
            await api.main.saveSettings(updated);
        }, nonExistentScript);

        console.log('=== STEP 2: Create worktree via IPC — should succeed despite bad hook ===');
        const worktreeName = 'wt-hook-test-fail';
        const worktreePath = await appWindow.evaluate(
            async (params: { repoRoot: string; name: string }) => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.createWorktree(params.repoRoot, params.name);
            },
            { repoRoot: tempGitRepoPath, name: worktreeName }
        );
        console.log(`createWorktree returned: ${worktreePath}`);

        console.log('=== STEP 3: Verify worktree was still created ===');
        expect(worktreePath).toContain(worktreeName);
        const stat = await fs.stat(worktreePath);
        expect(stat.isDirectory()).toBe(true);

        console.log('');
        console.log('PASSED: Hook failure does not block worktree creation');
    });

    test('no hook configured creates worktree successfully', async ({ appWindow, tempGitRepoPath }) => {
        test.setTimeout(30000);

        console.log('=== STEP 1: Save settings without hooks ===');
        await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            const updated = JSON.parse(JSON.stringify(settings));
            delete updated.hooks;
            await api.main.saveSettings(updated);
        });

        console.log('=== STEP 2: Create worktree via IPC ===');
        const worktreeName = 'wt-hook-test-none';
        const worktreePath = await appWindow.evaluate(
            async (params: { repoRoot: string; name: string }) => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.createWorktree(params.repoRoot, params.name);
            },
            { repoRoot: tempGitRepoPath, name: worktreeName }
        );
        console.log(`createWorktree returned: ${worktreePath}`);

        console.log('=== STEP 3: Verify worktree was created ===');
        expect(worktreePath).toContain(worktreeName);
        const stat = await fs.stat(worktreePath);
        expect(stat.isDirectory()).toBe(true);

        console.log('');
        console.log('PASSED: No hook configured creates worktree successfully');
    });

});

export { test };
