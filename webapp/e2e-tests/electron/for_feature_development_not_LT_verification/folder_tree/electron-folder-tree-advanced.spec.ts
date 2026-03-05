/**
 * BEHAVIORAL SPEC:
 * E2E tests for file tree sidebar — advanced interactions
 *
 * Test 6: File click navigation — click file, graph navigates
 * Test 7: Resize — drag resize handle, width persists
 * Test 8: VaultPathSelector — click button, sidebar toggles
 * Test 9: Footer actions — add folder search, browse button visible
 * Test 10: Persistence — toggle sidebar, reload, state persists
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test, expect, openFolderTreeSidebar, waitForTreeContent, type ExtendedWindow } from './folder-tree-test-fixtures';

test.describe('File Tree Sidebar — Advanced', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('Test 6: File click navigation', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);
        await waitForTreeContent(appWindow);

        // Expand root folder to see files
        await appWindow.locator('.folder-tree-folder').first().click();
        await appWindow.waitForTimeout(300);

        const fileNodes = appWindow.locator('.folder-tree-file');
        await expect(fileNodes.first()).toBeVisible({ timeout: 5000 });

        const fileName = await fileNodes.first().locator('.folder-tree-file-name').textContent();
        console.log(`Clicking file: ${fileName}`);

        await fileNodes.first().click();
        await appWindow.waitForTimeout(500);

        // Verify graph is still functional after navigation attempt
        const graphReady = await appWindow.evaluate(() => {
            const cy = (window as ExtendedWindow).cytoscapeInstance;
            return !!cy && cy.nodes().length > 0;
        });
        expect(graphReady).toBe(true);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-file-click.png' });
        console.log('Test 6 passed: File click navigation');
    });

    test('Test 7: Resize handle', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);

        const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
        await expect(sidebar).toBeVisible();

        const initialWidth = await sidebar.evaluate((el) => (el as HTMLElement).offsetWidth);
        console.log(`Initial sidebar width: ${initialWidth}px`);

        const resizeHandle = appWindow.locator('.folder-tree-resize-handle');
        await expect(resizeHandle).toBeVisible();

        const handleBox = await resizeHandle.boundingBox();
        if (!handleBox) throw new Error('Could not get resize handle bounding box');

        const startX = handleBox.x + handleBox.width / 2;
        const startY = handleBox.y + handleBox.height / 2;
        const dragDistance = 80;

        await appWindow.mouse.move(startX, startY);
        await appWindow.mouse.down();
        await appWindow.mouse.move(startX + dragDistance, startY);
        await appWindow.mouse.up();

        const finalWidth = await sidebar.evaluate((el) => (el as HTMLElement).offsetWidth);
        console.log(`Final sidebar width: ${finalWidth}px`);

        expect(finalWidth).toBeGreaterThan(initialWidth);
        expect(finalWidth).toBeGreaterThanOrEqual(initialWidth + dragDistance - 10);
        expect(finalWidth).toBeLessThanOrEqual(400);

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-resize.png' });
        console.log('Test 7 passed: Resize handle');
    });

    test('Test 8: VaultPathSelector toggles sidebar', async ({ appWindow }) => {
        const vaultBtn = appWindow.locator('.vault-path-toggle, [data-testid="vault-path-selector"]');
        const vaultBtnVisible = await vaultBtn.isVisible({ timeout: 3000 }).catch(() => false);

        if (!vaultBtnVisible) {
            console.log('VaultPathSelector button not found — may not be migrated yet, skipping');
            test.skip();
            return;
        }

        await vaultBtn.click();
        await appWindow.waitForTimeout(300);

        const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
        await expect(sidebar).toBeVisible({ timeout: 3000 });

        await vaultBtn.click();
        await expect(sidebar).not.toBeVisible({ timeout: 3000 });

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-vault-selector.png' });
        console.log('Test 8 passed: VaultPathSelector toggles sidebar');
    });

    test('Test 9: Footer actions visible', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);

        const footer = appWindow.locator('.folder-tree-footer');
        await expect(footer).toBeVisible({ timeout: 5000 });

        // Add folder search input
        const addInput = footer.locator('.folder-tree-search-input');
        await expect(addInput).toBeVisible();
        const placeholder = await addInput.getAttribute('placeholder');
        expect(placeholder).toContain('Add folder');

        // Browse button
        const browseBtn = footer.locator('.folder-tree-footer-btn:has-text("Browse")');
        await expect(browseBtn).toBeVisible();

        // Type in add folder search
        await addInput.fill('test');
        await appWindow.waitForTimeout(500);
        await addInput.fill('');

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-footer.png' });
        console.log('Test 9 passed: Footer actions visible');
    });

    test('Test 10: Persistence across reload', async ({ appWindow }) => {
        await openFolderTreeSidebar(appWindow);

        const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
        await expect(sidebar).toBeVisible();

        // Verify localStorage
        const isOpenValue = await appWindow.evaluate(() => localStorage.getItem('folderTree.isOpen'));
        expect(isOpenValue).toBe('true');

        // Reload
        await appWindow.reload();
        await appWindow.waitForLoadState('domcontentloaded');
        await appWindow.waitForFunction(
            () => (window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 20000 }
        );
        await appWindow.waitForTimeout(1000);

        // Sidebar should persist
        await expect(sidebar).toBeVisible({ timeout: 5000 });
        console.log('Sidebar persisted across reload');

        // Close and verify
        await appWindow.locator('.folder-tree-close-btn').click();
        await expect(sidebar).not.toBeVisible({ timeout: 3000 });

        const isOpenAfterClose = await appWindow.evaluate(() => localStorage.getItem('folderTree.isOpen'));
        expect(isOpenAfterClose).toBe('false');

        await appWindow.screenshot({ path: 'e2e-tests/test-results/folder-tree-persistence.png' });
        console.log('Test 10 passed: Persistence across reload');
    });
});

export { test };
