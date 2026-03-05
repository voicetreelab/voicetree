/**
 * BEHAVIORAL SPEC:
 * E2E tests for sidebar layout — terminal + folder tree sidebars sit side-by-side, not overlapping
 *
 * Test 1: Folder tree only — sidebar left edge is at x=0 when terminal sidebar is hidden
 * Test 2: Both sidebars — folder tree sits to the right of terminal sidebar, no overlap
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test, expect, waitForTreeContent } from './folder-tree-test-fixtures';
import type { Page } from '@playwright/test';

async function ensureFolderTreeOpen(appWindow: Page): Promise<void> {
    const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
    const alreadyOpen = await sidebar.isVisible().catch(() => false);
    if (!alreadyOpen) {
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
    await waitForTreeContent(appWindow);
}

test.describe('Sidebar Layout — No Overlap', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test('Test 1: Folder tree only — positioned at left edge', async ({ appWindow }) => {
        console.log('=== STEP 1: Ensure folder tree sidebar is open ===');
        await ensureFolderTreeOpen(appWindow);

        console.log('=== STEP 2: Verify terminal sidebar is NOT visible ===');
        const terminalSidebar = appWindow.locator('.terminal-tree-sidebar');
        await expect(terminalSidebar).not.toBeVisible();

        console.log('=== STEP 3: Get folder tree sidebar bounding box ===');
        const folderSidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
        await expect(folderSidebar).toBeVisible();

        const folderBox = await folderSidebar.boundingBox();
        expect(folderBox).not.toBeNull();
        console.log(`Folder sidebar position: x=${folderBox!.x}, y=${folderBox!.y}, w=${folderBox!.width}, h=${folderBox!.height}`);

        // Folder tree should be at the left edge (x near 0) since terminal sidebar is hidden
        expect(folderBox!.x).toBeLessThan(10);
        expect(folderBox!.width).toBeGreaterThan(100);
        expect(folderBox!.height).toBeGreaterThan(100);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/sidebar-layout-folder-only.png'
        });
        console.log('Test 1 passed: Folder tree at left edge when terminal sidebar hidden');
    });

    test('Test 2: Both sidebars — side by side, no overlap', async ({ appWindow }) => {
        console.log('=== STEP 1: Ensure folder tree sidebar is open ===');
        await ensureFolderTreeOpen(appWindow);

        console.log('=== STEP 2: Force terminal sidebar visible to simulate active terminal ===');
        // The terminal sidebar renders with display:none when terminals.length === 0.
        // Force it visible to test the CSS flex layout without needing the full terminal spawn pipeline.
        await appWindow.evaluate(() => {
            const sidebar = document.querySelector('.terminal-tree-sidebar') as HTMLElement | null;
            if (!sidebar) throw new Error('.terminal-tree-sidebar not found in DOM');
            sidebar.style.display = 'flex';
        });

        const terminalSidebar = appWindow.locator('.terminal-tree-sidebar');
        await expect(terminalSidebar).toBeVisible();

        console.log('=== STEP 3: Get bounding boxes of both sidebars ===');
        const folderSidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
        await expect(folderSidebar).toBeVisible();

        const terminalBox = await terminalSidebar.boundingBox();
        const folderBox = await folderSidebar.boundingBox();
        expect(terminalBox).not.toBeNull();
        expect(folderBox).not.toBeNull();

        console.log(`Terminal sidebar: x=${terminalBox!.x}, w=${terminalBox!.width}`);
        console.log(`Folder sidebar:   x=${folderBox!.x}, w=${folderBox!.width}`);

        // Key assertion: folder tree should start at or after the terminal sidebar's right edge
        const terminalRightEdge = terminalBox!.x + terminalBox!.width;
        console.log(`Terminal right edge: ${terminalRightEdge}, Folder left edge: ${folderBox!.x}`);

        // Folder sidebar left edge must be >= terminal right edge (allow 2px tolerance for borders)
        expect(folderBox!.x).toBeGreaterThanOrEqual(terminalRightEdge - 2);

        // Both should have reasonable dimensions
        expect(terminalBox!.height).toBeGreaterThan(100);
        expect(folderBox!.height).toBeGreaterThan(100);

        await appWindow.screenshot({
            path: 'e2e-tests/test-results/sidebar-layout-both-sidebars.png'
        });
        console.log('Test 2 passed: Both sidebars side by side, no overlap');
    });
});

export { test };
