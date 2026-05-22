/**
 * E2E Test: Folder Compound Nodes in Electron
 *
 * Verifies that Cytoscape compound parent nodes are created for files
 * sharing a directory prefix (v2.1 inline getFolderParent approach).
 *
 * Tests:
 * 1. Compound parent nodes exist for each folder (auth/, api/, utils/)
 * 2. Child nodes are correctly parented to their folder compound
 * 3. Folder labels are set (folderLabel data field)
 * 4. Root-level files have no parent
 * 5. Deleting files cleans up empty compound nodes
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

/** Find a node ID ending with the given suffix */
function findBySuffix(ids: string[], suffix: string): string | undefined {
    return ids.find(id => id.endsWith(suffix));
}

// ── Fixtures ──────────────────────────────────────────────────────────

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    vaultPath: string;
}>({
    vaultPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-compound-test-'));
        const vaultPath = await createFolderTestVault(tempDir);
        await use(vaultPath);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ vaultPath }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-compound-ud-'));

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
            id: 'compound-test',
            path: vaultPath,
            name: 'compound-test-vault',
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

    appWindow: async ({ electronApp, vaultPath }, use) => {
        const w = await electronApp.firstWindow({ timeout: 20000 });
        w.on('console', msg => {
            const t = msg.text();
            if (t.includes('folder') || t.includes('Folder') || t.includes('Error') || t.includes('error')
                || t.includes('watching') || t.includes('[App]')) {
                console.log(`BROWSER [${msg.type()}]:`, t);
            }
        });
        w.on('pageerror', err => console.error('PAGE ERROR:', err.message));

        await w.waitForLoadState('domcontentloaded');

        await w.evaluate(async (vp: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (api) await api.main.startFileWatching(vp);
        }, vaultPath);

        await w.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 }
        );
        await w.waitForTimeout(3000);
        await use(w);
    }
});

// ── Tests ─────────────────────────────────────────────────────────────

