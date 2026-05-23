/**
 * BEHAVIORAL SPEC:
 * E2E tests for TerminalTreeSidebar activity dots persistence
 *
 * Test 1: Activity dots appear when terminal has activity
 * Test 2: Activity dots persist when new terminal is added (re-render)
 * Test 3: Activity dots clear on tab click
 * Test 4: Status dot switches from running to done
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: {
        main: {
            startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
            spawnTerminalWithContextNode: (nodeId: string, command: string, terminalCount: number) => Promise<void>;
            saveSettings: (settings: Record<string, unknown>) => Promise<void>;
            updateTerminalActivityState: (terminalId: string, updates: { activityCount: number }) => Promise<void>;
        };
        terminal: {
            onData: (callback: (terminalId: string, data: string) => void) => void;
        };
    };
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
}>({
    electronApp: [async ({}, use) => {
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-activity-dots-test-'));

        const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({
            lastDirectory: FIXTURE_VAULT_PATH
        }, null, 2), 'utf8');
        console.log('[Test] Created config file with lastDirectory:', FIXTURE_VAULT_PATH);

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1'
            },
            timeout: 10000
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

        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) {
                    await api.main.stopFileWatching();
                }
            });
            await window.waitForTimeout(300);
        } catch {
            console.log('Note: Could not stop file watching during cleanup');
        }

        await electronApp.close();
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    }, { timeout: 30000 }],

    appWindow: [async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 60000 });

        window.on('console', msg => {
            if (!msg.text().includes('Electron Security Warning')) {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            }
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');

        // Wait for cytoscape to initialize
        await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });
        await window.waitForTimeout(500);

        await use(window);
    }, { timeout: 25000 }]
});

/**
 * Helper to load the fixture vault and wait for graph to be ready
 */
async function loadVaultAndWaitForGraph(appWindow: Page): Promise<void> {
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        return await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    expect(watchResult.success).toBe(true);
    console.log('Started watching vault:', FIXTURE_VAULT_PATH);

    await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.saveSettings({
            agents: [{ name: 'Test Agent', command: 'echo TEST_AGENT' }],
            INJECT_ENV_VARS: {}
        });
    });

    await expect.poll(async () => {
        return appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return 0;
            return cy.nodes().length;
        });
    }, {
        message: 'Waiting for graph to load nodes',
        timeout: 30000,
        intervals: [500, 1000, 2000, 3000]
    }).toBeGreaterThan(0);

    console.log('Graph loaded with nodes');
}

/**
 * Helper to spawn a terminal and wait for output
 */
async function spawnTerminalAndWait(appWindow: Page, nodeId: string, marker: string): Promise<string> {
    return appWindow.evaluate(async ({ nodeId, marker }) => {
        const w = (window as unknown as ExtendedWindow);
        const api = w.electronAPI;

        if (!api?.terminal || !api?.main) {
            throw new Error('electronAPI terminal/main not available');
        }

        return new Promise<string>((resolve) => {
            let capturedTerminalId: string | null = null;

            const timeout = setTimeout(() => {
                resolve(capturedTerminalId ?? '');
            }, 15000);

            api.terminal.onData((id, data) => {
                if (!capturedTerminalId) {
                    capturedTerminalId = id;
                }
                if (data.includes(marker)) {
                    clearTimeout(timeout);
                    resolve(id);
                }
            });

            void api.main.spawnTerminalWithContextNode(nodeId, `echo ${marker}`, 0);
        });
    }, { nodeId, marker });
}

/**
 * Helper to increment activity count for a terminal via the store
 * (simulates what markTerminalActivityForContextNode does)
 */
async function incrementActivityCount(appWindow: Page, terminalId: string, newCount: number): Promise<void> {
    await appWindow.evaluate(async ({ terminalId, newCount }) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.updateTerminalActivityState(terminalId, { activityCount: newCount });
    }, { terminalId, newCount });
}

/**
 * Helper to get the first graph node ID
 */
async function getFirstNodeId(appWindow: Page): Promise<string> {
    return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const nodes = cy.nodes();
        if (nodes.length === 0) throw new Error('No nodes available');
        return nodes[0].id();
    });
}

/**
 * Helper to get a node ID by index
 */
