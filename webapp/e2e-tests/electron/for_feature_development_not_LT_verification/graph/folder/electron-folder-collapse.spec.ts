/**
 * E2E Test: Folder Node Collapsability
 *
 * Verifies that double-tapping a folder compound node collapses/expands it.
 * Collapse removes children from Cytoscape; expand re-derives from Graph via IPC.
 *
 * Tests:
 * 1. Collapse: children removed from cy, folder.data('collapsed') set, childCount set
 * 2. Expand: children restored with correct parent assignment
 * 3. Expand: edges to/from children are restored
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
    type ExtendedWindow,
    createFolderTestVault,
    waitForGraphLoaded,
} from './folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

// ── Fixtures ──────────────────────────────────────────────────────────

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    vaultPath: string;
}>({
    vaultPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-collapse-test-'));
        const vaultPath = await createFolderTestVault(tempDir);
        await use(vaultPath);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ vaultPath }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-collapse-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: vaultPath,
            vaultConfig: {
                [vaultPath]: {
                    writePath: vaultPath,
                    readPaths: []
                }
            }
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'collapse-test',
            path: vaultPath,
            name: 'collapse-test-vault',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserData}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1'
            },
            timeout: 15000
        });

        await use(electronApp);

        try {
            const w = await electronApp.firstWindow();
            await w.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) await api.main.stopFileWatching();
            });
            await w.waitForTimeout(300);
        } catch { /* cleanup best-effort */ }

        await electronApp.close();
        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp, vaultPath: _vaultPath }, use) => {
        const w = await electronApp.firstWindow({ timeout: 20000 });
        w.on('console', msg => {
            const t = msg.text();
            if (t.includes('folder') || t.includes('Folder') || t.includes('collapse') ||
                t.includes('Error') || t.includes('error') || t.includes('[App]')) {
                console.log(`BROWSER [${msg.type()}]:`, t);
            }
        });
        w.on('pageerror', err => console.error('PAGE ERROR:', err.message));

        await w.waitForLoadState('domcontentloaded');

        // Navigate through project selection screen (required to initialize graph view)
        await w.waitForSelector('text=Recent Projects', { timeout: 10000 });
        const projectButton = w.locator('button:has-text("collapse-test")').first();
        await projectButton.click();

        await w.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 }
        );
        await w.waitForTimeout(3000);
        await use(w);
    }
});

// ── Helpers ────────────────────────────────────────────────────────────

/** Emit a dbltap event on the folder compound node ending with the given suffix */
async function emitDblTapOnFolder(page: Page, folderSuffix: string): Promise<string> {
    return page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first();
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        const id = folder.id();
        folder.emit('dbltap');
        return id;
    }, folderSuffix);
}

interface FolderState {
    collapsed: boolean;
    childCount: number | undefined;
    cyChildrenLength: number;
}

