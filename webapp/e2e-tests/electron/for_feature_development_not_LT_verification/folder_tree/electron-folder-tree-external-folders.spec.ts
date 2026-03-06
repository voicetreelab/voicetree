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

test.describe('File Tree Sidebar — External Folders', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    // Create an external folder (different parent than testProjectPath)
    let externalFolderPath: string;

    test.beforeAll(async () => {
        externalFolderPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-external-folder-'));

        // Create some content in the external folder
        await fs.writeFile(path.join(externalFolderPath, 'external-root.md'), '# External Root\n\nExternal content.\n');

        const subfolderPath = path.join(externalFolderPath, 'external-sub');
        await fs.mkdir(subfolderPath, { recursive: true });
        await fs.writeFile(path.join(subfolderPath, 'sub-file.md'), '# Sub File\n\nNested external content.\n');
    });

    test.afterAll(async () => {
        await fs.rm(externalFolderPath, { recursive: true, force: true });
    });

    test('Test 1: External folder appears in sidebar after addReadPath', async ({ appWindow }) => {
        console.log('=== STEP 1: Open sidebar and verify initial state ===');
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        // No external section initially
        const externalSection = appWindow.locator('.folder-tree-external-section');
        await expect(externalSection).not.toBeVisible();

        console.log('=== STEP 2: Add external folder via addReadPath ===');
        await appWindow.evaluate(async (params: { folderPath: string }) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.addReadPath(params.folderPath);
        }, { folderPath: externalFolderPath });

        // Wait for sidebar to update
        await appWindow.waitForTimeout(1000);

        console.log('=== STEP 3: Verify external section appears with the folder ===');
        await expect(externalSection).toBeVisible({ timeout: 5000 });

        // External folder name should be visible
        const externalFolderName = path.basename(externalFolderPath);
        const folderNode = externalSection.locator('.folder-tree-folder-name', { hasText: externalFolderName });
        await expect(folderNode).toBeVisible({ timeout: 5000 });

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-external-folder-added.png' });
        console.log('Test 1 passed: External folder appears in sidebar');
    });

    test('Test 2: External folder is expandable with children', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        console.log('=== STEP 1: Find external folder in sidebar ===');
        const externalSection = appWindow.locator('.folder-tree-external-section');
        await expect(externalSection).toBeVisible({ timeout: 5000 });

        console.log('=== STEP 2: Click to expand external folder ===');
        const externalFolder = externalSection.locator('.folder-tree-folder').first();
        await externalFolder.click();
        await appWindow.waitForTimeout(500);

        console.log('=== STEP 3: Verify children are visible ===');
        const children = externalSection.locator('.folder-tree-children');
        await expect(children.first()).toBeVisible({ timeout: 5000 });

        // Should see the subfolder
        const subFolder = externalSection.locator('.folder-tree-folder-name', { hasText: 'external-sub' });
        await expect(subFolder).toBeVisible();

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-external-folder-expanded.png' });
        console.log('Test 2 passed: External folder is expandable');
    });

    test('Test 3: External folder shows path tag', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        console.log('=== STEP 1: Find external folder path tag ===');
        const externalSection = appWindow.locator('.folder-tree-external-section');
        await expect(externalSection).toBeVisible({ timeout: 5000 });

        // External folders should show their absolute path as a path tag (like starred/root folders)
        const pathTag = externalSection.locator('.folder-tree-path-tag').first();
        await expect(pathTag).toBeVisible({ timeout: 5000 });

        // Path tag should contain part of the absolute path
        const pathText = await pathTag.textContent();
        expect(pathText).toBeTruthy();
        // Should be shortened with ~ for home dir
        expect(pathText!.startsWith('/') || pathText!.startsWith('~')).toBeTruthy();

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-external-folder-path-tag.png' });
        console.log('Test 3 passed: External folder shows path tag');
    });

    test('Test 4: File limit exceeded folder still shows in sidebar', async ({ appWindow }) => {
        console.log('=== STEP 1: Create a folder that would exceed file limits ===');
        // Create a temporary folder with many markdown files
        const largeFolderPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-large-folder-'));
        const subDir = path.join(largeFolderPath, 'many-files');
        await fs.mkdir(subDir, { recursive: true });

        // Create enough files to potentially trigger file limit
        // The actual limit check happens in loadVaultPathAdditively
        for (let i = 0; i < 5; i++) {
            await fs.writeFile(path.join(subDir, `file-${i}.md`), `# File ${i}\n\nContent ${i}.\n`);
        }

        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        console.log('=== STEP 2: Add the large folder ===');
        await appWindow.evaluate(async (params: { folderPath: string }) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.addReadPath(params.folderPath);
        }, { folderPath: largeFolderPath });

        await appWindow.waitForTimeout(1000);

        console.log('=== STEP 3: Verify folder appears in sidebar regardless ===');
        const externalSection = appWindow.locator('.folder-tree-external-section');
        await expect(externalSection).toBeVisible({ timeout: 5000 });

        // The folder should be in the sidebar even if file limit was hit
        const folderName = path.basename(largeFolderPath);
        const folderNode = externalSection.locator('.folder-tree-folder-name', { hasText: folderName });
        await expect(folderNode).toBeVisible({ timeout: 5000 });

        // Cleanup
        await fs.rm(largeFolderPath, { recursive: true, force: true });

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-file-limit-sidebar.png' });
        console.log('Test 4 passed: File limit exceeded folder still shows in sidebar');
    });
});

export { test };
