/**
 * Shared fixture for the file-tree "nested child folder" electron e2e specs.
 *
 * Builds a project whose write folder (`write/`) is the only loaded watch root,
 * plus a sibling `parent/child-a/` folder that is therefore UNLOADED by default
 * (the "new folders unloaded by default" gate). The child still appears in the
 * file-tree sidebar — that is exactly the surface these specs exercise.
 *
 * Consumed by:
 *   - electron-filetree-load-child.spec.ts (load an unloaded child)
 *   - electron-filetree-unloaded-folder-no-graph-collapse.spec.ts (unloaded
 *     folder must not present a graph collapse/expand affordance)
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { clickVisibleElementCenter, cssString, getStableElectronRenderingFlags } from './folder-spec-e2e-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

export interface ExtendedWindow {
    readonly cytoscapeInstance?: CytoscapeCore;
    readonly hostAPI?: {
        readonly main: {
            readonly saveProject: (project: {
                readonly id: string;
                readonly path: string;
                readonly name: string;
                readonly type: 'folder';
                readonly lastOpened: number;
            }) => Promise<void>;
            readonly startFileWatching: (path: string) => Promise<{ success: boolean; error?: string }>;
            readonly stopFileWatching: () => Promise<void>;
        };
    };
}

export interface FiletreeLoadChildFixture {
    readonly tempRoot: string;
    readonly projectPath: string;
    readonly writeFolderPath: string;
    readonly parentPath: string;
    readonly childPath: string;
    readonly notePath: string;
}

async function writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
}

export async function createFiletreeLoadChildFixture(): Promise<FiletreeLoadChildFixture> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-filetree-load-child-'));
    const projectPath = path.join(tempRoot, 'project');
    const writeFolderPath = path.join(projectPath, 'write');
    const parentPath = path.join(projectPath, 'parent');
    const childPath = path.join(parentPath, 'child-a');
    const notePath = path.join(childPath, 'note.md');

    await writeFile(path.join(writeFolderPath, 'root.md'), '# Root\n\nLoaded write-path node.\n');
    await writeFile(notePath, '# Child Note\n\nLoaded through the file tree.\n');

    return { tempRoot, projectPath, writeFolderPath, parentPath, childPath, notePath };
}

export function folderRow(appWindow: Page, folderPath: string) {
    return appWindow.locator(`.folder-tree-folder[title="${cssString(folderPath)}"]`).first();
}

export async function expandFolderIfNeeded(appWindow: Page, folderPath: string, childPath: string): Promise<void> {
    const childRow = folderRow(appWindow, childPath);
    if (await childRow.isVisible().catch(() => false)) return;
    await clickVisibleElementCenter(appWindow, folderRow(appWindow, folderPath));
    await expect(childRow).toBeVisible({ timeout: 5000 });
}

/**
 * Playwright `test` configured with the load-child fixture. Its `appWindow`
 * fixture launches electron, opens the project, and waits until the write-path
 * node has loaded into the projected graph — so specs start from a stable,
 * fully-rendered state.
 */
export const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    fixture: FiletreeLoadChildFixture;
}>({
    fixture: async ({}, use) => {
        const fixture = await createFiletreeLoadChildFixture();
        await use(fixture);
        await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    },

    electronApp: async ({ fixture }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-filetree-load-child-ud-'));
        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: fixture.projectPath,
            projectConfig: {
                [fixture.projectPath]: {
                    writeFolderPath: fixture.writeFolderPath,
                    readPaths: [],
                },
            },
        }, null, 2), 'utf8');
        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'filetree-load-child',
            path: fixture.projectPath,
            name: 'filetree-load-child',
            type: 'folder',
            lastOpened: Date.now(),
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                ...getStableElectronRenderingFlags(),
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
            timeout: 15000,
        });

        await use(electronApp);

        const closeTask = (async (): Promise<void> => {
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
        })();

        const closed = await Promise.race([
            closeTask.then(() => true).catch(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!closed) {
            electronApp.process()?.kill('SIGKILL');
            await Promise.race([
                closeTask.catch(() => undefined),
                new Promise<void>((resolve) => setTimeout(resolve, 2000)),
            ]);
        }
        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp, fixture }, use) => {
        const window = await electronApp.firstWindow({ timeout: 20000 });
        await window.waitForLoadState('domcontentloaded');
        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).hostAPI,
            { timeout: 10000 },
        );

        const isProjectSelection = await window.locator('text=Select a project to open, text=Recent Projects')
            .isVisible({ timeout: 3000 })
            .catch(() => false);
        if (isProjectSelection) {
            await window.evaluate(async (folderPath: string) => {
                const api = (window as unknown as ExtendedWindow).hostAPI;
                if (!api) throw new Error('hostAPI not available');
                await api.main.saveProject({
                    id: 'filetree-load-child',
                    path: folderPath,
                    name: 'filetree-load-child',
                    type: 'folder',
                    lastOpened: Date.now(),
                });
            }, fixture.projectPath);
            await window.waitForTimeout(500);
        }

        const projectButton = window.locator('button:has-text("filetree-load-child")').first();
        try {
            if (await projectButton.isVisible({ timeout: 10000 }).catch(() => false)) {
                await projectButton.click({ timeout: 10000 });
            }
        } catch {
            // The project list can auto-open from persisted state while the card is being clicked.
            // The startFileWatching fallback below handles that state if the graph is not ready yet.
        }

        const hasCytoscape = await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 10000 },
        ).then(() => true).catch(() => false);
        if (!hasCytoscape) {
            const watchResult = await window.evaluate(async (folderPath: string) => {
                const api = (window as unknown as ExtendedWindow).hostAPI;
                if (!api) throw new Error('hostAPI not available');
                return await api.main.startFileWatching(folderPath);
            }, fixture.projectPath);
            expect(watchResult.success, watchResult.error ?? 'startFileWatching failed').toBe(true);
            await window.waitForFunction(
                () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
                { timeout: 30000 },
            );
        }
        await expect.poll(async () => {
            return await window.evaluate((rootPath: string) => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy?.nodes().some((node) => node.id() === rootPath) ?? false;
            }, path.join(fixture.writeFolderPath, 'root.md'));
        }, {
            message: 'Waiting for write-path node to load',
            timeout: 20000,
            intervals: [500, 1000, 2000],
        }).toBe(true);

        await use(window);
    },
});

export { expect };
