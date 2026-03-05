/**
 * BEHAVIORAL SPEC:
 * E2E tests for file tree sidebar — core interactions
 *
 * Test 1: Toggle sidebar — SpeedDial folder button opens/closes sidebar
 * Test 2: Folder expand/collapse — click folder nodes, children render
 * Test 3: Search filter — type in search box, tree filters
 * Test 4: Load toggle — click load indicator, folder loads
 * Test 5: Write target — pen icon visible on write target folder
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test, expect, openFolderTreeSidebar, waitForTreeContent } from './folder-tree-test-fixtures';

test.describe('File Tree Sidebar — Core', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('Test 1: Toggle sidebar via SpeedDial', async ({ appWindow }) => {
        console.log('=== STEP 1: Verify sidebar is initially hidden ===');
        const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
        await expect(sidebar).not.toBeVisible();

        console.log('=== STEP 2: Open sidebar via SpeedDial folder button ===');
        await openFolderTreeSidebar(appWindow);
        await expect(sidebar).toBeVisible();

        console.log('=== STEP 3: Close sidebar via close button ===');
        await appWindow.locator('.folder-tree-close-btn').click();
        await expect(sidebar).not.toBeVisible({ timeout: 3000 });

        console.log('=== STEP 4: Re-open and close via SpeedDial toggle ===');
        await openFolderTreeSidebar(appWindow);
        await expect(sidebar).toBeVisible();
        await appWindow.locator('#folder-tree').click();
        await expect(sidebar).not.toBeVisible({ timeout: 3000 });

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-toggle.png' });
        console.log('Test 1 passed: Toggle sidebar via SpeedDial');
    });

    test('Test 2: Folder expand/collapse', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        const firstFolder = appWindow.locator('.folder-tree-folder').first();
        await expect(firstFolder).toBeVisible();

        // Expand
        await firstFolder.click();
        await appWindow.waitForTimeout(300);
        const childrenCount = await appWindow.locator('.folder-tree-children').count();
        expect(childrenCount).toBeGreaterThan(0);
        console.log(`Found ${childrenCount} expanded children sections`);

        // Collapse
        await firstFolder.click();
        await appWindow.waitForTimeout(300);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-expand-collapse.png' });
        console.log('Test 2 passed: Folder expand/collapse');
    });

    test('Test 3: Search filter', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        // Expand root to see all folders
        await appWindow.locator('.folder-tree-folder').first().click();
        await appWindow.waitForTimeout(300);
        const initialFolderCount = await appWindow.locator('.folder-tree-folder').count();

        // Search for "notes"
        const searchInput = appWindow.locator('.folder-tree-search .folder-tree-search-input');
        await expect(searchInput).toBeVisible();
        await searchInput.fill('notes');
        await appWindow.waitForTimeout(300);

        const filteredCount = await appWindow.locator('.folder-tree-folder').count();
        expect(filteredCount).toBeLessThanOrEqual(initialFolderCount);
        await expect(appWindow.locator('.folder-tree-folder-name:has-text("notes")').first()).toBeVisible();

        // Clear search
        await searchInput.fill('');
        await appWindow.waitForTimeout(300);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-search.png' });
        console.log('Test 3 passed: Search filter');
    });

    test('Test 4: Load toggle indicator', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        const loadIndicators = appWindow.locator('.folder-tree-load-indicator');
        const indicatorCount = await loadIndicators.count();
        expect(indicatorCount).toBeGreaterThan(0);

        // At least the watched folder should be loaded
        const loadedCount = await appWindow.locator('.folder-tree-load-indicator.loaded').count();
        expect(loadedCount).toBeGreaterThanOrEqual(1);

        // If not-loaded folders exist, click one to load it
        const notLoadedIndicator = appWindow.locator('.folder-tree-load-indicator.not-loaded');
        const notLoadedCount = await notLoadedIndicator.count();
        if (notLoadedCount > 0) {
            await notLoadedIndicator.first().click();
            await appWindow.waitForTimeout(1000);
            const newLoadedCount = await appWindow.locator('.folder-tree-load-indicator.loaded').count();
            expect(newLoadedCount).toBeGreaterThanOrEqual(loadedCount);
        }

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-load-toggle.png' });
        console.log('Test 4 passed: Load toggle indicator');
    });

    test('Test 5: Write target pen icon', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        const writeIcon = appWindow.locator('.folder-tree-write-icon');
        expect(await writeIcon.count()).toBe(1);

        const iconText = await writeIcon.first().textContent();
        expect(iconText).toContain('\u270E');

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-write-target.png' });
        console.log('Test 5 passed: Write target pen icon');
    });
});

export { test };