test.describe('Folder Compound Nodes (v2.1)', () => {

    test('compound parent nodes exist for each subfolder', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        const folderNodes = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return [];
            return cy.nodes().filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode')).map(
                (n: import('cytoscape').NodeSingular) => ({
                    id: n.id(),
                    folderLabel: n.data('folderLabel') as string,
                    isParent: n.isParent(),
                    childCount: n.children().length,
                })
            );
        });

        console.log('Folder compound nodes:', JSON.stringify(folderNodes, null, 2));

        // Node IDs are absolute paths — match by suffix
        const folderIds = folderNodes.map(f => f.id);
        expect(findBySuffix(folderIds, '/auth/')).toBeDefined();
        expect(findBySuffix(folderIds, '/api/')).toBeDefined();
        expect(findBySuffix(folderIds, '/utils/')).toBeDefined();

        // Each folder with children should be a Cy parent
        const nonRootFolders = folderNodes.filter(f =>
            f.id.endsWith('/auth/') || f.id.endsWith('/api/') || f.id.endsWith('/utils/')
        );
        for (const folder of nonRootFolders) {
            expect(folder.isParent).toBe(true);
            expect(folder.childCount).toBeGreaterThanOrEqual(2);
        }
    });

    test('child nodes are parented to correct folder compound', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        const parentRelations = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return [];
            const result: { id: string; parent: string | null }[] = [];
            cy.nodes().forEach((n: import('cytoscape').NodeSingular) => {
                if (!n.data('isFolderNode') && !n.data('isShadowNode')) {
                    result.push({
                        id: n.id(),
                        parent: n.data('parent') ?? null,
                    });
                }
            });
            return result;
        });

        console.log('Parent relations:', JSON.stringify(parentRelations, null, 2));

        // Helper: find node by suffix and check its parent ends with expected folder suffix
        function expectParentSuffix(nodeSuffix: string, folderSuffix: string) {
            const node = parentRelations.find(r => r.id.endsWith(nodeSuffix));
            expect(node, `Node ending with ${nodeSuffix} should exist`).toBeDefined();
            expect(node!.parent, `${nodeSuffix} should have a parent`).not.toBeNull();
            expect(node!.parent!.endsWith(folderSuffix)).toBe(true);
        }

        // auth/ children
        expectParentSuffix('auth/login-flow.md', '/auth/');
        expectParentSuffix('auth/jwt-token.md', '/auth/');
        expectParentSuffix('auth/session-manager.md', '/auth/');

        // api/ children
        expectParentSuffix('api/gateway.md', '/api/');
        expectParentSuffix('api/router.md', '/api/');

        // utils/ children
        expectParentSuffix('utils/logger.md', '/utils/');
        expectParentSuffix('utils/config.md', '/utils/');

        // Root-level file — parent may be the vault root folder compound or null
        const readme = parentRelations.find(r => r.id.endsWith('readme.md'));
        expect(readme).toBeDefined();
        // readme.md is at root level — if there's a vault-root compound, it's parented there;
        // otherwise it has no parent. Either way, it should NOT be in auth/api/utils/
        if (readme!.parent) {
            expect(readme!.parent.endsWith('/auth/')).toBe(false);
            expect(readme!.parent.endsWith('/api/')).toBe(false);
            expect(readme!.parent.endsWith('/utils/')).toBe(false);
        }
    });

    test('folder labels display last path segment', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        const labelMap = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return [];
            return cy.nodes().filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode')).map(
                (n: import('cytoscape').NodeSingular) => ({
                    id: n.id(),
                    folderLabel: n.data('folderLabel') as string,
                })
            );
        });

        console.log('Folder labels:', JSON.stringify(labelMap, null, 2));

        const authFolder = labelMap.find(l => l.id.endsWith('/auth/'));
        const apiFolder = labelMap.find(l => l.id.endsWith('/api/'));
        const utilsFolder = labelMap.find(l => l.id.endsWith('/utils/'));

        expect(authFolder).toBeDefined();
        expect(authFolder!.folderLabel).toBe('auth');
        expect(apiFolder).toBeDefined();
        expect(apiFolder!.folderLabel).toBe('api');
        expect(utilsFolder).toBeDefined();
        expect(utilsFolder!.folderLabel).toBe('utils');
    });

    test('folder compound styles are applied (dashed border)', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        const styles = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return null;
            const folderNode = cy.nodes().filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode')).first();
            if (!folderNode.length) return null;
            return {
                id: folderNode.id(),
                shape: folderNode.style('shape') as string,
                borderStyle: folderNode.style('border-style') as string,
                borderWidth: folderNode.style('border-width') as string,
                label: folderNode.style('label') as string,
            };
        });

        console.log('Folder compound styles:', JSON.stringify(styles, null, 2));

        expect(styles).not.toBeNull();
        expect(styles!.shape).toBe('roundrectangle');
        expect(styles!.borderStyle).toBe('dashed');
    });

    test('deleting all files in a folder cleans up empty compound', async ({ appWindow, vaultPath }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Verify a utils/ folder compound exists initially
        const beforeCount = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return 0;
            return cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
                n.data('isFolderNode') && n.id().endsWith('/utils/')
            ).length;
        });
        expect(beforeCount).toBe(1);

        // Delete both files in utils/
        await fs.rm(path.join(vaultPath, 'utils', 'logger.md'));
        await fs.rm(path.join(vaultPath, 'utils', 'config.md'));

        // Wait for file watcher to pick up changes and graph to update
        await appWindow.waitForTimeout(5000);

        // The empty utils/ compound should have been cleaned up
        const afterCount = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return -1;
            return cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
                n.data('isFolderNode') && n.id().endsWith('/utils/')
            ).length;
        });

        console.log(`utils/ compound: before=${beforeCount}, after=${afterCount}`);
        expect(afterCount).toBe(0);
    });

    test('screenshot: folder compounds visible in graph', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Center and zoom to show all compounds
        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (cy) {
                cy.fit(undefined, 50);
            }
        });
        await appWindow.waitForTimeout(500);

        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/folder-compound-nodes.png'
        });
    });
});

export { test };
