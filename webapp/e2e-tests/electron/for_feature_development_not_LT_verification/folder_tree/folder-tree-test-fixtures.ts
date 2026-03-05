/**
 * Shared test fixtures and helpers for folder tree sidebar e2e tests.
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

export const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    testProjectPath: string;
    tempUserDataPath: string;
}>({
    testProjectPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-folder-tree-test-'));

        await fs.writeFile(path.join(tempDir, 'root-node.md'), '# Root Node\n\nTest root node.\n');

        const folders = ['notes', 'docs', 'archive'];
        for (const folder of folders) {
            const folderPath = path.join(tempDir, folder);
            await fs.mkdir(folderPath, { recursive: true });
            await fs.writeFile(
                path.join(folderPath, `${folder}-file.md`),
                `# ${folder} File\n\nContent in ${folder}.\n`
            );
        }

        // Nested folder for expand/collapse testing
        const nestedPath = path.join(tempDir, 'notes', 'subnotes');
        await fs.mkdir(nestedPath, { recursive: true });
        await fs.writeFile(path.join(nestedPath, 'nested-file.md'), '# Nested File\n\nDeeply nested content.\n');

        await use(tempDir);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    tempUserDataPath: async ({}, use) => {
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-folder-tree-userdata-'));
        await use(tempUserDataPath);
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    },

    electronApp: [async ({ testProjectPath, tempUserDataPath }, use) => {
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
    }, { timeout: 30000 }],

    appWindow: [async ({ electronApp, testProjectPath }, use) => {
        const window = await electronApp.firstWindow({ timeout: 15000 });

        window.on('console', msg => {
            if (msg.type() === 'error' && !msg.text().includes('Electron Security Warning')) {
                console.log(`[BROWSER ${msg.type()}]:`, msg.text());
            }
        });
        window.on('pageerror', error => console.error('PAGE ERROR:', error.message));

        await window.waitForLoadState('domcontentloaded');

        // Handle project selection screen if shown
        const isProjectSelection = await window.locator('text=Select a project to open').isVisible({ timeout: 3000 }).catch(() => false);
        if (isProjectSelection) {
            await window.waitForFunction(() => !!(window as unknown as ExtendedWindow).electronAPI, { timeout: 5000 });
            await window.evaluate(async (params: { folderPath: string }) => {
                const api = (window as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                await api.main.saveProject({
                    id: crypto.randomUUID(), path: params.folderPath, name: 'test-folder-tree',
                    type: 'folder' as const, lastOpened: Date.now(), voicetreeInitialized: false,
                });
            }, { folderPath: testProjectPath });
            await window.waitForTimeout(500);

            const projectButton = window.locator('button:has-text("test-folder-tree")');
            if (await projectButton.isVisible({ timeout: 3000 }).catch(() => false)) {
                await projectButton.click();
            } else {
                await window.reload();
                await window.waitForLoadState('domcontentloaded');
                await window.waitForTimeout(1000);
                await window.locator('button:has-text("test-folder-tree")').click({ timeout: 5000 });
            }
        }

        await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
        await window.waitForTimeout(1000);
        await use(window);
    }, { timeout: 40000 }]
});

export async function openFolderTreeSidebar(appWindow: Page): Promise<void> {
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
    await expect(appWindow.locator('[data-testid="folder-tree-sidebar"]')).toBeVisible({ timeout: 5000 });
}

export async function waitForTreeContent(appWindow: Page): Promise<void> {
    await expect.poll(async () => {
        return appWindow.locator('.folder-tree-folder').count();
    }, {
        message: 'Waiting for folder tree to populate',
        timeout: 15000,
        intervals: [500, 1000, 2000]
    }).toBeGreaterThan(0);
}

export { expect, type ExtendedWindow };
