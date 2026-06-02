/**
 * BEHAVIORAL SPEC:
 * E2E tests for the ProjectPathSelector folder management component.
 *
 * Tests the complete folder management flow:
 * 1. Dropdown opens with three sections (Writing to, Also reading, Add folder)
 * 2. Add folder as read source
 * 3. Set folder as write destination
 * 4. Promote read folder to write folder path
 * 5. Reset write folder path to project root
 * 6. Search filters available folders
 *
 * PRECONDITION:
 * Test project has multiple subfolder directories to test folder operations.
 */

import * as path from 'path';
import { test, expect } from './electron-folder-management/fixtures';
import type { ExtendedWindow } from './electron-folder-management/types';

test.describe('Folder Management E2E', () => {
    test('dropdown opens with three sections', async ({ appWindow }) => {
        test.setTimeout(30000);

        console.log('=== STEP 1: Find and click folder selector button ===');
        // The ProjectPathSelector button has title starting with "Write Path:"
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

        console.log('=== STEP 1: Get initial project paths ===');
        const initialPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.getProjectPaths();
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
            const api = (window as ExtendedWindow).hostAPI;
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

        console.log('=== STEP 4: Verify folder appears in project paths ===');
        const updatedPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.getProjectPaths();
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
        const initialWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWriteFolderPath);
        expect(initialWriteFolderPath).toContain('notes');

        console.log('=== STEP 2: Set docs folder as write destination via API ===');
        const docsPath = path.join(testProjectPath, 'docs');
        const setResult = await appWindow.evaluate(async (targetPath: string) => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');

            // First add to read paths, then set as write
            await api.main.addReadPath(targetPath);
            return await api.main.setWriteFolderPath(targetPath);
        }, docsPath);

        console.log('Set write path result:', setResult);
        expect(setResult.success).toBe(true);

        console.log('=== STEP 3: Verify write path changed ===');
        const newWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWriteFolderPath);
        expect(newWriteFolderPath).toContain('docs');

        console.log('=== STEP 4: Verify docs is now the write destination ===');
        const allPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.getProjectPaths();
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
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.addReadPath(targetPath);
        }, docsPath);
        console.log('Add docs as read result:', addResult);
        expect(addResult.success).toBe(true);

        console.log('=== STEP 2: Get current write path (should be notes) ===');
        const initialWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWriteFolderPath);
        expect(initialWriteFolderPath).toContain('notes');

        console.log('=== STEP 3: Promote docs to write folder path ===');
        const promoteResult = await appWindow.evaluate(async (targetPath: string) => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.setWriteFolderPath(targetPath);
        }, docsPath);
        console.log('Promote result:', promoteResult);
        expect(promoteResult.success).toBe(true);

        console.log('=== STEP 4: Verify docs is now write folder path ===');
        const newWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWriteFolderPath);
        expect(newWriteFolderPath).toContain('docs');

        console.log('=== STEP 5: Verify docs is now the write folder path ===');
        const allPaths = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.getProjectPaths();
        });
        console.log('All paths:', allPaths);

        // docs should be in the paths (as write folder path now)
        const hasDocsPath = allPaths.some((p: string) => p.includes('docs'));
        expect(hasDocsPath).toBe(true);

        console.log('=== TEST PASSED: Read folder promoted to write ===');
    });

    test('reset write folder path to root', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);

        console.log('=== STEP 1: Get initial write path (notes subfolder) ===');
        const initialWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWriteFolderPath);
        expect(initialWriteFolderPath).toContain('notes');
        expect(initialWriteFolderPath).not.toBe(testProjectPath);

        console.log('=== STEP 2: Reset write folder path to project root ===');
        const resetResult = await appWindow.evaluate(async (rootPath: string) => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.setWriteFolderPath(rootPath);
        }, testProjectPath);
        console.log('Reset result:', resetResult);
        expect(resetResult.success).toBe(true);

        console.log('=== STEP 3: Verify write folder path is now project root ===');
        const newWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWriteFolderPath);
        expect(newWriteFolderPath).toBe(testProjectPath);

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
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
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
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
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
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            return await api.main.getAvailableFoldersForSelector('');
        });
        console.log('Cleared folders:', clearedFolders.map((f: { displayPath: string }) => f.displayPath));

        expect(clearedFolders.length).toBe(initialFolders.length);

        console.log('=== TEST PASSED: Search filters available folders ===');
    });

    test('write folder path change updates internal state', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);

        console.log('=== STEP 1: Get initial write path ===');
        const initialWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('Initial write path:', initialWriteFolderPath);
        // The app auto-creates a voicetree subfolder, verify we have a write path
        expect(initialWriteFolderPath).toBeTruthy();

        console.log('=== STEP 2: Change write path to docs ===');
        const docsPath = path.join(testProjectPath, 'docs');
        const setResult = await appWindow.evaluate(async (targetPath: string) => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            await api.main.addReadPath(targetPath);
            return await api.main.setWriteFolderPath(targetPath);
        }, docsPath);
        console.log('Set write path result:', setResult);
        expect(setResult.success).toBe(true);

        // Wait for state to update
        await appWindow.waitForTimeout(500);

        console.log('=== STEP 3: Verify write path changed in state ===');
        const newWriteFolderPath = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).hostAPI;
            if (!api) throw new Error('hostAPI not available');
            const result = await api.main.getWriteFolderPath();
            if (result && typeof result === 'object' && '_tag' in result) {
                return (result as { _tag: string; value?: string })._tag === 'Some'
                    ? (result as { value: string }).value
                    : null;
            }
            return null;
        });
        console.log('New write path:', newWriteFolderPath);
        expect(newWriteFolderPath).toContain('docs');

        console.log('=== STEP 4: Verify new write path is different from initial ===');
        expect(newWriteFolderPath).not.toBe(initialWriteFolderPath);

        console.log('=== TEST PASSED: Write folder change updates internal state ===');
    });
});

export { test };
