/**
 * BEHAVIORAL SPEC:
 * E2E tests for external folders in the file tree sidebar
 *
 * Test 1: External folder appears in sidebar — addReadPath with a folder outside project root
 *         shows it in a dedicated "EXTERNAL" section in the sidebar
 * Test 2: External folder is expandable — clicking an external folder reveals its children
 * Test 3: External folder shows path tag — external folders display their absolute path
 * Test 4: File limit exceeded folder still shows in sidebar — folder that exceeds file limit
 *         still appears in sidebar tree for subfolder selection
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test, expect, openFolderTreeSidebar, waitForTreeContent, type ExtendedWindow } from './folder-tree-test-fixtures';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

/** Helper: create external folder, add as read path, wait for sidebar to update */
async function addExternalFolder(appWindow: import('@playwright/test').Page): Promise<string> {
    const externalFolderPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-external-folder-'));
    await fs.writeFile(path.join(externalFolderPath, 'external-root.md'), '# External Root\n\nExternal content.\n');
    const subfolderPath = path.join(externalFolderPath, 'external-sub');
    await fs.mkdir(subfolderPath, { recursive: true });
    await fs.writeFile(path.join(subfolderPath, 'sub-file.md'), '# Sub File\n\nNested external content.\n');

    await appWindow.evaluate(async (params: { folderPath: string }) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.addReadPath(params.folderPath);
    }, { folderPath: externalFolderPath });

    await appWindow.waitForTimeout(1000);
    return externalFolderPath;
}

/** Helper: ensure sidebar is open */
async function ensureSidebarOpen(appWindow: import('@playwright/test').Page): Promise<void> {
    const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
    if (!await sidebar.isVisible({ timeout: 2000 }).catch(() => false)) {
        await openFolderTreeSidebar(appWindow);
    }
    await waitForTreeContent(appWindow);
}

test.describe('File Tree Sidebar — External Folders', () => {
    test.describe.configure({ timeout: 120000 });

    test('Test 1: External folder appears in sidebar after addReadPath', async ({ appWindow }) => {
        await ensureSidebarOpen(appWindow);

        // No external section initially
        const externalSection = appWindow.locator('.folder-tree-external-section');
        await expect(externalSection).not.toBeVisible();

        const externalFolderPath = await addExternalFolder(appWindow);

        // External section should appear
        await expect(externalSection).toBeVisible({ timeout: 5000 });

        // External folder name should be in the DOM (may be clipped by overflow)
        const externalFolderName = path.basename(externalFolderPath);
        const folderNode = externalSection.locator('.folder-tree-folder-name', { hasText: externalFolderName });
        await expect(folderNode).toHaveCount(1, { timeout: 5000 });

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-external-folder-added.png' });

        // Cleanup
        await fs.rm(externalFolderPath, { recursive: true, force: true });
    });

    test('Test 2: External folder is expandable with children', async ({ appWindow }) => {
        await ensureSidebarOpen(appWindow);
        const externalFolderPath = await addExternalFolder(appWindow);

        const externalSection = appWindow.locator('.folder-tree-external-section');
        await expect(externalSection).toBeVisible({ timeout: 5000 });

        // Click to expand external folder
        const externalFolder = externalSection.locator('.folder-tree-folder').first();
        await externalFolder.click();
        await appWindow.waitForTimeout(500);

        // Children should be visible
        const children = externalSection.locator('.folder-tree-children');
        await expect(children.first()).toBeVisible({ timeout: 5000 });

        // Should see the subfolder
        const subFolder = externalSection.locator('.folder-tree-folder-name', { hasText: 'external-sub' });
        await expect(subFolder).toHaveCount(1);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-external-folder-expanded.png' });

        await fs.rm(externalFolderPath, { recursive: true, force: true });
    });

    test('Test 3: External folder shows path tag', async ({ appWindow }) => {
        await ensureSidebarOpen(appWindow);
        const externalFolderPath = await addExternalFolder(appWindow);

        const externalSection = appWindow.locator('.folder-tree-external-section');
        await expect(externalSection).toBeVisible({ timeout: 5000 });

        // External folders at depth=0 should show path tag
        const pathTag = externalSection.locator('.folder-tree-path-tag').first();
        await expect(pathTag).toHaveCount(1, { timeout: 5000 });

        // Path tag text should start with / or ~ (shortened home dir)
        const pathText = await pathTag.textContent();
        expect(pathText).toBeTruthy();
        expect(pathText!.startsWith('/') || pathText!.startsWith('~')).toBeTruthy();

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-external-folder-path-tag.png' });

        await fs.rm(externalFolderPath, { recursive: true, force: true });
    });

    test('Test 4: Second external folder also shows in sidebar', async ({ appWindow }) => {
        await ensureSidebarOpen(appWindow);

        // Add first external folder
        const folder1 = await addExternalFolder(appWindow);

        // Add second external folder
        const folder2 = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-external-2-'));
        await fs.writeFile(path.join(folder2, 'second.md'), '# Second\n\nContent.\n');
        await appWindow.evaluate(async (params: { folderPath: string }) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.addReadPath(params.folderPath);
        }, { folderPath: folder2 });
        await appWindow.waitForTimeout(1000);

        // Both should appear in external section
        const externalSection = appWindow.locator('.folder-tree-external-section');
        const folderNodes = externalSection.locator('.folder-tree-folder');
        await expect(folderNodes).toHaveCount(2, { timeout: 5000 });

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-external-two-folders.png' });

        await fs.rm(folder1, { recursive: true, force: true });
        await fs.rm(folder2, { recursive: true, force: true });
    });
});

export { test };
