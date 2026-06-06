/**
 * Fixtures + screen-space helpers for the folder-handle UI states spec.
 *
 * Launches the packaged Electron app against a temp folder-test project (with
 * an `auth/` folder note so the hover editor can resolve the folder note) and
 * exposes the live cytoscape instance on `appWindow`.
 */
import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
    type ExtendedWindow,
    createFolderTestProject,
} from '@e2e/electron/for_feature_development_not_LT_verification/graph/folder/folder-test-helpers';

export const PROJECT_ROOT = path.resolve(process.cwd());
export const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'e2e-tests/screenshots');

export interface BBoxScreen {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly w: number;
    readonly h: number;
    readonly hostX: number;
    readonly hostY: number;
}

export async function getFolderBBox(appWindow: Page, folderId: string): Promise<BBoxScreen> {
    return appWindow.evaluate((id: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.getElementById(id);
        if (folder.length === 0) throw new Error(`No folder ${id}`);
        // Body-only bbox so chevron-region math (top-left = chip anchor) is not
        // skewed by the folder label that sits above the compound body.
        const bb = folder.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        const host = (cy.container() as HTMLElement).getBoundingClientRect();
        return {
            x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2, w: bb.w, h: bb.h,
            hostX: host.left, hostY: host.top,
        };
    }, folderId);
}

export async function closeAllFloatingEditors(appWindow: Page): Promise<void> {
    // Click an empty corner; HoverEditor uses click-outside to close.
    await appWindow.mouse.move(8, 8);
    await appWindow.mouse.click(8, 8);
    await appWindow.waitForTimeout(250);
}

export const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-handle-test-'));
        const projectRoot = await createFolderTestProject(tempDir);
        // Folder note so HoverEditor can resolve /<project>/auth/ → /<project>/auth/index.md
        await fs.writeFile(
            path.join(projectRoot, 'auth', 'index.md'),
            `---\nposition:\n  x: 50\n  y: 120\n---\n# Auth Folder Note\n\nThis is the folder note for the auth/ folder.\n`,
        );
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-handle-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: projectRoot,
            projectConfig: {
                [projectRoot]: { writeFolderPath: projectRoot, readPaths: [] },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'folder-handle-test',
            path: projectRoot,
            name: 'folder-handle-test-project',
            type: 'folder',
            lastOpened: Date.now(),
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserData}`,
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
            },
            timeout: 30000,
        });

        await use(electronApp);

        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).hostAPI;
                if (api) await api.main.stopFileWatching();
            });
            await window.waitForTimeout(300);
        } catch {
            // Best-effort cleanup only.
        }

        await electronApp.close();
        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 20000 });

        window.on('console', msg => {
            const text = msg.text();
            if (text.includes('error') || text.includes('Error') || text.includes('folder') || text.includes('FolderHandle') || text.includes('collapseFolder')) {
                console.log(`BROWSER [${msg.type()}]:`, text);
            }
        });
        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
        await window.locator('button:has-text("folder-handle-test-project")').first().click();

        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 },
        );
        await window.waitForTimeout(3000);
        await use(window);
    },
});
