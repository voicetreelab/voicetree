/**
 * E2E TESTS for Project Selection Screen
 *
 * Purpose: Verify the project selection flow works end-to-end in Electron.
 * This tests:
 * 1. First launch shows project selection screen
 * 2. Scanning discovers git/obsidian projects
 * 3. Adding a discovered project saves it and opens graph view
 * 4. Selecting a saved project opens graph view
 * 5. Back button returns to project selection
 * 6. Projects persist across app restarts
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import { robustElectronTeardown, resolveGraphDaemonNodeBin, safeStopFileWatching, pollForCytoscape, pollForCytoscapeNodes } from './electron-smoke-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const CI_FLAGS = process.env.CI
    ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
    : [];

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: ElectronAPI;
}

async function waitForProjectScannerToSettle(page: Page): Promise<void> {
    await page.locator('text=Scanning for projects').waitFor({ state: 'hidden', timeout: 10000 })
        .catch(() => {
            console.log('Project scanner still visible after 10s; continuing with saved project selection');
        });
}

async function savedProjectButton(page: Page, projectName: string) {
    const button = page.getByTestId('saved-project-button').filter({ hasText: projectName }).first();
    await expect(button).toBeVisible({ timeout: 10000 });
    return button;
}

async function clickSavedProject(page: Page, projectName: string): Promise<void> {
    await page.waitForSelector('text=Recent Projects', { timeout: 10000 });
    await waitForProjectScannerToSettle(page);
    const button = await savedProjectButton(page, projectName);
    await button.evaluate((element: HTMLElement) => element.click());
}

async function clickBackToProjectSelection(page: Page): Promise<void> {
    const backButton = page.locator('button[title="Back to project selection"]');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    await backButton.evaluate((element: HTMLElement) => element.click());
}

// Base test fixture that creates temp directories for testing
const test = base.extend<{
    testProjectPath: string;
    tempUserDataPath: string;
    electronApp: ElectronApplication;
    appWindow: Page;
}>({
    // Create a test project with .git folder for detection
    testProjectPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-project-selection-'));
        const projectPath = path.join(tempDir, 'test-project');
        const gitPath = path.join(projectPath, '.git');
        const voicetreePath = path.join(projectPath, 'voicetree');

        // Create project structure
        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(gitPath, { recursive: true });
        await fs.mkdir(voicetreePath, { recursive: true });

        // Create test files
        await fs.writeFile(path.join(gitPath, 'HEAD'), 'ref: refs/heads/main\n');
        await fs.writeFile(
            path.join(voicetreePath, 'test.md'),
            '# Test Node\n\nThis is a test markdown file.'
        );

        await use(projectPath);

        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    // Create temp userData directory.
    // Prefix kept short so the resulting `<userData>/tmux.sock` path stays under
    // macOS' 104-char AF_UNIX limit (the longer prefix used previously produced
    // ~110-char paths that made `tmux new-session` fail with `File name too long`,
    // which surfaced as `firstWindow: Timeout` because the main process blocked
    // on the resulting modal error dialog).
    tempUserDataPath: async ({}, use) => {
        const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-projsel-userdata-'));
        await use(tempPath);
        await fs.rm(tempPath, { recursive: true, force: true });
    },

    // Launch Electron app without pre-configured project
    electronApp: async ({ tempUserDataPath }, use) => {
        // Note: NO voicetree-config.json or projects.json - simulates first launch
        const electronApp = await electron.launch({
            args: [
                ...CI_FLAGS,
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_HOME_PATH: tempUserDataPath,
                VOICETREE_PERSIST_STATE: '1', // Use test's userData path instead of creating new temp directory
                VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
            },
            timeout: 15000
        });

        await use(electronApp);

        await safeStopFileWatching(electronApp);
        await robustElectronTeardown(electronApp);
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 15000 });

        window.on('console', msg => {
            console.log(`BROWSER [${msg.type()}]:`, msg.text());
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');

        await use(window);
    }
});

test.describe('Project Selection Screen E2E', () => {
    test('should show project selection screen on first launch', async ({ appWindow }) => {
        test.setTimeout(30000);
        console.log('=== TEST: Project selection screen shows on first launch ===');

        // Wait for the project selection screen to load
        // The title "Voicetree" and "Select a project to open" should be visible
        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });
        await appWindow.waitForSelector('text=Select a project to open', { timeout: 5000 });

        console.log('✓ Project selection screen title visible');

        // On first launch the screen is in one of four valid states:
        // 1. "No projects yet" – scanner hasn't found anything yet
        // 2. "Scanning for projects" – scanner still running
        // 3. "Recent Projects" – scanner already completed (common in CI where git repos exist)
        // 4. "Discovered Projects" – scanner found local projects before any are saved
        const emptyStateVisible = await appWindow.locator('text=No projects yet').isVisible()
            .catch(() => false);
        const scanningVisible = await appWindow.locator('text=Scanning for projects').isVisible()
            .catch(() => false);
        const recentProjectsVisible = await appWindow.locator('text=Recent Projects').isVisible()
            .catch(() => false);
        const discoveredProjectsVisible = await appWindow.locator('text=Discovered Projects').isVisible()
            .catch(() => false);

        expect(emptyStateVisible || scanningVisible || recentProjectsVisible || discoveredProjectsVisible).toBe(true);
        console.log('✓ Project selection content state visible');

        // Open existing folder button should be visible
        const browseButton = appWindow.locator('button:has-text("Open existing folder")');
        await expect(browseButton).toBeVisible({ timeout: 5000 });
        console.log('✓ Open existing folder button visible');

        // No cytoscape instance should exist yet
        const hasCytoscape = await appWindow.evaluate(() => {
            return !!(window as ExtendedWindow).cytoscapeInstance;
        });
        expect(hasCytoscape).toBe(false);
        console.log('✓ No graph view loaded (correct for project selection screen)');

        console.log('✅ First launch test passed!');
    });

    test('should add project via browse and navigate to graph view', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);
        console.log('=== TEST: Add project via browse and navigate to graph ===');
        console.log('Test project path:', testProjectPath);

        // Wait for project selection screen
        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        // Use the electronAPI to directly call saveProject and then trigger project selection
        // (bypasses folder picker dialog which can't be automated easily)
        await appWindow.evaluate(async (projectPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            // Save the test project
            const newProject = {
                id: crypto.randomUUID(),
                path: projectPath,
                name: projectPath.split('/').pop() ?? 'test-project',
                type: 'git' as const,
                lastOpened: Date.now(),
            };

            await api.main.saveProject(newProject);
        }, testProjectPath);

        console.log('✓ Saved test project via API');

        // Reload the page to see the saved project
        await appWindow.reload();
        await appWindow.waitForLoadState('domcontentloaded');
        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        // Wait for the saved project to appear in Recent Projects
        await appWindow.waitForSelector('text=Recent Projects', { timeout: 5000 });
        console.log('✓ Recent Projects section visible');

        // Find and click the test project
        const projectName = testProjectPath.split('/').pop() ?? 'test-project';
        await savedProjectButton(appWindow, projectName);
        console.log('✓ Test project visible in list');

        // Click to select the project
        await clickSavedProject(appWindow, projectName);
        console.log('✓ Clicked project to select');

        // Wait for graph view to load (cytoscape instance should become available)
        await pollForCytoscape(appWindow, 15000);
        console.log('✓ Graph view loaded');

        // Wait for nodes to actually load into the graph
        await pollForCytoscapeNodes(appWindow, 1, 15000);

        // Verify cytoscape has nodes
        const nodeCount = await appWindow.evaluate(() => {
            const cy = (window as ExtendedWindow).cytoscapeInstance;
            return cy ? cy.nodes().length : 0;
        });
        console.log(`✓ Graph has ${nodeCount} nodes`);
        expect(nodeCount).toBeGreaterThan(0);

        // Verify back button is visible
        const backButton = appWindow.locator('button[title="Back to project selection"]');
        await expect(backButton).toBeVisible({ timeout: 5000 });
        console.log('✓ Back button visible');

        console.log('✅ Add project and navigate test passed!');
    });

    test('should navigate back to project selection from graph view', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);
        console.log('=== TEST: Navigate back to project selection ===');

        // First, set up a project and navigate to graph view
        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        await appWindow.evaluate(async (projectPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            const newProject = {
                id: crypto.randomUUID(),
                path: projectPath,
                name: projectPath.split('/').pop() ?? 'test-project',
                type: 'git' as const,
                lastOpened: Date.now(),
            };
            await api.main.saveProject(newProject);
        }, testProjectPath);

        await appWindow.reload();
        await appWindow.waitForLoadState('domcontentloaded');
        await appWindow.waitForSelector('text=Recent Projects', { timeout: 10000 });

        // Select project
        const projectName = testProjectPath.split('/').pop() ?? 'test-project';
        await clickSavedProject(appWindow, projectName);

        // Wait for graph view
        await pollForCytoscape(appWindow, 15000);
        console.log('✓ In graph view');

        // Click back button
        await clickBackToProjectSelection(appWindow);
        console.log('✓ Clicked back button');

        // Wait for project selection screen to reappear
        await appWindow.waitForSelector('text=Select a project to open', { timeout: 10000 });
        console.log('✓ Project selection screen visible');

        // Note: cytoscapeInstance might still be on window even after dispose
        // The key test is that the UI shows project selection

        // Verify the project is still in the list
        await appWindow.waitForSelector('text=Recent Projects', { timeout: 5000 });
        const projectStillVisible = await (await savedProjectButton(appWindow, projectName)).isVisible();
        expect(projectStillVisible).toBe(true);
        console.log('✓ Project still in saved list');

        console.log('✅ Navigate back test passed!');
    });

    test('should persist projects across app restart', async () => {
        test.setTimeout(60000);
        console.log('=== TEST: Projects persist across app restart ===');

        // Create isolated temp directories that persist for the duration of this test
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-persist-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-persist-project-'));
        const projectPath = path.join(tempProjectPath, 'my-project');
        const voicetreePath = path.join(projectPath, 'voicetree');

        // Create project structure
        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(voicetreePath, { recursive: true });
        await fs.writeFile(path.join(voicetreePath, 'test.md'), '# Test\n\nPersistence test.');

        // Pre-create projects.json with a saved project
        // This simulates what the app would save when a user adds a project
        const savedProject = {
            id: 'persistence-test-id',
            path: projectPath,
            name: 'persistent-project',
            type: 'folder',
            lastOpened: Date.now(),
        };
        await fs.writeFile(
            path.join(tempUserDataPath, 'projects.json'),
            JSON.stringify([savedProject], null, 2),
            'utf8'
        );
        console.log('✓ Created projects.json with saved project');

        try {
            // Launch first instance - should show the pre-saved project
            const app1 = await electron.launch({
                args: [
                    ...CI_FLAGS,
                    path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                    `--user-data-dir=${tempUserDataPath}`
                ],
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    HEADLESS_TEST: '1',
                    MINIMIZE_TEST: '1',
                    VOICETREE_HOME_PATH: tempUserDataPath,
                    VOICETREE_PERSIST_STATE: '1', // Use test's userData path instead of creating new temp directory
                    VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
                },
                timeout: 15000
            });

            const window1 = await app1.firstWindow({ timeout: 15000 });
            await window1.waitForLoadState('domcontentloaded');
            await window1.waitForSelector('text=Voicetree', { timeout: 10000 });

            // Wait for saved projects to load and display
            await window1.waitForSelector('text=Recent Projects', { timeout: 10000 });
            console.log('✓ First app shows Recent Projects');

            // Verify project is visible
            const projectVisibleInApp1 = await (await savedProjectButton(window1, 'persistent-project')).isVisible();
            expect(projectVisibleInApp1).toBe(true);
            console.log('✓ Project visible in first app instance');

            // Close first app. Plain app.close() can hang while background project
            // scanning is still active, which prevents this restart test from
            // reaching the second launch.
            await robustElectronTeardown(app1);
            console.log('✓ Closed first app instance');

            // Wait a moment for file system to sync
            await new Promise(resolve => setTimeout(resolve, 500));

            // Launch second instance
            const app2 = await electron.launch({
                args: [
                    ...CI_FLAGS,
                    path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                    `--user-data-dir=${tempUserDataPath}`
                ],
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    HEADLESS_TEST: '1',
                    MINIMIZE_TEST: '1',
                    VOICETREE_HOME_PATH: tempUserDataPath,
                    VOICETREE_PERSIST_STATE: '1', // Use test's userData path instead of creating new temp directory
                    VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
                },
                timeout: 15000
            });

            const window2 = await app2.firstWindow({ timeout: 15000 });
            await window2.waitForLoadState('domcontentloaded');
            await window2.waitForSelector('text=Voicetree', { timeout: 10000 });

            // Wait for projects to load
            await window2.waitForSelector('text=Recent Projects', { timeout: 10000 });
            console.log('✓ Second app shows Recent Projects');

            // Verify the project is still there
            const projectVisible = await (await savedProjectButton(window2, 'persistent-project')).isVisible();
            expect(projectVisible).toBe(true);
            console.log('✓ Project persisted across restart');

            // Cleanup second app through the same bounded shutdown path.
            await robustElectronTeardown(app2);
            console.log('✅ Persistence test passed!');
        } finally {
            // Cleanup temp directories
            await fs.rm(tempUserDataPath, { recursive: true, force: true });
            await fs.rm(tempProjectPath, { recursive: true, force: true });
        }
    });
});

test.describe('Watched Folder Panel Regression', () => {
    /**
     * Test: Open a project WITHOUT existing config (fresh project)
     * This tests the default case where no voicetree-config.json entry exists.
     */
    test('should show watched folder panel for fresh project without config', async () => {
        test.setTimeout(60000);
        console.log('=== TEST: Watched folder panel for FRESH project (no config) ===');

        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fresh-test-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fresh-test-project-'));
        const projectPath = path.join(tempProjectPath, 'fresh-project');
        const voicetreePath = path.join(projectPath, 'voicetree');

        try {
            // Create project structure (NO voicetree-config.json entry!)
            await fs.mkdir(voicetreePath, { recursive: true });
            await fs.writeFile(
                path.join(voicetreePath, 'test-node.md'),
                '# Fresh Test Node\n\nThis is a fresh project with no existing config.'
            );

            // Only create projects.json - NO voicetree-config.json projectConfig
            const savedProject = {
                id: 'fresh-project-id',
                path: projectPath,
                name: 'fresh-project',
                type: 'folder' as const,
                lastOpened: Date.now(),
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'projects.json'),
                JSON.stringify([savedProject], null, 2),
                'utf8'
            );
            console.log('✓ Created fresh project (no voicetree-config.json)');

            const electronApp = await electron.launch({
                args: [
                    ...CI_FLAGS,
                    path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                    `--user-data-dir=${tempUserDataPath}`
                ],
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    HEADLESS_TEST: '1',
                    MINIMIZE_TEST: '1',
                    VOICETREE_HOME_PATH: tempUserDataPath,
                    VOICETREE_PERSIST_STATE: '1',
                    VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
                },
                timeout: 15000
            });

            const appWindow = await electronApp.firstWindow({ timeout: 15000 });
            appWindow.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
            await appWindow.waitForLoadState('domcontentloaded');
            await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

            // Click the project
            await clickSavedProject(appWindow, 'fresh-project');
            console.log('✓ Clicked fresh project');

            // Wait for graph
            await pollForCytoscapeNodes(appWindow, 1, 15000);
            console.log('✓ Graph loaded');

            // Wait for panel to appear
            try {
                await appWindow.locator('button[title*="Project root"]').waitFor({ state: 'visible', timeout: 10000 });
                console.log('✓ Folder panel appeared');
            } catch {
                console.log('✗ Folder panel did NOT appear within 10s');
            }

            const folderNameVisible = await appWindow.locator('button[title*="Project root"]').isVisible();
            const projectSelectorVisible = await appWindow.locator('button[title*="Write Path"]').isVisible();
            const watchStatus = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getWatchStatus() : null;
            });
            const projectPaths = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getProjectPaths() : null;
            });

            const debugInfo = JSON.stringify({ folderNameVisible, projectSelectorVisible, watchStatus, projectPaths }, null, 2);
            expect(folderNameVisible, `Fresh project panel check - ${debugInfo}`).toBe(true);
            expect(projectSelectorVisible, `Fresh project project selector - ${debugInfo}`).toBe(true);

            console.log('✅ Fresh project shows panel correctly');

            await safeStopFileWatching(electronApp);
            await robustElectronTeardown(electronApp);
        } finally {
            await fs.rm(tempUserDataPath, { recursive: true, force: true });
            await fs.rm(tempProjectPath, { recursive: true, force: true });
        }
    });

    /**
     * BUG REPRODUCTION TEST:
     * "the bottom left watched folder panel disappears for some projects when you open it"
     * User hypothesis: "maybe projects that already have config json?"
     *
     * This test verifies that the watched folder panel (FileWatchingPanel) remains visible
     * when opening a project that has a pre-existing voicetree-config.json entry.
     */
    test('should show watched folder panel for projects with existing config', async () => {
        test.setTimeout(60000);
        console.log('=== TEST: Watched folder panel visible for projects with existing config ===');

        // Create isolated temp directories
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-panel-test-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-panel-test-project-'));
        const projectPath = path.join(tempProjectPath, 'existing-config-project');
        const voicetreePath = path.join(projectPath, 'voicetree');

        try {
            // 1. Create project structure
            await fs.mkdir(projectPath, { recursive: true });
            await fs.mkdir(voicetreePath, { recursive: true });
            await fs.writeFile(
                path.join(voicetreePath, 'test-node.md'),
                '# Test Node\n\nThis is a test file in a project with existing config.'
            );
            console.log('✓ Created project structure at:', projectPath);

            // 2. Pre-create voicetree-config.json with projectConfig for this project
            // This simulates a project that was previously opened
            const voicetreeConfig = {
                lastDirectory: projectPath,
                projectConfig: {
                    [projectPath]: {
                        writeFolderPath: voicetreePath,
                        readPaths: []
                    }
                }
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'voicetree-config.json'),
                JSON.stringify(voicetreeConfig, null, 2),
                'utf8'
            );
            console.log('✓ Created voicetree-config.json with existing projectConfig');

            // 3. Pre-create projects.json with the saved project
            const savedProject = {
                id: 'existing-config-test-id',
                path: projectPath,
                name: 'existing-config-project',
                type: 'folder' as const,
                lastOpened: Date.now(),
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'projects.json'),
                JSON.stringify([savedProject], null, 2),
                'utf8'
            );
            console.log('✓ Created projects.json with saved project');

            // 4. Launch the app
            const electronApp = await electron.launch({
                args: [
                    ...CI_FLAGS,
                    path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                    `--user-data-dir=${tempUserDataPath}`
                ],
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    HEADLESS_TEST: '1',
                    MINIMIZE_TEST: '1',
                    VOICETREE_HOME_PATH: tempUserDataPath,
                    VOICETREE_PERSIST_STATE: '1',
                    VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
                },
                timeout: 15000
            });

            const appWindow = await electronApp.firstWindow({ timeout: 15000 });

            appWindow.on('console', msg => {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            });

            await appWindow.waitForLoadState('domcontentloaded');
            await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });
            console.log('✓ App launched');

            // voicetree-config.json has lastDirectory set, so the app may auto-load before
            // the project selection screen is shown. Try to detect auto-load first.
            let graphLoadedViaAutoLoad = false;
            try {
                await pollForCytoscape(appWindow, 3000);
                graphLoadedViaAutoLoad = true;
                console.log('✓ Graph auto-loaded via lastDirectory config');
            } catch {
                // Not auto-loaded — go through project selection
            }

            if (!graphLoadedViaAutoLoad) {
                // 5. Verify the project appears in Recent Projects
                await savedProjectButton(appWindow, 'existing-config-project');
                console.log('✓ Project visible in Recent Projects');

                // 6. Click to open the project
                await clickSavedProject(appWindow, 'existing-config-project');
                console.log('✓ Clicked project to open');
            }

            // 7. Wait for graph view to load
            await pollForCytoscape(appWindow, 15000);
            console.log('✓ Graph view loaded');

            // 8. Wait for nodes to load (proves the graph actually loaded)
            await pollForCytoscapeNodes(appWindow, 1, 15000);
            const nodeCount = await appWindow.evaluate(() => {
                const cy = (window as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
            console.log(`✓ Graph has ${nodeCount} nodes`);

            // 9. KEY VERIFICATION: Check that the watched folder panel is fully visible
            // The bug is that this panel disappears for some projects

            // 9a. Back button should always be visible
            const backButton = appWindow.locator('button[title="Back to project selection"]');
            await expect(backButton).toBeVisible({ timeout: 5000 });
            console.log('✓ Back button visible');

            // 9b. Project folder name should be visible (part of FileWatchingPanel)
            // This is the button that shows the watched folder name
            const folderNameButton = appWindow.locator('button[title*="Project root"]');
            const isFolderNameVisible = await folderNameButton.isVisible({ timeout: 5000 }).catch(() => false);
            console.log('Folder name button visible:', isFolderNameVisible);

            // 9c. ProjectPathSelector should be visible (shows the write path)
            // This is inside FileWatchingPanel, conditional on watchDirectory being truthy
            const projectSelector = appWindow.locator('button[title*="Write Path"]');
            const isProjectSelectorVisible = await projectSelector.isVisible({ timeout: 5000 }).catch(() => false);
            console.log('Project selector visible:', isProjectSelectorVisible);

            // 9d. Get watch status from the API to debug
            const watchStatus = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getWatchStatus() : null;
            });
            console.log('Watch status:', watchStatus);

            // 9e. Get project paths to see what the panel would show
            const projectPaths = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getProjectPaths() : null;
            });
            console.log('Project paths:', projectPaths);

            // Take a screenshot for debugging if the panel is hidden
            if (!isFolderNameVisible || !isProjectSelectorVisible) {
                await appWindow.screenshot({
                    path: path.join(tempUserDataPath, 'watched-folder-panel-bug.png')
                });
                console.log('Screenshot saved to:', path.join(tempUserDataPath, 'watched-folder-panel-bug.png'));
            }

            // Assert that the full panel content is visible
            // If this fails, we've reproduced the bug!
            expect(isFolderNameVisible).toBe(true);
            expect(isProjectSelectorVisible).toBe(true);
            expect(watchStatus?.directory).toBe(projectPath);
            expect(projectPaths).not.toBeNull();
            expect(projectPaths!.length).toBeGreaterThan(0);

            console.log('✅ Watched folder panel fully visible for project with existing config!');

            await safeStopFileWatching(electronApp);
            await robustElectronTeardown(electronApp);

        } finally {
            await fs.rm(tempUserDataPath, { recursive: true, force: true });
            await fs.rm(tempProjectPath, { recursive: true, force: true });
        }
    });

    /**
     * Additional regression test: Compare behavior between new and existing projects
     */
    test('should show same panel behavior for new vs existing config projects', async () => {
        test.setTimeout(90000);
        console.log('=== TEST: Compare panel visibility - new vs existing config ===');

        // Create isolated temp directories
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-compare-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-compare-project-'));

        // Two projects: one with existing config, one without
        const projectWithConfig = path.join(tempProjectPath, 'with-config');
        const projectWithoutConfig = path.join(tempProjectPath, 'without-config');
        const voicetreeWithConfig = path.join(projectWithConfig, 'voicetree');
        const voicetreeWithoutConfig = path.join(projectWithoutConfig, 'voicetree');
        let electronApp: ElectronApplication | undefined;

        try {
            // Create both project structures
            await fs.mkdir(voicetreeWithConfig, { recursive: true });
            await fs.mkdir(voicetreeWithoutConfig, { recursive: true });
            await fs.writeFile(
                path.join(voicetreeWithConfig, 'test.md'),
                '# Test With Config'
            );
            await fs.writeFile(
                path.join(voicetreeWithoutConfig, 'test.md'),
                '# Test Without Config'
            );

            // Pre-create config ONLY for projectWithConfig
            const voicetreeConfig = {
                projectConfig: {
                    [projectWithConfig]: {
                        writeFolderPath: voicetreeWithConfig,
                        readPaths: []
                    }
                }
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'voicetree-config.json'),
                JSON.stringify(voicetreeConfig, null, 2),
                'utf8'
            );

            // Save both projects
            const savedProjects = [
                {
                    id: 'with-config-id',
                    path: projectWithConfig,
                    name: 'with-config',
                    type: 'folder' as const,
                    lastOpened: Date.now(),
                },
                {
                    id: 'without-config-id',
                    path: projectWithoutConfig,
                    name: 'without-config',
                    type: 'folder' as const,
                    lastOpened: Date.now() - 1000, // Slightly older so "with-config" appears first
                }
            ];
            await fs.writeFile(
                path.join(tempUserDataPath, 'projects.json'),
                JSON.stringify(savedProjects, null, 2),
                'utf8'
            );

            console.log('✓ Created two projects: one with existing config, one without');

            // Helper to check panel visibility
            const checkPanelVisibility = async (appWindow: Page, projectName: string, tempDir: string) => {
                console.log(`[${projectName}] About to click project...`);
                await clickSavedProject(appWindow, projectName);
                console.log(`[${projectName}] Clicked, waiting for graph...`);

                await pollForCytoscapeNodes(appWindow, 1, 15000);
                console.log(`[${projectName}] Graph loaded with nodes`);

                // CRITICAL: Wait for the "Project root" button to appear
                // This indicates React has received the watching-started event and re-rendered
                try {
                    await appWindow.locator('button[title*="Project root"]').waitFor({ state: 'visible', timeout: 10000 });
                    console.log(`[${projectName}] Folder panel became visible`);
                } catch {
                    console.log(`[${projectName}] WARNING: Folder panel did NOT become visible within 10s`);
                }

                // Check panel elements
                const folderNameVisible = await appWindow.locator('button[title*="Project root"]').isVisible().catch(() => false);
                const projectSelectorVisible = await appWindow.locator('button[title*="Write Path"]').isVisible().catch(() => false);
                const watchStatus = await appWindow.evaluate(async () => {
                    const api = (window as ExtendedWindow).electronAPI;
                    return api ? await api.main.getWatchStatus() : null;
                });
                const projectPaths = await appWindow.evaluate(async () => {
                    const api = (window as ExtendedWindow).electronAPI;
                    return api ? await api.main.getProjectPaths() : null;
                });

                // Take screenshot for debugging
                const screenshotPath = path.join(tempDir, `panel-check-${projectName}.png`);
                await appWindow.screenshot({ path: screenshotPath, timeout: 5000 })
                    .then(() => console.log(`[${projectName}] Screenshot saved to: ${screenshotPath}`))
                    .catch(error => console.log(`[${projectName}] Screenshot skipped: ${String(error)}`));

                return {
                    folderNameVisible,
                    projectSelectorVisible,
                    isWatching: watchStatus?.isWatching,
                    directory: watchStatus?.directory,
                    projectPathsCount: projectPaths?.length ?? 0
                };
            };

            // Launch app
            electronApp = await electron.launch({
                args: [
                    ...CI_FLAGS,
                    path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                    `--user-data-dir=${tempUserDataPath}`
                ],
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    HEADLESS_TEST: '1',
                    MINIMIZE_TEST: '1',
                    VOICETREE_HOME_PATH: tempUserDataPath,
                    VOICETREE_PERSIST_STATE: '1',
                    VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
                },
                timeout: 15000
            });

            const appWindow = await electronApp.firstWindow({ timeout: 15000 });
            appWindow.on('console', msg => {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            });
            await appWindow.waitForLoadState('domcontentloaded');
            await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

            // Test project WITH existing config
            console.log('\n--- Testing project WITH existing config ---');
            const resultWithConfig = await checkPanelVisibility(appWindow, 'with-config', tempUserDataPath);
            console.log('Result (with config):', resultWithConfig);

            // Go back to project selection
            await clickBackToProjectSelection(appWindow);
            await appWindow.waitForSelector('text=Select a project to open', { timeout: 10000 });

            // Test project WITHOUT existing config
            console.log('\n--- Testing project WITHOUT existing config ---');
            const resultWithoutConfig = await checkPanelVisibility(appWindow, 'without-config', tempUserDataPath);
            console.log('Result (without config):', resultWithoutConfig);

            // Compare results
            console.log('\n--- Comparison ---');
            console.log('With config - folder visible:', resultWithConfig.folderNameVisible);
            console.log('Without config - folder visible:', resultWithoutConfig.folderNameVisible);
            console.log('With config - project selector visible:', resultWithConfig.projectSelectorVisible);
            console.log('Without config - project selector visible:', resultWithoutConfig.projectSelectorVisible);
            console.log('With config - watch status:', resultWithConfig.isWatching, resultWithConfig.directory);
            console.log('Without config - watch status:', resultWithoutConfig.isWatching, resultWithoutConfig.directory);
            console.log('With config - project paths count:', resultWithConfig.projectPathsCount);
            console.log('Without config - project paths count:', resultWithoutConfig.projectPathsCount);

            // Read the voicetree-config.json to see what config was saved
            const configContent = await fs.readFile(
                path.join(tempUserDataPath, 'voicetree-config.json'),
                'utf8'
            );
            console.log('voicetree-config.json after both opens:', configContent);

            // Both should have visible panels!
            // If resultWithConfig.folderNameVisible is FALSE but resultWithoutConfig is TRUE,
            // we've confirmed the bug that "projects with existing config" have panel issues
            const debugInfo = JSON.stringify({
                withConfig: resultWithConfig,
                withoutConfig: resultWithoutConfig,
                config: JSON.parse(configContent)
            }, null, 2);

            expect(resultWithConfig.folderNameVisible, `WITH CONFIG - Debug: ${debugInfo}`).toBe(true);
            expect(resultWithConfig.projectSelectorVisible, `WITH CONFIG selector - Debug: ${debugInfo}`).toBe(true);
            expect(resultWithoutConfig.folderNameVisible, `WITHOUT CONFIG - Debug: ${debugInfo}`).toBe(true);
            expect(resultWithoutConfig.projectSelectorVisible, `WITHOUT CONFIG selector - Debug: ${debugInfo}`).toBe(true);

            console.log('✅ Both project types show watched folder panel correctly!');

        } finally {
            if (electronApp) {
                await safeStopFileWatching(electronApp).catch(error => {
                    console.log(`safeStopFileWatching failed during cleanup: ${String(error)}`);
                });
                await robustElectronTeardown(electronApp).catch(error => {
                    console.log(`robustElectronTeardown failed during cleanup: ${String(error)}`);
                });
            }
            await fs.rm(tempUserDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            await fs.rm(tempProjectPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});

test.describe('Project Scanner Integration', () => {
    test('should detect git repositories when scanning', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(30000);
        console.log('=== TEST: Scanner detects git repositories ===');

        // Wait for project selection screen
        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        // Get the parent directory of the test project
        const parentDir = path.dirname(testProjectPath);

        // Call scanForProjects API directly
        const discovered = await appWindow.evaluate(async (searchDir: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.scanForProjects([searchDir]);
        }, parentDir);

        console.log('Discovered projects:', discovered);

        // Should find the test-project git repo
        const foundTestProject = discovered.some(
            (p: { path: string; type: string }) => p.path === testProjectPath && p.type === 'git'
        );
        expect(foundTestProject).toBe(true);
        console.log('✓ Git repository detected by scanner');

        console.log('✅ Scanner test passed!');
    });
});

export { test };
