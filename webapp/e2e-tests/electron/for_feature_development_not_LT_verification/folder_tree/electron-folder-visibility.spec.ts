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
} from '../graph/folder/folder-test-helpers';
import {
    captureStateScreenshot,
    clickVisibleElementCenter,
    getStableElectronRenderingFlags,
    openFolderTreeSidebar,
} from './folder-spec-e2e-helpers';
import {
    buildFixture,
    createVisibilityProject,
    expectNodeToUseCanonicalRootParent,
    getCanonicalRootSnapshot,
    getHiddenFolderLeakSnapshot,
    getNodeSnapshot,
    setFolderVisibilityWithContextMenu,
    writeMarkdownAtomically,
} from './electron-folder-visibility/helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-visibility-'));
        const projectRoot = await createVisibilityProject(tempDir);
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-visibility-ud-'));

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
            id: 'folder-visibility-test',
            path: projectRoot,
            name: 'folder-visibility-test-project',
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
        await clickVisibleElementCenter(window, window.locator('button:has-text("folder-visibility-test-project")').first());

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

test.describe('Folder Visibility - Unified Tri-State UX', () => {
    test('default state for an unmapped folder is hidden until expanded from the context menu', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 1);
        await openFolderTreeSidebar(appWindow);
        await captureStateScreenshot(appWindow, 'visibility-default-before-expand.png');

        expect(await getNodeSnapshot(appWindow, fixture.draftsFolderId)).toMatchObject({
            present: false,
        });
        expect(await getNodeSnapshot(appWindow, fixture.draftsTodoId)).toMatchObject({
            present: false,
        });

        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.draftsPath, 'Expand');

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

    test('implicit roots are derived from expanded leaves rather than stored parent roots', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 1);
        await expectNodeToUseCanonicalRootParent(appWindow, fixture.rootNoteId);
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.featurePath, 'Expand');

        await expect.poll(
            () => getCanonicalRootSnapshot(appWindow, fixture.featureFolderId),
            {
                message: 'Waiting for feature/ to render as an implicit root after only the leaf folder is expanded',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            isFolderNode: true,
            parentData: null,
            hasSnapshotParent: false,
        });
        expect(await getNodeSnapshot(appWindow, fixture.workspaceFolderId)).toMatchObject({
            present: false,
        });

        await captureStateScreenshot(appWindow, 'visibility-implicit-root-expanded-leaf.png');
    });

    test('hidden ancestor breaks the parent chain while expanded child content stays reachable', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 1);
        await expectNodeToUseCanonicalRootParent(appWindow, fixture.rootNoteId);
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.workspacePath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.featurePath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.workspacePath, 'Hide');

        await expect.poll(
            () => getCanonicalRootSnapshot(appWindow, fixture.featureFolderId),
            {
                message: 'Waiting for feature/ to remain visible as an implicit root after workspace/ is hidden',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            present: true,
            isFolderNode: true,
            parentData: null,
            hasSnapshotParent: false,
        });
        expect(await getNodeSnapshot(appWindow, fixture.workspaceFolderId)).toMatchObject({
            present: false,
        });
        expect(await getNodeSnapshot(appWindow, fixture.featureLeafId)).toMatchObject({
            present: true,
            parent: fixture.featureFolderId,
        });

        await captureStateScreenshot(appWindow, 'visibility-hidden-ancestor-child-root.png');
    });

    test('F6 synthetic edge aggregation does not fire for a hidden folder', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 1);
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.publicPath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.secretPath, 'Hide');

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

    test('collapse cycle preserves expanded child state', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 1);
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.workspacePath, 'Expand');
        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.featurePath, 'Expand');

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

        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.workspacePath, 'Collapse');
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

        await setFolderVisibilityWithContextMenu(appWindow, projectRoot, fixture.workspacePath, 'Expand');
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
