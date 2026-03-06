/**
 * BEHAVIORAL SPEC:
 * E2E tests for starred folders sidebar — subtree expansion, hover tooltip, unstar
 *
 * Test 1: Starred folders appear in sidebar — starred section visible with items
 * Test 2: Hover shows absolute path — title attribute contains full path
 * Test 3: Starred folder subtree expands/collapses — expand arrow reveals children
 * Test 4: Unstar removes folder — clicking star icon removes from starred
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, openFolderTreeSidebar, waitForTreeContent } from './folder-tree-test-fixtures';
import { _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { ElectronApplication } from '@playwright/test';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
    cytoscapeInstance?: unknown;
    electronAPI?: { main: { stopFileWatching: () => Promise<void> } };
}

// Extend base test to write starred folder settings before Electron launches
const test = base.extend<{
    electronApp: ElectronApplication;
}>({
    electronApp: [async ({ testProjectPath, tempUserDataPath }, use) => {
        // Write settings with starred folders BEFORE launching Electron
        const notesFolder = path.join(testProjectPath, 'notes');
        const docsFolder = path.join(testProjectPath, 'docs');
        const settings = {
            starredFolders: [notesFolder, docsFolder],
        };
        await fs.writeFile(
            path.join(tempUserDataPath, 'settings.json'),
            JSON.stringify(settings, null, 2),
            'utf8'
        );

        // Write config (same as base fixture)
        const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({ lastDirectory: testProjectPath }, null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js'), `--user-data-dir=${tempUserDataPath}`],
            env: { ...process.env, NODE_ENV: 'test', HEADLESS_TEST: '1', MINIMIZE_TEST: '1', VOICETREE_PERSIST_STATE: '1' },
            timeout: 15000
        });

        await use(electronApp);

        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) await api.main.stopFileWatching();
            });
            await window.waitForTimeout(300);
        } catch {
            console.log('Note: Could not stop file watching during cleanup');
        }
        await electronApp.close();
    }, { scope: 'test', timeout: 30000 }],
});

test.describe('Starred Folders Sidebar', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('Test 1: Starred folders appear in sidebar', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        const starredSection = appWindow.locator('.folder-tree-starred-section');
        await expect(starredSection).toBeVisible({ timeout: 5000 });

        const sectionHeader = starredSection.locator('.folder-tree-section-header');
        await expect(sectionHeader).toBeVisible();
        await expect(sectionHeader).toContainText('STARRED');

        // Both starred folders should be present (as tree items since they exist on disk)
        const starredItems = starredSection.locator('.folder-tree-starred-item-tree, .folder-tree-starred-item');
        await expect(starredItems).toHaveCount(2, { timeout: 10000 });

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-starred-visible.png' });
        console.log('Test 1 passed: Starred folders appear in sidebar');
    });

    test('Test 2: Hover shows absolute path', async ({ appWindow, testProjectPath }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        const starredSection = appWindow.locator('.folder-tree-starred-section');
        await expect(starredSection).toBeVisible({ timeout: 5000 });

        // Check title attribute on starred items contains the absolute path
        const notesItem = starredSection.locator('.folder-tree-starred-item-tree, .folder-tree-starred-item').first();
        await expect(notesItem).toBeVisible();

        const titleAttr = await notesItem.getAttribute('title');
        expect(titleAttr).toBeTruthy();
        expect(titleAttr).toContain(testProjectPath);

        // Hover to trigger tooltip display
        await notesItem.hover();
        await appWindow.waitForTimeout(500);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-starred-hover.png' });
        console.log('Test 2 passed: Hover shows absolute path');
    });

    test('Test 3: Starred folder subtree expands/collapses', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        const starredSection = appWindow.locator('.folder-tree-starred-section');
        await expect(starredSection).toBeVisible({ timeout: 5000 });

        // Find a starred item with tree data
        const starredTreeItem = starredSection.locator('.folder-tree-starred-item-tree').first();
        await expect(starredTreeItem).toBeVisible({ timeout: 5000 });

        // Children should be collapsed by default — no .folder-tree-children visible within starred item
        const childrenBefore = starredTreeItem.locator('.folder-tree-children');
        await expect(childrenBefore).toHaveCount(0);

        // Click the expand icon within the starred item's folder node
        const expandIcon = starredTreeItem.locator('.folder-tree-expand-icon').first();
        await expandIcon.click();
        await appWindow.waitForTimeout(500);

        // Children should now be visible
        const childrenAfter = starredTreeItem.locator('.folder-tree-children');
        await expect(childrenAfter).toHaveCount(1, { timeout: 5000 });

        // Collapse again
        await expandIcon.click();
        await appWindow.waitForTimeout(500);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-starred-expand-collapse.png' });
        console.log('Test 3 passed: Starred folder subtree expands/collapses');
    });

    test('Test 4: Unstar removes folder', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        const starredSection = appWindow.locator('.folder-tree-starred-section');
        await expect(starredSection).toBeVisible({ timeout: 5000 });

        // Count starred items before
        const starredItems = starredSection.locator('.folder-tree-starred-item-tree, .folder-tree-starred-item');
        const countBefore = await starredItems.count();
        expect(countBefore).toBe(2);

        // Click the star icon on the first starred item to unstar it
        const starIcon = starredSection.locator('.folder-tree-starred-star').first();
        await starIcon.click();
        await appWindow.waitForTimeout(1000);

        // Should have one fewer starred item
        const countAfter = await starredItems.count();
        expect(countAfter).toBe(countBefore - 1);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-starred-unstar.png' });
        console.log('Test 4 passed: Unstar removes folder');
    });
});

export { test };
