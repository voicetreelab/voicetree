/**
 * E2E tests for worktree name display in sidebar and floating terminal badge
 *
 * BEHAVIORAL SPEC:
 * Test 1: Worktree name (different from title) shows "⎇ display-name" in sidebar and floating badge
 * Test 2: Worktree name (matching title) still shows "⎇ display-name" in sidebar and floating badge (no dedup)
 *
 * Setup: Creates a temp git repo with worktrees, spawns terminals with spawnDirectory
 * pointing to worktree paths. Verifies DOM elements with correct display text.
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
    tempGitRepoPath: async ({}, use) => {
        const tempDir = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-wt-display-e2e-')));

        // Initialize git repo with initial commit
        execSync('git init', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });

        // Create markdown files for graph nodes
        await fs.writeFile(
            path.join(tempDir, 'test-node.md'),
            '# Test Node\n\nA test node for worktree display e2e testing.'
        );
        await fs.writeFile(
            path.join(tempDir, 'another-node.md'),
            '# Another Node\n\nSecond test node.'
        );

        execSync('git add .', { cwd: tempDir, stdio: 'pipe' });
        execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });

        console.log(`[Setup] Created temp git repo at: ${tempDir}`);

        await use(tempDir);

        // Cleanup worktrees then temp directory
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
            path.join(os.tmpdir(), 'voicetree-wt-display-e2e-userdata-')
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

        const electronProcess = electronApp.process();
        if (electronProcess?.stdout) {
            electronProcess.stdout.on('data', (chunk: Buffer) => {
                console.log(`[MAIN STDOUT] ${chunk.toString().trim()}`);
            });
        }
        if (electronProcess?.stderr) {
            electronProcess.stderr.on('data', (chunk: Buffer) => {
                console.error(`[MAIN STDERR] ${chunk.toString().trim()}`);
            });
        }

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

        // Set up vault
        await window.evaluate(async (vaultPath: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.saveProject({
                id: 'test-worktree-display-e2e',
                path: vaultPath,
                name: 'test-worktree-display-e2e',
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

        // Save settings with `pwd` as agent command
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
 * Optionally filter by a substring in the node ID (e.g. filename).
 */
async function findMarkdownNodeId(appWindow: Page, containing?: string): Promise<string> {
    return appWindow.evaluate((filter: string | undefined) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const nodes = cy.nodes();
        for (let i = 0; i < nodes.length; i++) {
            const id = nodes[i].id();
            if (id.endsWith('.md') && !id.includes('ctx-nodes')) {
                if (!filter || id.includes(filter)) {
                    return id;
                }
            }
        }
        throw new Error(`No markdown node found in graph${filter ? ` matching "${filter}"` : ''}`);
    }, containing);
}

/**
 * Spawn a terminal with a spawnDirectory and wait for it to appear in the sidebar.
 * Returns the terminal ID.
 */
async function spawnTerminalInWorktree(
    appWindow: Page,
    args: { nodeId: string; worktreePath: string }
): Promise<string> {
    return appWindow.evaluate(
        async (params: { nodeId: string; worktreePath: string }) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            return new Promise<string>((resolve) => {
                let capturedTerminalId: string | null = null;

                const timeout = setTimeout(() => {
                    resolve(capturedTerminalId ?? '');
                }, 15000);

                // Listen for terminal data BEFORE spawning
                api.terminal.onData((id: string) => {
                    if (!capturedTerminalId) {
                        capturedTerminalId = id;
                        clearTimeout(timeout);
                        // Small delay to let UI render
                        setTimeout(() => resolve(id), 500);
                    }
                });

                void api.main.spawnTerminalWithContextNode(
                    params.nodeId,
                    'pwd',
                    0,
                    true,             // skipFitAnimation
                    false,            // startUnpinned
                    undefined,        // selectedNodeIds
                    params.worktreePath
                );
            });
        },
        args
    );
}

