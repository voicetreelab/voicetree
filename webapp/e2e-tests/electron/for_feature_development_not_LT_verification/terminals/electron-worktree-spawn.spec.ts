/**
 * E2E tests for worktree agent spawning flows
 *
 * BEHAVIORAL SPEC:
 * Tests the two key user flows for worktree integration:
 * 1. Create new worktree → spawn agent in it → verify pwd shows worktree path
 * 2. List existing worktrees via IPC → select one → spawn agent in it → verify pwd
 *
 * Only mock: agent command is `pwd` instead of `claude`.
 * Everything else uses real IPC calls through the actual Electron app.
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
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
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
        const tempDir = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-wt-e2e-')));

        // Initialize git repo with initial commit (required for worktree creation)
        execSync('git init', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });

        // Create markdown files (needed for graph nodes)
        await fs.writeFile(
            path.join(tempDir, 'test-node.md'),
            '# Test Node\n\nA test node for worktree e2e testing.'
        );
        await fs.writeFile(
            path.join(tempDir, 'second-node.md'),
            '# Second Node\n\nAnother test node.'
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
            path.join(os.tmpdir(), 'voicetree-wt-e2e-userdata-')
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
                id: 'test-worktree-e2e',
                path: vaultPath,
                name: 'test-worktree-e2e',
                type: 'folder' as const,
                lastOpened: Date.now(),
                voicetreeInitialized: true,
            });
            await api.main.startFileWatching(vaultPath);
        }, tempGitRepoPath);

        // Wait for cytoscape graph to initialize
        await window.waitForFunction(
            () => (window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 20000 }
        );
        await window.waitForTimeout(1000);

        // Save settings with `pwd` as agent command (the only "mock" — replaces claude)
        await window.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            const updated = JSON.parse(JSON.stringify(settings));
            updated.agents = [{ name: 'PWD Agent', command: 'pwd' }];
            updated.agentPermissionModeChosen = true;
            await api.main.saveSettings(updated);
        });

        await use(window);
    }
});

/**
 * Find a non-context markdown node in the graph.
 */
async function findMarkdownNodeId(appWindow: Page): Promise<string> {
    return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const nodes = cy.nodes();
        for (let i = 0; i < nodes.length; i++) {
            const id = nodes[i].id();
            if (id.endsWith('.md') && !id.includes('ctx-nodes')) {
                return id;
            }
        }
        throw new Error('No markdown node found in graph');
    });
}

/**
 * Spawn terminal with spawnDirectory and collect pwd output.
 * Sets up onData listener before spawning to avoid race condition.
 * Returns when the worktree name appears in output, or after timeout.
 */
async function spawnAndCapturePwd(
    appWindow: Page,
    args: { nodeId: string; worktreePath: string; needle: string }
): Promise<{ success: boolean; terminalId: string; output: string; error?: string }> {
    return appWindow.evaluate(
        async (params: { nodeId: string; worktreePath: string; needle: string }) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            return new Promise<{
                success: boolean;
                terminalId: string;
                output: string;
                error?: string;
            }>((resolve) => {
                let output = '';
                let capturedTerminalId: string | null = null;

                const timeout = setTimeout(() => {
                    console.log(`[Test] Timeout — output so far (${output.length} chars): ${output.slice(0, 500)}`);
                    resolve({
                        success: !!capturedTerminalId,
                        terminalId: capturedTerminalId ?? '',
                        output
                    });
                }, 15000);

                // Listen for terminal data BEFORE spawning
                api.terminal.onData((id: string, data: string) => {
                    if (!capturedTerminalId) capturedTerminalId = id;
                    if (id === capturedTerminalId) {
                        output += data;
                        // Check if pwd output contains our needle (worktree name)
                        if (output.includes(params.needle)) {
                            clearTimeout(timeout);
                            resolve({
                                success: true,
                                terminalId: id,
                                output
                            });
                        }
                    }
                });

                // Spawn terminal with spawnDirectory pointing to the worktree
                void (async () => {
                    try {
                        await api.main.spawnTerminalWithContextNode(
                            params.nodeId,    // taskNodeId
                            'pwd',            // agentCommand (only mock)
                            0,                // terminalCount
                            true,             // skipFitAnimation
                            false,            // startUnpinned
                            undefined,        // selectedNodeIds
                            params.worktreePath // spawnDirectory
                        );
                    } catch (e) {
                        clearTimeout(timeout);
                        resolve({
                            success: false,
                            terminalId: '',
                            output: '',
                            error: (e as Error).message
                        });
                    }
                })();
            });
        },
        args
    );
}

