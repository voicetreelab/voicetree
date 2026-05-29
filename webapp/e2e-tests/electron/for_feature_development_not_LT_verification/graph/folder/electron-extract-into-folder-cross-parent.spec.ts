/**
 * BEHAVIORAL SPEC:
 * Cross-parent Extract Into Folder flow via the canvas context menu.
 *
 * Contract:
 * - When 2+ selected nodes live in DIFFERENT parent folders, the menu item reads
 *   "Extract into subfolder at common ancestor: <ancestor>" and clicking it opens a
 *   modal popup (#extract-into-folder-dialog).
 * - Popup shows: selected nodes list with their current parent folder, the closest
 *   common ancestor, an editable folder-name input (default "extracted"), and a
 *   live "Final location" preview.
 * - Confirming creates a new folder at the LCA with the chosen name. Selected
 *   files are moved into the new folder, preserving their relative paths from the LCA.
 *   An `index.md` folder note is created inside the new folder, with no wikilinks and
 *   a body stating how many nodes the folder contains.
 * - Cancelling closes the dialog without moving any files or creating any folder.
 * - When 2+ selected nodes SHARE a parent, the menu item is the plain "Extract Into Folder"
 *   (no "common ancestor" suffix) and clicking it extracts directly without showing the popup.
 *
 * Run command:
 *   cd webapp && npx playwright test --config=playwright-electron-dev.config.ts \
 *     e2e-tests/electron/for_feature_development_not_LT_verification/graph/electron-extract-into-folder-cross-parent.spec.ts
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    type ExtendedWindow,
    waitForGraphLoaded,
} from './folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'e2e-tests/electron/__screenshots__/extract-cross-parent');

async function ensureScreenshotDir(): Promise<void> {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function shot(appWindow: Page, name: string): Promise<string> {
    await ensureScreenshotDir();
    const fullPath: string = path.join(SCREENSHOT_DIR, name);
    await appWindow.screenshot({ path: fullPath });
    return fullPath;
}

async function createCrossParentVault(basePath: string): Promise<string> {
    const projectRoot = path.join(basePath, 'extract-cross-parent-vault');

    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'research'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'projects', 'web'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'projects', 'api'), { recursive: true });

    await fs.writeFile(
        path.join(projectRoot, 'alpha.md'),
        `---\nposition:\n  x: 120\n  y: 120\n---\n# Alpha\nAlpha body.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'docs', 'intro.md'),
        `---\nposition:\n  x: 160\n  y: 280\n---\n# Intro\nDocs intro.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'docs', 'architecture.md'),
        `---\nposition:\n  x: 320\n  y: 280\n---\n# Architecture\nDocs architecture.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'research', 'notes.md'),
        `---\nposition:\n  x: 200\n  y: 440\n---\n# Notes\nResearch notes.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'projects', 'web', 'dashboard.md'),
        `---\nposition:\n  x: 100\n  y: 600\n---\n# Dashboard\nWeb dashboard.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'projects', 'api', 'server.md'),
        `---\nposition:\n  x: 300\n  y: 600\n---\n# Server\nAPI server.\n`
    );

    return projectRoot;
}

function readWikilinks(markdown: string): string[] {
    const matches = markdown.matchAll(/\[\[([^\]]+)\]\]/g);
    return Array.from(matches, (match: RegExpMatchArray) => match[1] ?? '');
}

function getExtractMenuItem(appWindow: Page): Locator {
    return appWindow.locator('.ctxmenu li').filter({
        hasText: /Extract.*Folder/i,
    }).first();
}

async function selectGraphNodes(appWindow: Page, nodeIds: readonly string[]): Promise<void> {
    await appWindow.evaluate((ids: readonly string[]) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not available');

        cy.nodes().unselect();

        for (const id of ids) {
            const node = cy.getElementById(id);
            if (!node.length) {
                throw new Error(`Missing graph node: ${id}`);
            }
            node.select();
        }
    }, nodeIds);

    await expect.poll(async () => {
        return appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return 0;
            return cy.$(':selected').nodes().length;
        });
    }, {
        message: `Waiting for ${nodeIds.length} selected nodes`,
        timeout: 5000,
        intervals: [100, 200, 500],
    }).toBe(nodeIds.length);
}

async function openCanvasContextMenu(appWindow: Page): Promise<void> {
    await appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not available');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cy as any).emit('cxttap', {
            target: cy,
            position: { x: 900, y: 900 },
            renderedPosition: { x: 900, y: 900 },
        });
    });

    await expect(appWindow.locator('.ctxmenu')).toBeVisible({ timeout: 5000 });
}

async function closeContextMenu(appWindow: Page): Promise<void> {
    await appWindow.keyboard.press('Escape');
    await expect(appWindow.locator('.ctxmenu')).toBeHidden({ timeout: 2000 }).catch(() => undefined);
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-extract-cross-parent-'));
        const projectRoot = await createCrossParentVault(tempDir);
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-extract-cross-parent-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: projectRoot,
            vaultConfig: {
                [projectRoot]: {
                    writeFolderPath: projectRoot,
                    readPaths: [],
                },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'extract-cross-parent-test',
            path: projectRoot,
            name: 'extract-cross-parent-test-vault',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true,
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
                // Disable the dev-Electron-only `.cdp-port` lookup path that pins
                // remote-debugging-port to 9222 and collides with the live VT app.
                ENABLE_PLAYWRIGHT_DEBUG: '0',
            },
            timeout: 30000,
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
            // Best-effort cleanup only.
        }

        await electronApp.close();
        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp }, use) => {
        const appWindow = await electronApp.firstWindow({ timeout: 20000 });

        appWindow.on('console', msg => {
            const text = msg.text();
            if (
                text.includes('Extract')
                || text.includes('extract')
                || text.includes('Folder')
                || text.includes('folder')
                || text.includes('error')
                || text.includes('Error')
            ) {
                console.log(`BROWSER [${msg.type()}]:`, text);
            }
        });

        appWindow.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await appWindow.waitForLoadState('domcontentloaded');
        await appWindow.waitForSelector('text=Recent Projects', { timeout: 10000 });
        await appWindow.locator('button:has-text("extract-cross-parent-test-vault")').first().click();

        await appWindow.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 }
        );
        await appWindow.waitForTimeout(3000);

        await use(appWindow);
    },
});

test.describe('Extract Into Folder — cross-parent flow', () => {
    test('cross-parent selection: popup shows LCA + nodes, custom folder name moves files preserving relative paths', async ({ appWindow, projectRoot }) => {
        test.setTimeout(120000);
        await waitForGraphLoaded(appWindow, 6);
        await shot(appWindow, '01-graph-loaded.png');

        const introId = path.join(projectRoot, 'docs', 'intro.md');
        const notesId = path.join(projectRoot, 'research', 'notes.md');

        await selectGraphNodes(appWindow, [introId, notesId]);
        await shot(appWindow, '02-nodes-selected.png');

        await openCanvasContextMenu(appWindow);
        await shot(appWindow, '03-context-menu-open.png');

        const extractMenuItem = getExtractMenuItem(appWindow);
        await expect(extractMenuItem).toBeVisible({ timeout: 5000 });
        await expect(extractMenuItem).toHaveText(/Extract into subfolder at common ancestor:/i);
        await expect(extractMenuItem).not.toHaveClass(/disabled/);

        await extractMenuItem.click();

        const dialog = appWindow.locator('#extract-into-folder-dialog');
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await shot(appWindow, '04-popup-open-default.png');

        const selectedList = dialog.locator('[data-testid="extract-selected-nodes-list"]');
        await expect(selectedList).toBeVisible();
        const listItems = selectedList.locator('li');
        await expect(listItems).toHaveCount(2);
        await expect(selectedList).toContainText('Intro');
        await expect(selectedList).toContainText('Notes');
        await expect(selectedList).toContainText(path.join(projectRoot, 'docs') + '/');
        await expect(selectedList).toContainText(path.join(projectRoot, 'research') + '/');

        const expectedAncestor: string = projectRoot + '/';
        const ancestorCode = dialog.locator('[data-testid="extract-common-ancestor"]');
        await expect(ancestorCode).toHaveText(expectedAncestor);

        const folderInput = dialog.locator('[data-testid="extract-folder-name-input"]');
        await expect(folderInput).toBeVisible();
        await expect(folderInput).toHaveValue('extracted');

        const finalLocation = dialog.locator('[data-testid="extract-final-location"]');
        await expect(finalLocation).toHaveText(expectedAncestor + 'extracted/');

        await folderInput.fill('my_collection');
        await expect(finalLocation).toHaveText(expectedAncestor + 'my_collection/');
        await shot(appWindow, '05-popup-custom-name-typed.png');

        const confirmButton = dialog.locator('[data-testid="extract-confirm-button"]');
        await confirmButton.click();
        await expect(dialog).toBeHidden({ timeout: 5000 });

        const newFolderPath: string = path.join(projectRoot, 'my_collection');
        await expect.poll(async () => {
            return fs.access(newFolderPath).then(() => true).catch(() => false);
        }, {
            message: 'Waiting for my_collection/ to appear at vault root',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).toBe(true);

        await expect.poll(async () => {
            return fs.access(path.join(newFolderPath, 'docs', 'intro.md')).then(() => true).catch(() => false);
        }, {
            message: 'Waiting for my_collection/docs/intro.md',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).toBe(true);

        expect(await fs.access(path.join(newFolderPath, 'research', 'notes.md')).then(() => true).catch(() => false)).toBe(true);

        expect(await fs.access(path.join(projectRoot, 'docs', 'intro.md')).then(() => true).catch(() => false)).toBe(false);
        expect(await fs.access(path.join(projectRoot, 'research', 'notes.md')).then(() => true).catch(() => false)).toBe(false);

        const topLevelEntries = await fs.readdir(newFolderPath, { withFileTypes: true });
        const topLevelFileNames = topLevelEntries
            .filter((entry: import('fs').Dirent) => entry.isFile() && entry.name.endsWith('.md'))
            .map((entry: import('fs').Dirent) => entry.name);
        expect(topLevelFileNames).toEqual(['index.md']);

        const indexNoteContent = await fs.readFile(path.join(newFolderPath, 'index.md'), 'utf8');
        expect(readWikilinks(indexNoteContent)).toEqual([]);
        expect(indexNoteContent).toContain('Contains 2 nodes.');

        await shot(appWindow, '06-after-extract.png');
    });

    test('cancellation flow: dialog closes, no folder created, no files moved', async ({ appWindow, projectRoot }) => {
        test.setTimeout(90000);
        await waitForGraphLoaded(appWindow, 6);

        const introId = path.join(projectRoot, 'docs', 'intro.md');
        const notesId = path.join(projectRoot, 'research', 'notes.md');

        const rootBefore = (await fs.readdir(projectRoot, { withFileTypes: true }))
            .map((entry: import('fs').Dirent) => entry.name)
            .sort();

        await selectGraphNodes(appWindow, [introId, notesId]);
        await openCanvasContextMenu(appWindow);

        const extractMenuItem = getExtractMenuItem(appWindow);
        await expect(extractMenuItem).toBeVisible({ timeout: 5000 });
        await extractMenuItem.click();

        const dialog = appWindow.locator('#extract-into-folder-dialog');
        await expect(dialog).toBeVisible({ timeout: 5000 });

        const cancelButton = dialog.locator('[data-testid="extract-cancel-button"]');
        await cancelButton.click();
        await expect(dialog).toBeHidden({ timeout: 5000 });
        await shot(appWindow, '07-popup-cancelled.png');

        await appWindow.waitForTimeout(1500);
        const rootAfter = (await fs.readdir(projectRoot, { withFileTypes: true }))
            .map((entry: import('fs').Dirent) => entry.name)
            .sort();
        expect(rootAfter).toEqual(rootBefore);

        expect(await fs.access(path.join(projectRoot, 'docs', 'intro.md')).then(() => true).catch(() => false)).toBe(true);
        expect(await fs.access(path.join(projectRoot, 'research', 'notes.md')).then(() => true).catch(() => false)).toBe(true);
    });

    test('deeper LCA: two cousins under /projects/ extract into a new subfolder at /projects/', async ({ appWindow, projectRoot }) => {
        test.setTimeout(120000);
        await waitForGraphLoaded(appWindow, 6);

        const dashboardId = path.join(projectRoot, 'projects', 'web', 'dashboard.md');
        const serverId = path.join(projectRoot, 'projects', 'api', 'server.md');

        await selectGraphNodes(appWindow, [dashboardId, serverId]);
        await openCanvasContextMenu(appWindow);

        const extractMenuItem = getExtractMenuItem(appWindow);
        await expect(extractMenuItem).toBeVisible({ timeout: 5000 });

        const projectsAncestor: string = path.join(projectRoot, 'projects') + '/';
        await expect(extractMenuItem).toHaveText(new RegExp(`Extract into subfolder at common ancestor:.*${projectsAncestor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));

        await extractMenuItem.click();

        const dialog = appWindow.locator('#extract-into-folder-dialog');
        await expect(dialog).toBeVisible({ timeout: 5000 });

        const ancestorCode = dialog.locator('[data-testid="extract-common-ancestor"]');
        await expect(ancestorCode).toHaveText(projectsAncestor);

        const folderInput = dialog.locator('[data-testid="extract-folder-name-input"]');
        await folderInput.fill('combined');

        const finalLocation = dialog.locator('[data-testid="extract-final-location"]');
        await expect(finalLocation).toHaveText(projectsAncestor + 'combined/');

        await dialog.locator('[data-testid="extract-confirm-button"]').click();
        await expect(dialog).toBeHidden({ timeout: 5000 });

        const newFolderPath: string = path.join(projectRoot, 'projects', 'combined');
        await expect.poll(async () => {
            return fs.access(path.join(newFolderPath, 'web', 'dashboard.md')).then(() => true).catch(() => false);
        }, {
            message: 'Waiting for projects/combined/web/dashboard.md',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).toBe(true);

        expect(await fs.access(path.join(newFolderPath, 'api', 'server.md')).then(() => true).catch(() => false)).toBe(true);
        expect(await fs.access(path.join(projectRoot, 'projects', 'web', 'dashboard.md')).then(() => true).catch(() => false)).toBe(false);
        expect(await fs.access(path.join(projectRoot, 'projects', 'api', 'server.md')).then(() => true).catch(() => false)).toBe(false);
    });

    test('same-parent regression: menu shows plain "Extract Into Folder", no popup, one-click extract', async ({ appWindow, projectRoot }) => {
        test.setTimeout(120000);
        await waitForGraphLoaded(appWindow, 6);

        const introId = path.join(projectRoot, 'docs', 'intro.md');
        const archId = path.join(projectRoot, 'docs', 'architecture.md');

        await selectGraphNodes(appWindow, [introId, archId]);
        await openCanvasContextMenu(appWindow);

        const extractMenuItem = getExtractMenuItem(appWindow);
        await expect(extractMenuItem).toBeVisible({ timeout: 5000 });

        const menuText: string = (await extractMenuItem.textContent() ?? '').trim();
        expect(menuText).toBe('Extract Into Folder');
        expect(menuText).not.toMatch(/common ancestor/i);

        await extractMenuItem.click();

        const dialog = appWindow.locator('#extract-into-folder-dialog');
        await appWindow.waitForTimeout(800);
        expect(await dialog.count()).toBe(0);

        await expect.poll(async () => {
            const docsEntries = await fs.readdir(path.join(projectRoot, 'docs'), { withFileTypes: true });
            return docsEntries.filter((entry: import('fs').Dirent) => entry.isDirectory()).length;
        }, {
            message: 'Waiting for a new subfolder under docs/ from same-parent extract',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).toBeGreaterThanOrEqual(1);

        const docsEntries = await fs.readdir(path.join(projectRoot, 'docs'), { withFileTypes: true });
        const newSubFolders = docsEntries.filter((entry: import('fs').Dirent) => entry.isDirectory()).map((entry: import('fs').Dirent) => entry.name);
        expect(newSubFolders).toHaveLength(1);
        const newSubFolder: string = newSubFolders[0];

        const movedFiles = await fs.readdir(path.join(projectRoot, 'docs', newSubFolder));
        expect(movedFiles).toEqual(expect.arrayContaining(['intro.md', 'architecture.md']));

        expect(await fs.access(path.join(projectRoot, 'docs', 'intro.md')).then(() => true).catch(() => false)).toBe(false);
        expect(await fs.access(path.join(projectRoot, 'docs', 'architecture.md')).then(() => true).catch(() => false)).toBe(false);

        await closeContextMenu(appWindow);
    });
});