test.describe('Worktree Display Name E2E', () => {
    test.describe.configure({ mode: 'serial', timeout: 90000 });

    test('Test 1: Different worktree name shows ⎇ display-name in sidebar and floating badge', async ({ appWindow, tempGitRepoPath }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Wait for graph to load ===');
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

        console.log('=== STEP 2: Find markdown node ===');
        const nodeId = await findMarkdownNodeId(appWindow);
        console.log(`Found node: ${nodeId}`);

        console.log('=== STEP 3: Create worktree with name different from node title ===');
        // Node title is "Test Node" or similar, worktree name is completely different
        const worktreeName = 'wt-deploy-pipeline-x4f';
        const worktreePath = path.join(tempGitRepoPath, '.worktrees', worktreeName);
        execSync(
            `git worktree add -b "${worktreeName}" "${worktreePath}"`,
            { cwd: tempGitRepoPath, stdio: 'pipe' }
        );
        console.log(`Created worktree at: ${worktreePath}`);

        console.log('=== STEP 4: Spawn terminal in worktree ===');
        const terminalId = await spawnTerminalInWorktree(appWindow, {
            nodeId,
            worktreePath
        });
        expect(terminalId).toBeTruthy();
        console.log(`Terminal ID: ${terminalId}`);

        console.log('=== STEP 5: Wait for sidebar tree node to appear ===');
        const treeNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${terminalId}"]`);
        await expect(treeNode).toBeVisible({ timeout: 10000 });

        console.log('=== STEP 6: Assert .terminal-tree-worktree exists with correct text ===');
        const sidebarWorktree = treeNode.locator('.terminal-tree-worktree');
        await expect(sidebarWorktree).toBeVisible({ timeout: 5000 });

        const sidebarWorktreeText = await sidebarWorktree.textContent();
        console.log(`Sidebar worktree text: "${sidebarWorktreeText}"`);

        // "wt-deploy-pipeline-x4f" → displayed as "⎇ wt-deploy-pipeline-x4f"
        expect(sidebarWorktreeText).toContain('\u2387');
        expect(sidebarWorktreeText).toContain('wt-deploy-pipeline-x4f');

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/worktree-display-sidebar-different-name.png'
        });
        console.log('Screenshot: sidebar worktree indicator');

        console.log('=== STEP 7: Click sidebar node to open floating terminal ===');
        await treeNode.click();
        await appWindow.waitForTimeout(500);

        console.log('=== STEP 8: Assert floating terminal badge has worktree indicator ===');
        const floatingWindow = appWindow.locator(`[data-floating-window-id="${terminalId}"]`);
        await expect(floatingWindow).toBeVisible({ timeout: 5000 });

        const badgeWorktree = floatingWindow.locator('.terminal-context-badge-worktree');
        await expect(badgeWorktree).toBeVisible({ timeout: 5000 });

        const badgeWorktreeText = await badgeWorktree.textContent();
        console.log(`Badge worktree text: "${badgeWorktreeText}"`);

        expect(badgeWorktreeText).toContain('\u2387');
        expect(badgeWorktreeText).toContain('wt-deploy-pipeline-x4f');

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/worktree-display-badge-different-name.png'
        });
        console.log('Screenshot: floating badge worktree indicator');

        console.log('PASSED: Different worktree name shows ⎇ display-name in both sidebar and badge');
    });

    test('Test 2: Matching worktree name still shows ⎇ display-name in sidebar and floating badge', async ({ appWindow, tempGitRepoPath }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Wait for graph to load ===');
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

        console.log('=== STEP 2: Find markdown node and get its title from main process ===');
        const nodeId = await findMarkdownNodeId(appWindow);
        console.log(`Found node: ${nodeId}`);

        // Get the title via the main process graph (same path as spawnTerminalWithContextNode)
        const nodeTitle = await appWindow.evaluate(async (nid: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const graph = await api.main.getGraph();
            if (!graph) throw new Error('Graph not available');
            const node = graph.nodes[nid];
            if (!node) throw new Error(`Node ${nid} not in graph`);
            // getNodeTitle extracts from first # heading or falls back to filename
            const content = node.contentWithoutYamlOrLinks ?? '';
            const headingMatch = content.match(/^#\s+(.+)/m);
            return headingMatch ? headingMatch[1].trim() : nid.split('/').pop()?.replace(/\.md$/, '') ?? nid;
        }, nodeId);
        console.log(`Node title (from graph): "${nodeTitle}"`);

        // Build worktree name from the title using the same pattern as production code
        // e.g., "Wednesday, February 11" → "wt-wednesday-february-11-a3k"
        const slugified = nodeTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const worktreeName = `wt-${slugified}-a3k`;
        console.log(`=== STEP 3: Create worktree "${worktreeName}" matching title "${nodeTitle}" ===`);
        const worktreePath = path.join(tempGitRepoPath, '.worktrees', worktreeName);
        execSync(
            `git worktree add -b "${worktreeName}" "${worktreePath}"`,
            { cwd: tempGitRepoPath, stdio: 'pipe' }
        );
        console.log(`Created worktree at: ${worktreePath}`);

        console.log('=== STEP 4: Spawn terminal in worktree ===');
        const terminalId = await spawnTerminalInWorktree(appWindow, {
            nodeId,
            worktreePath
        });
        expect(terminalId).toBeTruthy();
        console.log(`Terminal ID: ${terminalId}`);

        console.log('=== STEP 5: Wait for sidebar tree node to appear ===');
        const treeNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${terminalId}"]`);
        await expect(treeNode).toBeVisible({ timeout: 10000 });

        console.log('=== STEP 6: Assert .terminal-tree-worktree exists with ⎇ display-name ===');
        const sidebarWorktree = treeNode.locator('.terminal-tree-worktree');
        await expect(sidebarWorktree).toBeVisible({ timeout: 5000 });

        const sidebarWorktreeText = await sidebarWorktree.textContent();
        console.log(`Sidebar worktree text: "${sidebarWorktreeText}"`);

        // Also log the terminal title to verify both are shown
        const terminalTitle = await treeNode.locator('.terminal-tree-title-text').textContent();
        console.log(`Terminal title: "${terminalTitle}"`);

        // Worktree name always shows full name (no dedup, no prefix stripping)
        expect(sidebarWorktreeText).toContain('\u2387');
        expect(sidebarWorktreeText).toContain(worktreeName);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/worktree-display-sidebar-matching-name.png'
        });

        console.log('=== STEP 7: Click sidebar node to open floating terminal ===');
        await treeNode.click();
        await appWindow.waitForTimeout(500);

        console.log('=== STEP 8: Assert floating terminal badge shows ⎇ with full name ===');
        const floatingWindow = appWindow.locator(`[data-floating-window-id="${terminalId}"]`);
        await expect(floatingWindow).toBeVisible({ timeout: 5000 });

        const badgeWorktree = floatingWindow.locator('.terminal-context-badge-worktree');
        await expect(badgeWorktree).toBeVisible({ timeout: 5000 });

        const badgeWorktreeText = await badgeWorktree.textContent();
        console.log(`Badge worktree text: "${badgeWorktreeText}"`);

        expect(badgeWorktreeText).toContain('\u2387');
        expect(badgeWorktreeText).toContain(worktreeName);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/worktree-display-badge-matching-name.png'
        });

        console.log('PASSED: Matching worktree name still shows ⎇ with full name in both sidebar and badge');
    });
});

export { test };