async function getFolderState(page: Page, folderSuffix: string): Promise<FolderState> {
    return page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first() as import('cytoscape').NodeSingular;
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        return {
            collapsed: folder.data('collapsed') as boolean ?? false,
            childCount: folder.data('childCount') as number | undefined,
            cyChildrenLength: (folder as import('cytoscape').NodeSingular).children().length as number,
        };
    }, folderSuffix);
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe('Folder Node Collapsability', () => {

    test('collapse: removes children from cy and sets collapsed data', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Verify auth/ folder exists and has children before collapse
        const before = await getFolderState(appWindow, '/auth/');
        console.log('Before collapse:', before);
        expect(before.collapsed).toBe(false);
        expect(before.cyChildrenLength).toBeGreaterThanOrEqual(2);

        // Trigger collapse via dbltap
        await emitDblTapOnFolder(appWindow, '/auth/');

        // Wait for children to be removed
        await expect.poll(
            () => getFolderState(appWindow, '/auth/').then(s => s.cyChildrenLength),
            { message: 'Waiting for auth/ children to be removed', timeout: 5000 }
        ).toBe(0);

        const after = await getFolderState(appWindow, '/auth/');
        console.log('After collapse:', after);

        expect(after.collapsed).toBe(true);
        expect(after.cyChildrenLength).toBe(0);
        expect(after.childCount).toBeGreaterThanOrEqual(2);
    });

    test('expand: children restored with correct parent assignment', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Collapse auth/
        await emitDblTapOnFolder(appWindow, '/auth/');
        await expect.poll(
            () => getFolderState(appWindow, '/auth/').then(s => s.cyChildrenLength),
            { message: 'Waiting for auth/ to collapse', timeout: 5000 }
        ).toBe(0);

        // Expand via second dbltap
        await emitDblTapOnFolder(appWindow, '/auth/');

        // Wait for children to reappear
        await expect.poll(
            () => getFolderState(appWindow, '/auth/').then(s => s.cyChildrenLength),
            { message: 'Waiting for auth/ children to be restored', timeout: 10000 }
        ).toBeGreaterThanOrEqual(2);

        const afterExpand = await getFolderState(appWindow, '/auth/');
        console.log('After expand:', afterExpand);

        expect(afterExpand.collapsed).toBe(false);
        expect(afterExpand.cyChildrenLength).toBeGreaterThanOrEqual(2);

        // Verify children have correct parent assignment
        const childParents = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return [];
            return cy.nodes()
                .filter((n: import('cytoscape').NodeSingular) =>
                    !n.data('isFolderNode') && !n.data('isShadowNode') &&
                    n.id().includes('/auth/')
                )
                .map((n: import('cytoscape').NodeSingular) => ({
                    id: n.id(),
                    parent: n.data('parent') as string | undefined,
                }));
        });

        console.log('Auth child parents after expand:', childParents);

        for (const child of childParents) {
            expect(child.parent, `${child.id} should have a parent`).toBeDefined();
            expect(child.parent!.endsWith('/auth/')).toBe(true);
        }
    });

    test('expand: edges to/from children are restored', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Snapshot edges involving auth/ nodes before collapse
        const edgesBefore = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return 0;
            return cy.edges()
                .filter((e: import('cytoscape').EdgeSingular) =>
                    e.source().id().includes('/auth/') || e.target().id().includes('/auth/')
                ).length;
        });
        console.log('Edges involving auth/ before collapse:', edgesBefore);
        expect(edgesBefore).toBeGreaterThan(0);

        // Collapse auth/
        await emitDblTapOnFolder(appWindow, '/auth/');
        await expect.poll(
            () => getFolderState(appWindow, '/auth/').then(s => s.cyChildrenLength),
            { message: 'Waiting for auth/ to collapse', timeout: 5000 }
        ).toBe(0);

        // After BF-113: original child edges are removed but synthetic edges are created
        // pointing to the folder node. Count only non-synthetic edges to verify originals are gone.
        const nonSyntheticAfterCollapse = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return -1;
            return cy.edges()
                .filter((e: import('cytoscape').EdgeSingular) =>
                    !e.data('isSyntheticEdge') &&
                    (e.source().id().includes('/auth/') || e.target().id().includes('/auth/'))
                ).length;
        });
        console.log('Non-synthetic edges involving auth/ after collapse:', nonSyntheticAfterCollapse);
        expect(nonSyntheticAfterCollapse).toBe(0);

        // Expand
        await emitDblTapOnFolder(appWindow, '/auth/');
        await expect.poll(
            () => getFolderState(appWindow, '/auth/').then(s => s.cyChildrenLength),
            { message: 'Waiting for auth/ to expand', timeout: 10000 }
        ).toBeGreaterThanOrEqual(2);

        // Edges involving auth/ nodes should be restored
        const edgesAfterExpand = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return 0;
            return cy.edges()
                .filter((e: import('cytoscape').EdgeSingular) =>
                    e.source().id().includes('/auth/') || e.target().id().includes('/auth/')
                ).length;
        });
        console.log('Edges involving auth/ after expand:', edgesAfterExpand);
        expect(edgesAfterExpand).toBeGreaterThan(0);
    });

    test('screenshot: collapsed and expanded folder state', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Fit graph
        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (cy) cy.fit(undefined, 50);
        });
        await appWindow.waitForTimeout(500);
        await appWindow.screenshot({ path: 'e2e-tests/screenshots/folder-collapse-before.png' });

        // Collapse auth/
        await emitDblTapOnFolder(appWindow, '/auth/');
        await expect.poll(
            () => getFolderState(appWindow, '/auth/').then(s => s.cyChildrenLength),
            { message: 'Waiting for auth/ to collapse', timeout: 5000 }
        ).toBe(0);

        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (cy) cy.fit(undefined, 50);
        });
        await appWindow.waitForTimeout(500);
        await appWindow.screenshot({ path: 'e2e-tests/screenshots/folder-collapse-after.png' });
    });

    test('screenshot: radial menu with collapse/expand button on folder node', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Fit graph so folder node is visible and centred
        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (cy) cy.fit(undefined, 50);
        });
        await appWindow.waitForTimeout(500);

        // Get folder node's screen coordinates for mouse hover
        const folderPos = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('No cytoscapeInstance');
            const folder = cy.nodes()
                .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode'))
                .first();
            if (!folder.length) throw new Error('No folder node found');
            const pos = (folder as import('cytoscape').NodeSingular).renderedPosition();
            const container = cy.container()!.getBoundingClientRect();
            return { x: container.left + pos.x, y: container.top + pos.y };
        });

        // Hover over folder node to trigger cxtmenu radial menu
        await appWindow.mouse.move(folderPos.x, folderPos.y);
        await appWindow.waitForTimeout(800); // wait for radial menu to render

        await fs.mkdir('e2e-tests/screenshots', { recursive: true });
        await appWindow.screenshot({ path: 'e2e-tests/screenshots/folder-collapse-radial-menu.png' });
    });
});

export { test };
