/**
 * Unified folder-visibility E2E scenarios.
 *
 * These tests exercise the shipped FolderTree right-click menu ("Expand",
 * "Collapse", "Hide") and assert the observable graph projection.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    type ExtendedWindow,
    waitForGraphLoaded,
} from './graph/folder-test-helpers';
import {
    captureStateScreenshot,
    clickVisibleElementCenter,
    cssString,
    getStableElectronRenderingFlags,
    openFolderTreeSidebar,
} from './folder-spec-e2e-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

type FolderVisibilityMenuAction = 'Expand' | 'Collapse' | 'Hide';

interface VisibilityFixture {
    readonly rootNoteId: string;
    readonly draftsPath: string;
    readonly draftsFolderId: string;
    readonly draftsTodoId: string;
    readonly workspacePath: string;
    readonly workspaceFolderId: string;
    readonly featurePath: string;
    readonly featureFolderId: string;
    readonly featureLeafId: string;
    readonly secretPath: string;
    readonly secretFolderId: string;
    readonly secretNewLinkId: string;
    readonly publicPath: string;
    readonly publicFolderId: string;
    readonly publicTargetId: string;
    readonly publicMarkerId: string;
}

interface GraphNodeSnapshot {
    readonly id: string;
    readonly present: boolean;
    readonly isFolderNode?: boolean;
    readonly collapsed?: boolean;
    readonly childCount?: number;
    readonly parent?: string;
}

interface HiddenFolderLeakSnapshot {
    readonly publicMarkerVisible: boolean;
    readonly hiddenFolderVisible: boolean;
    readonly hiddenFileVisible: boolean;
    readonly syntheticEdgesTouchingHiddenFolder: number;
    readonly edgesFromHiddenFile: number;
}

function folderId(folderPath: string): string {
    return `${folderPath}/`;
}

function buildFixture(vaultPath: string): VisibilityFixture {
    const draftsPath = path.join(vaultPath, 'drafts');
    const workspacePath = path.join(vaultPath, 'workspace');
    const featurePath = path.join(workspacePath, 'feature');
    const secretPath = path.join(vaultPath, 'secret');
    const publicPath = path.join(vaultPath, 'public');

    return {
        rootNoteId: path.join(vaultPath, 'root.md'),
        draftsPath,
        draftsFolderId: folderId(draftsPath),
        draftsTodoId: path.join(draftsPath, 'todo.md'),
        workspacePath,
        workspaceFolderId: folderId(workspacePath),
        featurePath,
        featureFolderId: folderId(featurePath),
        featureLeafId: path.join(featurePath, 'leaf.md'),
        secretPath,
        secretFolderId: folderId(secretPath),
        secretNewLinkId: path.join(secretPath, 'new-link.md'),
        publicPath,
        publicFolderId: folderId(publicPath),
        publicTargetId: path.join(publicPath, 'target.md'),
        publicMarkerId: path.join(publicPath, 'marker.md'),
    };
}

async function writeMarkdown(filePath: string, body: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, 'utf8');
}

async function writeMarkdownAtomically(filePath: string, body: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, body, 'utf8');
    await fs.rename(tempPath, filePath);
}

async function createVisibilityVault(basePath: string): Promise<string> {
    const vaultPath = path.join(basePath, 'folder-visibility-vault');

    await writeMarkdown(path.join(vaultPath, 'root.md'),
        `---\nposition:\n  x: 60\n  y: 80\n---\n# Root\nVisible root-level note.\n`);

    await writeMarkdown(path.join(vaultPath, 'drafts', 'todo.md'),
        `---\nposition:\n  x: 180\n  y: 80\n---\n# Draft Todo\nUnmapped folder content.\n`);

    await writeMarkdown(path.join(vaultPath, 'workspace', 'feature', 'leaf.md'),
        `---\nposition:\n  x: 320\n  y: 120\n---\n# Feature Leaf\nChild content that should survive ancestor visibility changes.\n`);

    await writeMarkdown(path.join(vaultPath, 'secret', 'existing.md'),
        `---\nposition:\n  x: 460\n  y: 120\n---\n# Secret Existing\nExisting hidden-folder content.\n`);

    await writeMarkdown(path.join(vaultPath, 'public', 'target.md'),
        `---\nposition:\n  x: 620\n  y: 120\n---\n# Public Target\nVisible public endpoint.\n`);

    return vaultPath;
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    vaultPath: string;
}>({
    vaultPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-visibility-'));
        const vaultPath = await createVisibilityVault(tempDir);
        await use(vaultPath);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ vaultPath }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-visibility-ud-'));

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
            id: 'folder-visibility-test',
            path: vaultPath,
            name: 'folder-visibility-test-vault',
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

    appWindow: async ({ electronApp, vaultPath }, use) => {
        const window = await electronApp.firstWindow({ timeout: 20000 });

        window.on('console', msg => {
            const text = msg.text();
            if (
                text.includes('folder')
                || text.includes('Folder')
                || text.includes('visibility')
                || text.includes('synthetic')
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
        await clickVisibleElementCenter(window, window.locator('button:has-text("folder-visibility-test-vault")').first());

        const hasCytoscape = await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 10000 }
        ).then(() => true).catch(() => false);
        if (!hasCytoscape) {
            const watchResult = await window.evaluate(async (folderPath: string) => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return api.main.startFileWatching(folderPath);
            }, vaultPath);
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

function sidebarFolderRow(appWindow: Page, absolutePath: string) {
    return appWindow.locator(`.folder-tree-folder[title="${cssString(absolutePath)}"]`).first();
}

async function ensureSidebarPathVisible(appWindow: Page, vaultPath: string, absolutePath: string): Promise<void> {
    await openFolderTreeSidebar(appWindow);

    const relativePath = path.relative(vaultPath, absolutePath);
    if (!relativePath || relativePath.startsWith('..')) {
        await expect(sidebarFolderRow(appWindow, absolutePath)).toBeVisible({ timeout: 5000 });
        return;
    }

    let currentPath = vaultPath;
    const segments = relativePath.split(path.sep).filter(Boolean);
    for (const segment of segments) {
        const targetPath = path.join(currentPath, segment);
        const targetRow = sidebarFolderRow(appWindow, targetPath);
        if (!await targetRow.isVisible().catch(() => false)) {
            const currentRow = sidebarFolderRow(appWindow, currentPath);
            await clickVisibleElementCenter(appWindow, currentRow.locator('.folder-tree-expand-icon'));
            await expect(targetRow).toBeVisible({ timeout: 5000 });
        }
        currentPath = targetPath;
    }
}

async function setFolderVisibilityWithContextMenu(
    appWindow: Page,
    vaultPath: string,
    absolutePath: string,
    action: FolderVisibilityMenuAction,
): Promise<void> {
    await ensureSidebarPathVisible(appWindow, vaultPath, absolutePath);
    const row = sidebarFolderRow(appWindow, absolutePath);
    await expect(row).toBeVisible({ timeout: 5000 });

    const box = await row.boundingBox();
    if (!box) throw new Error(`Expected folder row ${absolutePath} to have a bounding box`);
    await appWindow.mouse.click(box.x + Math.min(24, box.width / 2), box.y + box.height / 2, { button: 'right' });

    const item = appWindow.locator(`.ctxmenu li:has-text("${action}")`).first();
    await clickVisibleElementCenter(appWindow, item);
}

async function getNodeSnapshot(appWindow: Page, id: string): Promise<GraphNodeSnapshot> {
    return appWindow.evaluate((nodeId: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const node = cy.nodes().filter((candidate: import('cytoscape').NodeSingular) =>
            candidate.id() === nodeId && !candidate.data('isShadowNode')
        ).first() as import('cytoscape').NodeSingular;

        if (!node.length) {
            return { id: nodeId, present: false };
        }

        const parent = node.parent();
        return {
            id: node.id(),
            present: true,
            isFolderNode: node.data('isFolderNode') === true,
            collapsed: (node.data('collapsed') as boolean | undefined) ?? false,
            childCount: node.data('childCount') as number | undefined,
            ...(parent.length > 0 ? { parent: parent.id() } : {}),
        };
    }, id);
}

async function expectNodeToUseCanonicalRootParent(appWindow: Page, id: string): Promise<void> {
    const parentData = await appWindow.evaluate((nodeId: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const node = cy.nodes().filter((candidate: import('cytoscape').NodeSingular) =>
            candidate.id() === nodeId && !candidate.data('isShadowNode')
        ).first() as import('cytoscape').NodeSingular;

        if (!node.length) throw new Error(`Expected node ${nodeId} to be present`);

        return (node.data('parent') as string | undefined) ?? null;
    }, id);

    expect(parentData).toBeNull();
    expect(await getNodeSnapshot(appWindow, id)).not.toHaveProperty('parent');
}

async function getHiddenFolderLeakSnapshot(
    appWindow: Page,
    fixture: VisibilityFixture,
): Promise<HiddenFolderLeakSnapshot> {
    return appWindow.evaluate((ids: {
        secretFolderId: string;
        secretNewLinkId: string;
        publicMarkerId: string;
    }) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const visibleNodeIds = new Set(cy.nodes().filter((node: import('cytoscape').NodeSingular) =>
            !node.data('isShadowNode')
        ).map((node: import('cytoscape').NodeSingular) => node.id()));

        const syntheticEdgesTouchingHiddenFolder = cy.edges('[?isSyntheticEdge]').filter((edge: import('cytoscape').EdgeSingular) =>
            edge.source().id() === ids.secretFolderId || edge.target().id() === ids.secretFolderId
        ).length;

        const edgesFromHiddenFile = cy.edges().filter((edge: import('cytoscape').EdgeSingular) =>
            edge.source().id() === ids.secretNewLinkId || edge.target().id() === ids.secretNewLinkId
        ).length;

        return {
            publicMarkerVisible: visibleNodeIds.has(ids.publicMarkerId),
            hiddenFolderVisible: visibleNodeIds.has(ids.secretFolderId),
            hiddenFileVisible: visibleNodeIds.has(ids.secretNewLinkId),
            syntheticEdgesTouchingHiddenFolder,
            edgesFromHiddenFile,
        };
    }, {
        secretFolderId: fixture.secretFolderId,
        secretNewLinkId: fixture.secretNewLinkId,
        publicMarkerId: fixture.publicMarkerId,
    });
}

test.describe('Folder Visibility - Unified Tri-State UX', () => {
    test('default state for an unmapped folder is hidden until expanded from the context menu', async ({ appWindow, vaultPath }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(vaultPath);

        await waitForGraphLoaded(appWindow, 1);
        await openFolderTreeSidebar(appWindow);
        await captureStateScreenshot(appWindow, 'visibility-default-before-expand.png');

        expect(await getNodeSnapshot(appWindow, fixture.draftsFolderId)).toMatchObject({
            present: false,
        });
        expect(await getNodeSnapshot(appWindow, fixture.draftsTodoId)).toMatchObject({
            present: false,
        });

        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.draftsPath, 'Expand');

        await expect.poll(
            () => getNodeSnapshot(appWindow, fixture.draftsFolderId),
            {
                message: 'Waiting for drafts/ to render after real context-menu Expand',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            isFolderNode: true,
            collapsed: false,
        });
        await expect.poll(
            () => getNodeSnapshot(appWindow, fixture.draftsTodoId),
            {
                message: 'Waiting for drafts/todo.md to render after drafts/ expands',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            parent: fixture.draftsFolderId,
        });

        await captureStateScreenshot(appWindow, 'visibility-default-after-expand.png');
    });

    test('implicit roots are derived from expanded leaves rather than stored parent roots', async ({ appWindow, vaultPath }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(vaultPath);

        await waitForGraphLoaded(appWindow, 1);
        await expectNodeToUseCanonicalRootParent(appWindow, fixture.rootNoteId);
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.featurePath, 'Expand');

        await expect.poll(
            () => getNodeSnapshot(appWindow, fixture.featureFolderId),
            {
                message: 'Waiting for feature/ to render as an implicit root after only the leaf folder is expanded',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            isFolderNode: true,
        });
        await expectNodeToUseCanonicalRootParent(appWindow, fixture.featureFolderId);
        expect(await getNodeSnapshot(appWindow, fixture.workspaceFolderId)).toMatchObject({
            present: false,
        });

        await captureStateScreenshot(appWindow, 'visibility-implicit-root-expanded-leaf.png');
    });

    test('hidden ancestor breaks the parent chain while expanded child content stays reachable', async ({ appWindow, vaultPath }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(vaultPath);

        await waitForGraphLoaded(appWindow, 1);
        await expectNodeToUseCanonicalRootParent(appWindow, fixture.rootNoteId);
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.workspacePath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.featurePath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.workspacePath, 'Hide');

        await expect.poll(
            () => getNodeSnapshot(appWindow, fixture.featureFolderId),
            {
                message: 'Waiting for feature/ to remain visible as an implicit root after workspace/ is hidden',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            isFolderNode: true,
        });
        await expectNodeToUseCanonicalRootParent(appWindow, fixture.featureFolderId);
        expect(await getNodeSnapshot(appWindow, fixture.workspaceFolderId)).toMatchObject({
            present: false,
        });
        expect(await getNodeSnapshot(appWindow, fixture.featureLeafId)).toMatchObject({
            present: true,
            parent: fixture.featureFolderId,
        });

        await captureStateScreenshot(appWindow, 'visibility-hidden-ancestor-child-root.png');
    });

    test('F6 synthetic edge aggregation does not fire for a hidden folder', async ({ appWindow, vaultPath }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(vaultPath);

        await waitForGraphLoaded(appWindow, 1);
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.publicPath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.secretPath, 'Hide');

        await writeMarkdownAtomically(fixture.secretNewLinkId,
            `---\nposition:\n  x: 500\n  y: 220\n---\n# Hidden New Link\nCreated under a hidden folder.\n[[public/target]]\n`);
        await writeMarkdownAtomically(fixture.publicMarkerId,
            `---\nposition:\n  x: 700\n  y: 220\n---\n# Public Marker\nVisible marker proving the post-hide filesystem mutation was observed.\n`);

        await expect.poll(
            () => getHiddenFolderLeakSnapshot(appWindow, fixture),
            {
                message: 'Waiting for public marker while hidden folder remains absent with no F6 synthetic edge',
                timeout: 20000,
                intervals: [500, 1000, 2000]
            }
        ).toEqual({
            publicMarkerVisible: true,
            hiddenFolderVisible: false,
            hiddenFileVisible: false,
            syntheticEdgesTouchingHiddenFolder: 0,
            edgesFromHiddenFile: 0,
        });

        await captureStateScreenshot(appWindow, 'visibility-hidden-folder-no-f6.png');
    });

    test('collapse cycle preserves expanded child state', async ({ appWindow, vaultPath }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(vaultPath);

        await waitForGraphLoaded(appWindow, 1);
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.workspacePath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.featurePath, 'Expand');

        await expect.poll(
            () => getNodeSnapshot(appWindow, fixture.featureLeafId),
            {
                message: 'Waiting for feature/ leaf before parent collapse',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            parent: fixture.featureFolderId,
        });

        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.workspacePath, 'Collapse');
        await expect.poll(
            () => getNodeSnapshot(appWindow, fixture.workspaceFolderId),
            {
                message: 'Waiting for workspace/ collapsed graph proxy',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            isFolderNode: true,
            collapsed: true,
        });
        expect(await getNodeSnapshot(appWindow, fixture.featureFolderId)).toMatchObject({
            present: false,
        });

        await setFolderVisibilityWithContextMenu(appWindow, vaultPath, fixture.workspacePath, 'Expand');
        await expect.poll(
            () => getNodeSnapshot(appWindow, fixture.featureFolderId),
            {
                message: 'Waiting for feature/ expanded state to survive workspace/ collapse-expand cycle',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            isFolderNode: true,
            collapsed: false,
            parent: fixture.workspaceFolderId,
        });
        expect(await getNodeSnapshot(appWindow, fixture.featureLeafId)).toMatchObject({
            present: true,
            parent: fixture.featureFolderId,
        });

        await captureStateScreenshot(appWindow, 'visibility-collapse-cycle-child-preserved.png');
    });
});
