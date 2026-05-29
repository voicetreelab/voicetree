/**
 * BEHAVIORAL SPEC:
 * E2E test for folder-node behavior in the shipped Electron verification suite.
 *
 * EXPECTED OUTCOME:
 * - The folder tree sidebar can collapse a graph folder via the row-level graph toggle.
 * - Collapsing hides the folder's rendered descendants from the graph while keeping the folder visible.
 * - Collapsing preserves cross-folder topology through synthetic edges instead of leaving hidden child edges visible.
 * - Expanding restores the hidden descendants and removes the synthetic edges.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
    type ExtendedWindow,
    createFolderTestProject,
    waitForGraphLoaded,
} from '@e2e/electron/for_feature_development_not_LT_verification/graph/folder-test-helpers';
import {
    captureStateScreenshot,
    clickVisibleElementCenter,
    ensureSidebarFolderVisible,
    getStableElectronRenderingFlags,
    openFolderTreeSidebar,
} from './folder-spec-e2e-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

interface FolderGraphSnapshot {
    readonly folderId: string;
    readonly collapsed: boolean;
    readonly childCount: number | undefined;
    readonly visibleDirectChildren: readonly string[];
    readonly visibleFolderDescendants: readonly string[];
    readonly visibleRegularDescendants: readonly string[];
    readonly nonSyntheticEdges: number;
    readonly syntheticEdges: number;
}

interface SyntheticEdgeSnapshot {
    readonly source: string;
    readonly target: string;
    readonly edgeCount: number | undefined;
    readonly label: string | undefined;
}

interface FolderSpecFixture {
    readonly authFolderId: string;
    readonly internalFolderId: string;
    readonly beforeCollapseVisibleFolderDescendants: readonly string[];
    readonly beforeCollapseVisibleRegularDescendants: readonly string[];
    readonly afterExpandVisibleFolderDescendants: readonly string[];
    readonly afterExpandVisibleRegularDescendants: readonly string[];
    readonly collapsedSyntheticEdges: readonly SyntheticEdgeSnapshot[];
}

function sortIds(ids: readonly string[]): string[] {
    return [...ids].sort((left: string, right: string) => left.localeCompare(right));
}

function sortSyntheticEdges(edges: readonly SyntheticEdgeSnapshot[]): SyntheticEdgeSnapshot[] {
    return [...edges].sort((left: SyntheticEdgeSnapshot, right: SyntheticEdgeSnapshot) =>
        `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`));
}

function buildFolderSpecFixture(projectRoot: string): FolderSpecFixture {
    const authFolderId = `${path.join(projectRoot, 'auth')}/`;
    const internalFolderId = `${path.join(projectRoot, 'auth', 'internal')}/`;
    const apiGatewayId = path.join(projectRoot, 'api', 'gateway.md');

    return {
        authFolderId,
        internalFolderId,
        beforeCollapseVisibleFolderDescendants: [internalFolderId],
        beforeCollapseVisibleRegularDescendants: sortIds([
            path.join(projectRoot, 'auth', 'internal', 'refresh-token.md'),
            path.join(projectRoot, 'auth', 'jwt-token.md'),
            path.join(projectRoot, 'auth', 'login-flow.md'),
            path.join(projectRoot, 'auth', 'session-manager.md'),
        ]),
        afterExpandVisibleFolderDescendants: [internalFolderId],
        afterExpandVisibleRegularDescendants: sortIds([
            path.join(projectRoot, 'auth', 'internal', 'refresh-token.md'),
            path.join(projectRoot, 'auth', 'jwt-token.md'),
            path.join(projectRoot, 'auth', 'login-flow.md'),
            path.join(projectRoot, 'auth', 'session-manager.md'),
        ]),
        collapsedSyntheticEdges: sortSyntheticEdges([
            {
                source: path.join(projectRoot, 'api', 'router.md'),
                target: authFolderId,
                edgeCount: undefined,
                label: undefined,
            },
            {
                source: authFolderId,
                target: apiGatewayId,
                edgeCount: 2,
                label: undefined,
            },
            {
                source: path.join(projectRoot, 'readme.md'),
                target: authFolderId,
                edgeCount: undefined,
                label: undefined,
            },
        ]),
    };
}

async function createCriticalFolderSpecProject(basePath: string): Promise<string> {
    const projectRoot = await createFolderTestProject(basePath);
    const nestedAuthFolderPath = path.join(projectRoot, 'auth', 'internal');

    await fs.mkdir(nestedAuthFolderPath, { recursive: true });
    await fs.writeFile(path.join(nestedAuthFolderPath, 'refresh-token.md'),
        `---\nposition:\n  x: 400\n  y: 100\n---\n# Refresh Token\nNested auth detail.\n[[api/gateway]]\n`);

    return projectRoot;
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-spec-test-'));
        const projectRoot = await createCriticalFolderSpecProject(tempDir);
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-spec-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: projectRoot,
            projectConfig: {
                [projectRoot]: {
                    writeFolderPath: projectRoot,
                    readPaths: []
                }
            }
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'folder-spec-test',
            path: projectRoot,
            name: 'folder-spec-test-project',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                ...getStableElectronRenderingFlags(),
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

    appWindow: async ({ electronApp, projectRoot }, use) => {
        const window = await electronApp.firstWindow({ timeout: 20000 });

        window.on('console', msg => {
            const text = msg.text();
            if (
                text.includes('folder')
                || text.includes('Folder')
                || text.includes('synthetic')
                || text.includes('collapse')
                || text.includes('error')
                || text.includes('Error')
            ) {
                console.log(`BROWSER [${msg.type()}]:`, text);
            }
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
        await clickVisibleElementCenter(window, window.locator('button:has-text("folder-spec-test-project")').first());

        const hasCytoscape = await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 10000 }
        ).then(() => true).catch(() => false);
        if (!hasCytoscape) {
            const watchResult = await window.evaluate(async (folderPath: string) => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return api.main.startFileWatching(folderPath);
            }, projectRoot);
            expect(watchResult.success, watchResult.error ?? 'startFileWatching failed').toBe(true);
            await window.waitForFunction(
                () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
                { timeout: 30000 }
            );
        }
        await window.waitForTimeout(3000);

        await use(window);
    }
});

async function getFolderGraphSnapshot(appWindow: Page, folderSuffix: string): Promise<FolderGraphSnapshot> {
    return appWindow.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const folder = cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
            n.data('isFolderNode') && n.id().endsWith(suffix)
        ).first() as import('cytoscape').NodeSingular;

        if (!folder.length) throw new Error(`No folder node ending with ${suffix}`);

        const folderId = folder.id();
        const isFolderDescendant = (id: string): boolean =>
            id !== folderId && id.startsWith(folderId);

        const visibleDirectChildren = folder.children().filter((n: import('cytoscape').NodeSingular) =>
            !n.data('isShadowNode')
        ).map((n: import('cytoscape').NodeSingular) => n.id()).sort();

        const visibleFolderDescendants = cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
            n.data('isFolderNode')
            && isFolderDescendant(n.id())
        ).map((n: import('cytoscape').NodeSingular) => n.id()).sort();

        const visibleRegularDescendants = cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
            !n.data('isFolderNode')
            && !n.data('isShadowNode')
            && isFolderDescendant(n.id())
        ).map((n: import('cytoscape').NodeSingular) => n.id()).sort();

        const nonSyntheticEdges = cy.edges().filter((e: import('cytoscape').EdgeSingular) =>
            !e.data('isSyntheticEdge')
            && (isFolderDescendant(e.source().id()) || isFolderDescendant(e.target().id()))
        ).length;

        const syntheticEdges = cy.edges().filter((e: import('cytoscape').EdgeSingular) =>
            e.data('isSyntheticEdge')
            && (e.source().id() === folder.id() || e.target().id() === folder.id())
        ).length;

        return {
            folderId,
            collapsed: (folder.data('collapsed') as boolean) ?? false,
            childCount: folder.data('childCount') as number | undefined,
            visibleDirectChildren,
            visibleFolderDescendants,
            visibleRegularDescendants,
            nonSyntheticEdges,
            syntheticEdges,
        };
    }, folderSuffix);
}

async function getSyntheticEdgesForFolder(appWindow: Page, folderSuffix: string): Promise<SyntheticEdgeSnapshot[]> {
    return appWindow.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const folder = cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
            n.data('isFolderNode') && n.id().endsWith(suffix)
        ).first() as import('cytoscape').NodeSingular;

        if (!folder.length) throw new Error(`No folder node ending with ${suffix}`);

        const folderId = folder.id();
        return cy.edges('[?isSyntheticEdge]').filter((e: import('cytoscape').EdgeSingular) =>
            e.source().id() === folderId || e.target().id() === folderId
        ).map((e: import('cytoscape').EdgeSingular) => ({
            source: e.source().id(),
            target: e.target().id(),
            edgeCount: e.data('edgeCount') as number | undefined,
            label: e.data('label') as string | undefined,
        })).sort((left: SyntheticEdgeSnapshot, right: SyntheticEdgeSnapshot) =>
            `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`));
    }, folderSuffix);
}

test.describe('Folder Nodes - Spec Behavior', () => {
    test('sidebar graph toggle collapses a folder and preserves visible topology with synthetic edges', async ({ appWindow, projectRoot }) => {
        test.setTimeout(60000);
        const fixture = buildFolderSpecFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 3);
        await openFolderTreeSidebar(appWindow);

        const authRow = await ensureSidebarFolderVisible(appWindow, 'auth', projectRoot);
        const authToggle = authRow.locator('.folder-tree-graph-collapse-icon');
        await expect(authToggle).toHaveClass(/expanded/);

        const before = await getFolderGraphSnapshot(appWindow, 'auth/');
        expect(before.folderId).toBe(fixture.authFolderId);
        expect(before.collapsed).toBe(false);
        expect(before.visibleFolderDescendants).toEqual(fixture.beforeCollapseVisibleFolderDescendants);
        expect(before.visibleRegularDescendants).toEqual(fixture.beforeCollapseVisibleRegularDescendants);
        expect(before.syntheticEdges).toBe(0);
        expect(before.nonSyntheticEdges).toBeGreaterThan(0);
        await captureStateScreenshot(appWindow, 'before-collapse.png');

        await clickVisibleElementCenter(appWindow, authToggle);

        await expect.poll(
            () => getFolderGraphSnapshot(appWindow, 'auth/'),
            {
                message: 'Waiting for auth/ folder to collapse via sidebar graph toggle',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            collapsed: true,
            visibleDirectChildren: [],
            visibleFolderDescendants: [],
            visibleRegularDescendants: [],
            nonSyntheticEdges: 0,
        });

        await expect(authToggle).toHaveClass(/collapsed/);

        const afterCollapse = await getFolderGraphSnapshot(appWindow, 'auth/');
        expect(afterCollapse.childCount).toBe(4);
        expect(afterCollapse.syntheticEdges).toBe(fixture.collapsedSyntheticEdges.length);
        expect(await getSyntheticEdgesForFolder(appWindow, 'auth/')).toEqual(fixture.collapsedSyntheticEdges);
        await captureStateScreenshot(appWindow, 'after-collapse.png');
    });

    test('sidebar graph toggle expands a collapsed folder and restores descendants', async ({ appWindow, projectRoot }) => {
        test.setTimeout(60000);
        const fixture = buildFolderSpecFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 3);
        await openFolderTreeSidebar(appWindow);

        const authRow = await ensureSidebarFolderVisible(appWindow, 'auth', projectRoot);
        const authToggle = authRow.locator('.folder-tree-graph-collapse-icon');

        const before = await getFolderGraphSnapshot(appWindow, 'auth/');
        expect(before.visibleFolderDescendants).toEqual(fixture.beforeCollapseVisibleFolderDescendants);
        expect(before.visibleRegularDescendants).toEqual(fixture.beforeCollapseVisibleRegularDescendants);
        expect(before.syntheticEdges).toBe(0);

        await clickVisibleElementCenter(appWindow, authToggle);
        await expect(authToggle).toHaveClass(/collapsed/);

        await expect.poll(
            () => getFolderGraphSnapshot(appWindow, 'auth/').then((snapshot: FolderGraphSnapshot) => snapshot.syntheticEdges),
            {
                message: 'Waiting for auth/ collapse to synthesize edges',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toBeGreaterThan(0);
        await captureStateScreenshot(appWindow, 'before-expand-collapsed.png');

        await clickVisibleElementCenter(appWindow, authToggle);

        await expect.poll(
            () => getFolderGraphSnapshot(appWindow, 'auth/'),
            {
                message: 'Waiting for auth/ folder to expand via sidebar graph toggle',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            collapsed: false,
            syntheticEdges: 0,
        });

        await expect(authToggle).toHaveClass(/expanded/);

        const afterExpand = await getFolderGraphSnapshot(appWindow, 'auth/');
        expect(afterExpand.visibleFolderDescendants).toEqual(fixture.afterExpandVisibleFolderDescendants);
        expect(afterExpand.visibleRegularDescendants).toEqual(fixture.afterExpandVisibleRegularDescendants);
        expect(afterExpand.nonSyntheticEdges).toBeGreaterThan(0);
        await captureStateScreenshot(appWindow, 'after-expand.png');
    });
});

export { test };
