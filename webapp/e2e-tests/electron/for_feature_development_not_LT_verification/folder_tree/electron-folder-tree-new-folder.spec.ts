/**
 * BEHAVIORAL SPEC:
 * E2E test demonstrating bug: New Folder from context menu creates folder on disk
 * but does NOT appear in the folder tree UI.
 *
 * Test 1: Right-click context menu "New Folder" — folder created on disk but missing from UI
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test, expect, waitForTreeContent } from './folder-tree-test-fixtures';
import * as fs from 'fs/promises';
import * as path from 'path';

async function ensureFolderTreeSidebarOpen(appWindow: import('@playwright/test').Page): Promise<void> {
    const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
    const isAlreadyOpen = await sidebar.isVisible({ timeout: 2000 }).catch(() => false);
    if (isAlreadyOpen) return;

    // Try opening via SpeedDial
    const folderTreeBtn = appWindow.locator('#folder-tree');
    if (await folderTreeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await folderTreeBtn.click();
    } else {
        const speedDialToggle = appWindow.locator('.speed-dial-toggle, [data-testid="speed-dial-toggle"]');
        if (await speedDialToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
            await speedDialToggle.click();
            await appWindow.waitForTimeout(300);
        }
        await appWindow.locator('#folder-tree').click({ timeout: 5000 });
    }
    await expect(sidebar).toBeVisible({ timeout: 5000 });
}

test.describe('File Tree Sidebar — New Folder Context Menu Bug', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('Test 1: New Folder from context menu does not appear in folder tree', async ({ appWindow }) => {
        const newFolderName = `test-subfolder-${Date.now()}`;

        console.log('=== STEP 1: Ensure folder tree sidebar is open ===');
        await ensureFolderTreeSidebarOpen(appWindow);
        await waitForTreeContent(appWindow);

        console.log('=== STEP 2: Expand root folder to see children ===');
        const firstFolder = appWindow.locator('.folder-tree-folder').first();
        await expect(firstFolder).toBeVisible();
        await firstFolder.click();
        await appWindow.waitForTimeout(500);

        const folderName = await firstFolder.locator('.folder-tree-folder-name').textContent();
        console.log(`Target folder: ${folderName}`);

        console.log('=== STEP 3: Right-click folder to open context menu ===');
        await firstFolder.click({ button: 'right' });
        await appWindow.waitForTimeout(300);

        const contextMenu = appWindow.locator('.ctxmenu');
        await expect(contextMenu).toBeVisible({ timeout: 3000 });

        console.log('=== STEP 4: Click "New Folder" in context menu ===');
        const newFolderMenuItem = appWindow.locator('.ctxmenu li:has-text("New Folder")');
        await expect(newFolderMenuItem).toBeVisible({ timeout: 3000 });
        await newFolderMenuItem.click();
        await appWindow.waitForTimeout(500);

        console.log('=== STEP 5: Type folder name in inline input ===');
        const newFolderInput = appWindow.locator('.folder-tree-new-folder-input');
        await expect(newFolderInput).toBeVisible({ timeout: 3000 });
        await newFolderInput.fill(newFolderName);

        console.log('=== STEP 6: Press Enter to confirm ===');
        await newFolderInput.press('Enter');
        await appWindow.waitForTimeout(1000);

        console.log('=== STEP 7: Verify folder was created on disk ===');
        const targetFolderPath = await firstFolder.getAttribute('title');
        expect(targetFolderPath).toBeTruthy();

        const newFolderPath = path.join(targetFolderPath!, newFolderName);
        let folderExistsOnDisk = false;
        try {
            const stat = await fs.stat(newFolderPath);
            folderExistsOnDisk = stat.isDirectory();
        } catch {
            folderExistsOnDisk = false;
        }

        console.log(`Folder exists on disk at ${newFolderPath}: ${folderExistsOnDisk}`);
        expect(folderExistsOnDisk).toBe(true);

        console.log('=== STEP 8: Check if new folder appears in the folder tree UI (BUG: it should NOT) ===');
        await appWindow.waitForTimeout(2000);

        const newFolderInTree = appWindow.locator(`.folder-tree-folder-name:has-text("${newFolderName}")`);
        const folderVisibleInUI = await newFolderInTree.isVisible({ timeout: 3000 }).catch(() => false);

        console.log(`Folder visible in UI: ${folderVisibleInUI}`);

        // BUG ASSERTION: folder created on disk but UI does NOT refresh to show it.
        // When the bug is fixed, change this to expect(folderVisibleInUI).toBe(true)
        expect(folderVisibleInUI).toBe(false);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-new-folder-bug.png' });
        console.log('Test 1 passed: Demonstrated bug — folder created on disk but NOT visible in folder tree UI');

        // Cleanup
        try {
            await fs.rm(newFolderPath, { recursive: true, force: true });
        } catch {
            console.log('Note: Could not clean up test folder');
        }
    });
});

export { test };