test.describe('Worktree Spawning E2E', () => {

    test('create new worktree and run agent in it — pwd output shows worktree path', async ({ appWindow, tempGitRepoPath }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Wait for graph to load nodes ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph to load markdown nodes',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);
        console.log('Graph loaded');

        console.log('=== STEP 2: Find markdown node ===');
        const nodeId = await findMarkdownNodeId(appWindow);
        console.log(`Found node: ${nodeId}`);

        console.log('=== STEP 3: Create worktree via git (simulates "New Worktree" button) ===');
        const worktreeName = 'wt-test-create-e2e';
        const worktreePath = path.join(tempGitRepoPath, '.worktrees', worktreeName);
        execSync(
            `git worktree add -b "${worktreeName}" "${worktreePath}"`,
            { cwd: tempGitRepoPath, stdio: 'pipe' }
        );
        console.log(`Created worktree at: ${worktreePath}`);

        console.log('=== STEP 4: Spawn terminal with spawnDirectory = worktree path ===');
        const result = await spawnAndCapturePwd(appWindow, {
            nodeId,
            worktreePath,
            needle: worktreeName
        });

        console.log(`Spawn result: success=${result.success}, terminalId=${result.terminalId}`);
        console.log(`Output preview: ${result.output.slice(0, 300)}`);

        expect(result.success).toBe(true);
        expect(result.terminalId).toBeTruthy();
        expect(result.output).toContain(worktreeName);

        console.log('');
        console.log('PASSED: Create new worktree and run agent — pwd output shows worktree path');
    });

    test('list existing worktrees via IPC, select one, and run agent in it', async ({ appWindow, tempGitRepoPath }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Pre-create worktrees via git ===');
        const worktreeNames = ['wt-existing-alpha', 'wt-existing-beta'];
        const worktreePaths: string[] = [];
        for (const name of worktreeNames) {
            const wtPath = path.join(tempGitRepoPath, '.worktrees', name);
            execSync(
                `git worktree add -b "${name}" "${wtPath}"`,
                { cwd: tempGitRepoPath, stdio: 'pipe' }
            );
            worktreePaths.push(wtPath);
            console.log(`Pre-created worktree: ${name}`);
        }

        console.log('=== STEP 2: Wait for graph to load nodes ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph to load markdown nodes',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);
        console.log('Graph loaded');

        console.log('=== STEP 3: Call listWorktrees via IPC ===');
        const worktrees = await appWindow.evaluate(async (repoRoot: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.listWorktrees(repoRoot);
        }, tempGitRepoPath);

        console.log(`listWorktrees returned ${worktrees.length} worktrees:`);
        for (const wt of worktrees) {
            console.log(`  - ${wt.branch} at ${wt.path}`);
        }

        // Verify the list contains our pre-created worktrees
        expect(worktrees.length).toBeGreaterThanOrEqual(2);
        const alphaWorktree = worktrees.find(
            (wt: { branch: string }) => wt.branch === 'wt-existing-alpha'
        );
        const betaWorktree = worktrees.find(
            (wt: { branch: string }) => wt.branch === 'wt-existing-beta'
        );
        expect(alphaWorktree).toBeDefined();
        expect(betaWorktree).toBeDefined();

        console.log('=== STEP 4: Find markdown node ===');
        const nodeId = await findMarkdownNodeId(appWindow);
        console.log(`Found node: ${nodeId}`);

        console.log('=== STEP 5: Spawn terminal in selected worktree (alpha) ===');
        // Simulates "Use Worktree" dropdown selection
        const selectedWorktree = alphaWorktree!;
        const result = await spawnAndCapturePwd(appWindow, {
            nodeId,
            worktreePath: selectedWorktree.path,
            needle: 'wt-existing-alpha'
        });

        console.log(`Spawn result: success=${result.success}, terminalId=${result.terminalId}`);
        console.log(`Output preview: ${result.output.slice(0, 300)}`);

        expect(result.success).toBe(true);
        expect(result.terminalId).toBeTruthy();
        expect(result.output).toContain('wt-existing-alpha');

        console.log('');
        console.log('PASSED: List worktrees, select one, and run agent — pwd shows selected worktree path');
    });

});

export { test };
