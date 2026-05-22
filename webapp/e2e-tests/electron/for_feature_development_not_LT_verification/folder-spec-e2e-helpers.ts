import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExtendedWindow } from './graph/folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const SCREENSHOT_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'test-results', 'folder-spec-screenshots', SCREENSHOT_RUN_ID);
const LINUX_RENDERING_FLAGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export function getStableElectronRenderingFlags(): string[] {
    const isHeadlessLinux = process.platform === 'linux' && process.env.HEADLESS_TEST !== '0';
    return process.env.CI || process.env.VT_E2E_HEADLESS_LINUX || isHeadlessLinux
        ? LINUX_RENDERING_FLAGS
        : [];
}

export async function captureStateScreenshot(
    appWindow: Page,
    fileName: string
): Promise<void> {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, fileName);
    const dataUrl = await appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        return cy.png({
            output: 'base64uri',
            bg: '#ffffff',
            full: false,
        });
    });
    await fs.writeFile(screenshotPath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log(`Folder spec screenshot: ${screenshotPath}`);
}

export function cssString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function clickVisibleElementCenter(appWindow: Page, locator: Locator): Promise<void> {
    await expect(locator).toBeVisible({ timeout: 5000 });
    const box = await locator.boundingBox();
    if (!box) {
        throw new Error('Expected visible element to have a bounding box');
    }
    await appWindow.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function openFolderTreeSidebar(appWindow: Page): Promise<void> {
    const sidebar = appWindow.locator('[data-testid="folder-tree-sidebar"]');
    const isVisible = await sidebar.isVisible().catch(() => false);
    if (!isVisible) {
        const folderTreeButton = appWindow.locator('#folder-tree');
        if (await folderTreeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await folderTreeButton.click();
        } else {
            const speedDialToggle = appWindow.locator('.speed-dial-toggle, [data-testid="speed-dial-toggle"]');
            if (await speedDialToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
                await speedDialToggle.click();
                await appWindow.waitForTimeout(300);
            }
            await appWindow.locator('#folder-tree').click({ timeout: 5000 });
        }
    }

    await expect(sidebar).toBeVisible({ timeout: 5000 });
    await expect.poll(
        () => appWindow.locator('.folder-tree-folder').count(),
        {
            message: 'Waiting for folder tree rows to render',
            timeout: 15000,
            intervals: [500, 1000, 2000]
        }
    ).toBeGreaterThan(0);
}

export async function ensureSidebarFolderVisible(appWindow: Page, folderName: string, vaultPath: string): Promise<Locator> {
    const row = appWindow.locator('.folder-tree-folder', {
        has: appWindow.locator('.folder-tree-folder-name', { hasText: folderName })
    }).first();

    if (!await row.isVisible().catch(() => false)) {
        const projectRootRow = appWindow.locator(`.folder-tree-container .folder-tree-folder[title="${cssString(vaultPath)}"]`).first();
        await clickVisibleElementCenter(appWindow, projectRootRow);
        await expect(row).toBeVisible({ timeout: 5000 });
    }

    return row;
}