async function getNodeIdByIndex(appWindow: Page, index: number): Promise<string> {
    return appWindow.evaluate((idx) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const nodes = cy.nodes();
        return nodes.length > idx ? nodes[idx].id() : nodes[0].id();
    }, index);
}

test.describe('Activity Dots E2E', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('Test 1: Activity dots appear when terminal has activity', async ({ appWindow }) => {
        console.log('=== STEP 1: Load vault and wait for graph ===');
        await loadVaultAndWaitForGraph(appWindow);

        console.log('=== STEP 2: Spawn terminal ===');
        const targetNodeId = await getFirstNodeId(appWindow);
        const terminalId = await spawnTerminalAndWait(appWindow, targetNodeId, 'ACTIVITY_DOT_TEST');
        console.log(`Terminal spawned with ID: ${terminalId}`);

        console.log('=== STEP 3: Wait for terminal node in sidebar ===');
        const treeNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${terminalId}"]`);
        await expect(treeNode).toBeVisible({ timeout: 10000 });

        console.log('=== STEP 4: Verify no activity dots initially ===');
        const dotsBeforeActivity = treeNode.locator('.terminal-tree-activity-dot');
        const initialDotCount = await dotsBeforeActivity.count();
        expect(initialDotCount).toBe(0);
        console.log(`Initial activity dots: ${initialDotCount}`);

        console.log('=== STEP 5: Simulate activity (increment activityCount to 3) ===');
        await incrementActivityCount(appWindow, terminalId, 1);
        await appWindow.waitForTimeout(500);
        await incrementActivityCount(appWindow, terminalId, 2);
        await appWindow.waitForTimeout(500);
        await incrementActivityCount(appWindow, terminalId, 3);

        console.log('=== STEP 6: Verify 3 activity dots appear ===');
        await expect.poll(async () => {
            return treeNode.locator('.terminal-tree-activity-dot').count();
        }, {
            message: 'Waiting for 3 activity dots to appear',
            timeout: 10000,
            intervals: [500, 1000, 2000]
        }).toBe(3);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/activity-dots-appear.png'
        });
        console.log('Test 1 passed: Activity dots appear when terminal has activity');
    });

    test('Test 2: Activity dots persist when new terminal is added (re-render)', async ({ appWindow }) => {
        console.log('=== STEP 1: Load vault and wait for graph ===');
        await loadVaultAndWaitForGraph(appWindow);

        console.log('=== STEP 2: Spawn first terminal ===');
        const firstNodeId = await getFirstNodeId(appWindow);
        const firstTerminalId = await spawnTerminalAndWait(appWindow, firstNodeId, 'PERSIST_TEST_1');
        console.log(`First terminal ID: ${firstTerminalId}`);

        console.log('=== STEP 3: Wait for first terminal in sidebar ===');
        const firstTreeNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${firstTerminalId}"]`);
        await expect(firstTreeNode).toBeVisible({ timeout: 10000 });

        console.log('=== STEP 4: Add activity dots to first terminal ===');
        await incrementActivityCount(appWindow, firstTerminalId, 1);
        await appWindow.waitForTimeout(300);
        await incrementActivityCount(appWindow, firstTerminalId, 2);

        // Verify dots appear on first terminal
        await expect.poll(async () => {
            return firstTreeNode.locator('.terminal-tree-activity-dot').count();
        }, {
            message: 'Waiting for 2 activity dots on first terminal',
            timeout: 10000,
            intervals: [500, 1000]
        }).toBe(2);

        console.log('First terminal has 2 activity dots');

        console.log('=== STEP 5: Spawn second terminal (triggers sidebar re-render) ===');
        const secondNodeId = await getNodeIdByIndex(appWindow, 1);
        const secondTerminalId = await spawnTerminalAndWait(appWindow, secondNodeId, 'PERSIST_TEST_2');
        console.log(`Second terminal ID: ${secondTerminalId}`);

        console.log('=== STEP 6: Wait for second terminal to appear in sidebar ===');
        const secondTreeNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${secondTerminalId}"]`);
        await expect(secondTreeNode).toBeVisible({ timeout: 10000 });

        console.log('=== STEP 7: Verify first terminal STILL has 2 activity dots ===');
        // Re-query the first terminal node (React re-renders may create new DOM nodes)
        const firstTreeNodeAfterRerender = appWindow.locator(`.terminal-tree-node[data-terminal-id="${firstTerminalId}"]`);
        const dotCountAfterRerender = await firstTreeNodeAfterRerender.locator('.terminal-tree-activity-dot').count();
        expect(dotCountAfterRerender).toBe(2);
        console.log(`Activity dots after re-render: ${dotCountAfterRerender}`);

        // Also verify sidebar has both terminals
        const allNodes = appWindow.locator('.terminal-tree-node');
        const nodeCount = await allNodes.count();
        expect(nodeCount).toBeGreaterThanOrEqual(2);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/activity-dots-persist-after-rerender.png'
        });
        console.log('Test 2 passed: Activity dots persist when new terminal is added');
    });

    test('Test 3: Activity dots clear on tab click', async ({ appWindow }) => {
        console.log('=== STEP 1: Load vault and wait for graph ===');
        await loadVaultAndWaitForGraph(appWindow);

        console.log('=== STEP 2: Spawn terminal ===');
        const targetNodeId = await getFirstNodeId(appWindow);
        const terminalId = await spawnTerminalAndWait(appWindow, targetNodeId, 'CLEAR_DOTS_TEST');
        console.log(`Terminal ID: ${terminalId}`);

        console.log('=== STEP 3: Wait for terminal node in sidebar ===');
        const treeNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${terminalId}"]`);
        await expect(treeNode).toBeVisible({ timeout: 10000 });

        console.log('=== STEP 4: Add activity dots ===');
        await incrementActivityCount(appWindow, terminalId, 1);
        await appWindow.waitForTimeout(300);
        await incrementActivityCount(appWindow, terminalId, 2);
        await appWindow.waitForTimeout(300);
        await incrementActivityCount(appWindow, terminalId, 3);

        // Verify dots appear
        await expect.poll(async () => {
            return treeNode.locator('.terminal-tree-activity-dot').count();
        }, {
            message: 'Waiting for 3 activity dots',
            timeout: 10000,
            intervals: [500, 1000]
        }).toBe(3);

        console.log('3 activity dots visible');

        console.log('=== STEP 5: Click on the terminal tab ===');
        await treeNode.click();
        await appWindow.waitForTimeout(1000);

        console.log('=== STEP 6: Verify activity dots are cleared ===');
        await expect.poll(async () => {
            // Re-query after click since React may re-render
            return appWindow.locator(`.terminal-tree-node[data-terminal-id="${terminalId}"] .terminal-tree-activity-dot`).count();
        }, {
            message: 'Waiting for activity dots to be cleared after click',
            timeout: 10000,
            intervals: [500, 1000, 2000]
        }).toBe(0);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/activity-dots-cleared-on-click.png'
        });
        console.log('Test 3 passed: Activity dots clear on tab click');
    });

    test('Test 4: Status dot switches from running to done', async ({ appWindow }) => {
        console.log('=== STEP 1: Load vault and wait for graph ===');
        await loadVaultAndWaitForGraph(appWindow);

        console.log('=== STEP 2: Spawn terminal ===');
        const targetNodeId = await getFirstNodeId(appWindow);
        const terminalId = await spawnTerminalAndWait(appWindow, targetNodeId, 'STATUS_DOT_TEST');
        console.log(`Terminal ID: ${terminalId}`);

        console.log('=== STEP 3: Wait for terminal node in sidebar ===');
        const treeNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${terminalId}"]`);
        await expect(treeNode).toBeVisible({ timeout: 10000 });

        console.log('=== STEP 4: Verify running status dot ===');
        const statusDot = treeNode.locator('.terminal-tree-status');
        await expect(statusDot).toBeVisible();
        await expect(statusDot).toHaveClass(/running/);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/status-dot-running.png'
        });
        console.log('Status dot shows running');

        console.log('=== STEP 5: Wait for inactivity timeout (~20s) ===');
        await appWindow.waitForTimeout(20000);

        console.log('=== STEP 6: Verify done status dot ===');
        await expect.poll(async () => {
            const classes = await statusDot.getAttribute('class');
            return classes?.includes('done');
        }, {
            message: 'Waiting for done status indicator',
            timeout: 15000,
            intervals: [1000, 2000, 2000]
        }).toBe(true);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/status-dot-done.png'
        });
        console.log('Test 4 passed: Status dot switches from running to done');
    });
});

export { test };
