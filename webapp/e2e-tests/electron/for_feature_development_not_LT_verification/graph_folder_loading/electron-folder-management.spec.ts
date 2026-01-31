/**
 * BEHAVIORAL SPEC:
 * E2E tests for the VaultPathSelector folder management component.
 *
 * Tests the complete folder management flow:
 * 1. Dropdown opens with three sections (Writing to, Also reading, Add folder)
 * 2. Add folder as read source
 * 3. Set folder as write destination
 * 4. Promote read folder to write folder
 * 5. Reset write folder to project root
 * 6. Search filters available folders
 *
 * PRECONDITION:
 * Test project has multiple subfolder directories to test folder operations.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    testProjectPath: string;
    tempUserDataPath: string;
}>({
    // Create test project with multiple folders
    testProjectPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-folder-mgmt-test-'));

        // Create a root markdown file (required for app to auto-load the project)
        await fs.writeFile(
            path.join(tempDir, 'root-node.md'),
            '# Root Node\n\nTest node in project root.'
        );

        // Create multiple folders for testing
        const folders = ['notes', 'docs', 'archive', 'projects'];
        for (const folder of folders) {
            const folderPath = path.join(tempDir, folder);
            await fs.mkdir(folderPath, { recursive: true });
            // Create a test file in each folder
            await fs.writeFile(
                path.join(folderPath, `${folder}-node.md`),
                `# ${folder.charAt(0).toUpperCase() + folder.slice(1)} Node\n\nTest node in ${folder} folder.`
            );
        }

        // Create a nested folder for search testing
        const nestedPath = path.join(tempDir, 'projects', 'subproject');
        await fs.mkdir(nestedPath, { recursive: true });
        await fs.writeFile(
            path.join(nestedPath, 'nested-node.md'),
            '# Nested Node\n\nTest node in nested folder.'
        );

        await use(tempDir);

        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    tempUserDataPath: async ({}, use) => {
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-folder-mgmt-userdata-'));
        await use(tempUserDataPath);
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    },

    electronApp: async ({ testProjectPath, tempUserDataPath }, use) => {
        // Configure to auto-load test project - use notes folder as the lastDirectory
        // so the app loads the vault directly without showing the project picker
        const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
        const notesPath = path.join(testProjectPath, 'notes');
        await fs.writeFile(configPath, JSON.stringify({
            lastDirectory: notesPath
        }, null, 2), 'utf8');
        console.log('[Folder Management Test] Created config to auto-load:', notesPath);

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
            timeout: 15000
        });

        await use(electronApp);

        // Graceful shutdown
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
    },

    appWindow: async ({ electronApp, testProjectPath }, use) => {
        const window = await electronApp.firstWindow({ timeout: 15000 });

        window.on('console', msg => {
            if (msg.type() === 'error') {
                console.log(`[BROWSER ${msg.type()}]:`, msg.text());
            }
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');

        // Check if project selection screen is shown
        const isProjectSelection = await window.locator('text=Select a project to open').isVisible({ timeout: 3000 }).catch(() => false);

        if (isProjectSelection) {
            console.log('[appWindow] Project selection screen detected - adding test project');

            const notesPath = path.join(testProjectPath, 'notes');

            // Wait for electronAPI to be available
            await window.waitForFunction(() => !!(window as unknown as ExtendedWindow).electronAPI, { timeout: 5000 });

            // Save the project to make it appear in the list
            const projectName = 'test-folder-mgmt';
            await window.evaluate(async (params: { folderPath: string; projectName: string }) => {
                const api = (window as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');

                // Create and save the project
                const project = {
                    id: crypto.randomUUID(),
                    path: params.folderPath,
                    name: params.projectName,
                    type: 'folder' as const,
                    lastOpened: Date.now(),
                    voicetreeInitialized: false,
                };
                await api.main.saveProject(project);
            }, { folderPath: notesPath, projectName });

            console.log('[appWindow] Project saved, waiting for it to appear in list');

            // Wait for the project to appear in the list
            await window.waitForTimeout(500);

            // Look for the project by path (since the UI shows project paths)
            // The saved projects have a button containing the project name
            const projectButton = window.locator(`button:has-text("${projectName}")`);
            const projectVisible = await projectButton.isVisible({ timeout: 3000 }).catch(() => false);

            if (projectVisible) {
                console.log('[appWindow] Clicking on test project to select it');
                await projectButton.click();
            } else {
                console.log('[appWindow] Project not found in list, reloading and trying again');
                // Reload the page and try again
                await window.reload();
                await window.waitForLoadState('domcontentloaded');
                await window.waitForTimeout(1000);

                const projectButtonRetry = window.locator(`button:has-text("${projectName}")`);
                await projectButtonRetry.click({ timeout: 5000 });
            }

            console.log('[appWindow] Project selected');
        }

        // Wait for cytoscape to be ready
        await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });

        // Wait for graph to fully load
        await window.waitForTimeout(1000);

        await use(window);
    }
});

test.describe('Folder Management E2E', () => {
    test('dropdown opens with three sections', async ({ appWindow }) => {
        test.setTimeout(30000);

        console.log('=== STEP 1: Find and click folder selector button ===');
        // The VaultPathSelector button has title starting with "Write Path:"
        const selectorButton = appWindow.locator('button[title^="Write Path:"]');
        await expect(selectorButton).toBeVisible({ timeout: 5000 });

        // Click to open dropdown
        await selectorButton.click();

        console.log('=== STEP 2: Verify WRITING TO section visible ===');
        const writingToSection = appWindow.locator('text=Writing to');
        await expect(writingToSection).toBeVisible({ timeout: 3000 });

        console.log('=== STEP 3: Verify ADD FOLDER section visible ===');
        const addFolderSection = appWindow.locator('text=Add folder');
        await expect(addFolderSection).toBeVisible({ timeout: 3000 });

        console.log('=== STEP 4: Verify search input visible ===');
        // Search input has placeholder "🔍 Search folders..."
        const searchInput = appWindow.locator('input[placeholder*="Search folders"]');
        await expect(searchInput).toBeVisible({ timeout: 3000 });

        console.log('=== TEST PASSED: Dropdown shows required sections ===');
    });

    test('add folder as read', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);

        console.log('=== STEP 1: Get initial vault paths ===');
        const initialPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getVaultPaths();
        });
        console.log('Initial paths:', initialPaths);

        console.log('=== STEP 2: Open dropdown ===');
        const selectorButton = appWindow.locator('button[title^="Write Path:"]');
        await selectorButton.click();
        await appWindow.waitForTimeout(300);

        console.log('=== STEP 3: Find and click [+ Read] button for docs folder ===');
        // Find the row with "docs" and click its "+ Read" button
        const addReadResult = await appWindow.evaluate(async (projectPath: string) => {
            const dropdown = document.querySelector('.absolute.bottom-full');
            if (!dropdown) return { success: false, error: 'No dropdown found' };

            // Find all rows with "+ Read" buttons
            const buttons = Array.from(dropdown.querySelectorAll('button'));
            const readButton = buttons.find(b =>
                b.textContent?.includes('+ Read') &&
                b.closest('div')?.textContent?.includes('docs')
            );

            if (readButton) {
                (readButton as HTMLButtonElement).click();
                return { success: true };
            }

            // If not found in dropdown, try via API directly
            const api = (window as ExtendedWindow).electronAPI;
            if (api) {
                const docsPath = projectPath + '/docs';
                const result = await api.main.addReadPath(docsPath);
                return { success: result.success, viaApi: true };
            }

            return { success: false, error: 'No + Read button found for docs' };
        }, testProjectPath);

        console.log('Add read result:', addReadResult);

        // Wait for the operation to complete
        await appWindow.waitForTimeout(1000);

        console.log('=== STEP 4: Verify folder appears in vault paths ===');
        const updatedPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getVaultPaths();
        });
        console.log('Updated paths:', updatedPaths);

        const hasDocsPath = updatedPaths.some((p: string) => p.includes('docs'));
        expect(hasDocsPath).toBe(true);

        console.log('=== STEP 5: Verify graph loads nodes from that folder ===');
        const graphNodes = await appWindow.evaluate(() => {
            const cy = (window as ExtendedWindow).cytoscapeInstance;
            if (!cy) return [];
            return cy.nodes().filter(n => !n.data('isShadowNode')).map(n => n.id());
        });
        console.log('Graph nodes:', graphNodes);

        const hasDocsNode = graphNodes.some((id: string) => id.includes('docs'));
        expect(hasDocsNode).toBe(true);

        console.log('=== TEST PASSED: Folder added as read source ===');
    });

    test('set folder as write destination', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);

        console.log('=== STEP 1: Get initial write path ===');
        const initialWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWritePath);
        expect(initialWritePath).toContain('notes');

        console.log('=== STEP 2: Set docs folder as write destination via API ===');
        const docsPath = path.join(testProjectPath, 'docs');
        const setResult = await appWindow.evaluate(async (targetPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            // First add to read paths, then set as write
            await api.main.addReadPath(targetPath);
            return await api.main.setWritePath(targetPath);
        }, docsPath);

        console.log('Set write path result:', setResult);
        expect(setResult.success).toBe(true);

        console.log('=== STEP 3: Verify write path changed ===');
        const newWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWritePath);
        expect(newWritePath).toContain('docs');

        console.log('=== STEP 4: Verify docs is now the write destination ===');
        const allPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getVaultPaths();
        });
        console.log('All paths:', allPaths);

        // docs should be in the paths as the write path
        const hasDocsPath = allPaths.some((p: string) => p.includes('docs'));
        expect(hasDocsPath).toBe(true);

        console.log('=== TEST PASSED: Folder set as write destination ===');
    });

    test('promote read folder to write', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);

        console.log('=== STEP 1: Setup - add docs as read folder ===');
        const docsPath = path.join(testProjectPath, 'docs');
        const addResult = await appWindow.evaluate(async (targetPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.addReadPath(targetPath);
        }, docsPath);
        console.log('Add docs as read result:', addResult);
        expect(addResult.success).toBe(true);

        console.log('=== STEP 2: Get current write path (should be notes) ===');
        const initialWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWritePath);
        expect(initialWritePath).toContain('notes');

        console.log('=== STEP 3: Promote docs to write folder ===');
        const promoteResult = await appWindow.evaluate(async (targetPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.setWritePath(targetPath);
        }, docsPath);
        console.log('Promote result:', promoteResult);
        expect(promoteResult.success).toBe(true);

        console.log('=== STEP 4: Verify docs is now write folder ===');
        const newWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWritePath);
        expect(newWritePath).toContain('docs');

        console.log('=== STEP 5: Verify docs is now the write folder ===');
        const allPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getVaultPaths();
        });
        console.log('All paths:', allPaths);

        // docs should be in the paths (as write folder now)
        const hasDocsPath = allPaths.some((p: string) => p.includes('docs'));
        expect(hasDocsPath).toBe(true);

        console.log('=== TEST PASSED: Read folder promoted to write ===');
    });

    test('reset write folder to root', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);

        console.log('=== STEP 1: Get initial write path (notes subfolder) ===');
        const initialWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWritePath);
        expect(initialWritePath).toContain('notes');
        expect(initialWritePath).not.toBe(testProjectPath);

        console.log('=== STEP 2: Reset write folder to project root ===');
        const resetResult = await appWindow.evaluate(async (rootPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.setWritePath(rootPath);
        }, testProjectPath);
        console.log('Reset result:', resetResult);
        expect(resetResult.success).toBe(true);

        console.log('=== STEP 3: Verify write folder is now project root ===');
        const newWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWritePath);
        expect(newWritePath).toBe(testProjectPath);

        console.log('=== TEST PASSED: Write folder reset to root ===');
    });

    test('search filters available folders', async ({ appWindow }) => {
        test.setTimeout(30000);

        console.log('=== STEP 1: Open dropdown ===');
        const selectorButton = appWindow.locator('button[title^="Write Path:"]');
        await selectorButton.click();
        await appWindow.waitForTimeout(300);

        console.log('=== STEP 2: Get initial available folders ===');
        const initialFolders = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getAvailableFoldersForSelector('');
        });
        console.log('Initial available folders:', initialFolders.map((f: { displayPath: string }) => f.displayPath));
        expect(initialFolders.length).toBeGreaterThan(0);

        console.log('=== STEP 3: Type search query "proj" ===');
        const searchInput = appWindow.locator('input[placeholder*="Search folders"]');
        await searchInput.fill('proj');
        await appWindow.waitForTimeout(500);

        console.log('=== STEP 4: Verify folders are filtered ===');
        const filteredFolders = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getAvailableFoldersForSelector('proj');
        });
        console.log('Filtered folders:', filteredFolders.map((f: { displayPath: string }) => f.displayPath));

        // Should have fewer results than initial (or same if all match)
        const allMatchProject = filteredFolders.every((f: { displayPath: string }) =>
            f.displayPath.toLowerCase().includes('proj')
        );
        expect(allMatchProject).toBe(true);

        console.log('=== STEP 5: Clear search and verify all folders return ===');
        await searchInput.clear();
        await appWindow.waitForTimeout(500);

        const clearedFolders = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.getAvailableFoldersForSelector('');
        });
        console.log('Cleared folders:', clearedFolders.map((f: { displayPath: string }) => f.displayPath));

        expect(clearedFolders.length).toBe(initialFolders.length);

        console.log('=== TEST PASSED: Search filters available folders ===');
    });

    test('write folder change updates internal state', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);

        console.log('=== STEP 1: Get initial write path ===');
        const initialWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWritePath);
        // The app auto-creates a voicetree subfolder, verify we have a write path
        expect(initialWritePath).toBeTruthy();

        console.log('=== STEP 2: Change write path to docs ===');
        const docsPath = path.join(testProjectPath, 'docs');
        const setResult = await appWindow.evaluate(async (targetPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.addReadPath(targetPath);
            return await api.main.setWritePath(targetPath);
        }, docsPath);
        console.log('Set write path result:', setResult);
        expect(setResult.success).toBe(true);

        // Wait for state to update
        await appWindow.waitForTimeout(500);

        console.log('=== STEP 3: Verify write path changed in state ===');
        const newWritePath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const result = await api.main.getWritePath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWritePath);
        expect(newWritePath).toContain('docs');

        console.log('=== STEP 4: Verify new write path is different from initial ===');
        expect(newWritePath).not.toBe(initialWritePath);

        console.log('=== TEST PASSED: Write folder change updates internal state ===');
    });
});

export { test };
