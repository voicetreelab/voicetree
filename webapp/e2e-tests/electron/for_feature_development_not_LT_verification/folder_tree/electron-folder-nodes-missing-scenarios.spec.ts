/**
 * Missing OpenSpec folder-node E2E scenarios.
 *
 * These tests intentionally use real Electron UI input for sidebar collapse and
 * assert the observable graph surface: rendered folder rows plus Cytoscape
 * projected nodes/edges.
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
    ensureSidebarFolderVisible,
    getStableElectronRenderingFlags,
    openFolderTreeSidebar,
} from './folder-spec-e2e-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

interface FolderGraphSnapshot {
    readonly folderId: string;
    readonly collapsed: boolean;
    readonly childCount: number | undefined;
    readonly visibleRegularDescendants: readonly string[];
    readonly syntheticEdges: number;
}

interface EdgeSnapshot {
    readonly source: string;
    readonly target: string;
    readonly edgeCount: number | undefined;
    readonly label: string | undefined;
    readonly synthetic: boolean;
}

interface MissingScenarioFixture {
    readonly authFolderId: string;
    readonly apiFolderId: string;
    readonly apiGatewayId: string;
    readonly entryId: string;
    readonly exampleFolderId: string;
    readonly exampleNoteId: string;
}

function sortEdges(edges: readonly EdgeSnapshot[]): EdgeSnapshot[] {
    return [...edges].sort((left: EdgeSnapshot, right: EdgeSnapshot) =>
        `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`));
}

function buildFixture(projectRoot: string): MissingScenarioFixture {
    return {
        authFolderId: `${path.join(projectRoot, 'auth')}/`,
        apiFolderId: `${path.join(projectRoot, 'api')}/`,
        apiGatewayId: path.join(projectRoot, 'api', 'gateway.md'),
        entryId: path.join(projectRoot, 'entry.md'),
        exampleFolderId: `${path.join(projectRoot, 'example')}/`,
        exampleNoteId: path.join(projectRoot, 'example', 'example.md'),
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

async function createMissingScenarioProject(basePath: string): Promise<string> {
    const projectRoot = path.join(basePath, 'folder-missing-scenarios-project');

    await writeMarkdown(path.join(projectRoot, 'auth', 'login-flow.md'),
        `---\nposition:\n  x: 100\n  y: 100\n---\n# Login Flow\nHandles user login.\n[[auth/jwt-token]]\n`);
    await writeMarkdown(path.join(projectRoot, 'auth', 'jwt-token.md'),
        `---\nposition:\n  x: 220\n  y: 100\n---\n# JWT Token\nToken generation.\n[[auth/session-manager]]\n`);
    await writeMarkdown(path.join(projectRoot, 'auth', 'session-manager.md'),
        `---\nposition:\n  x: 340\n  y: 100\n---\n# Session Manager\nManages sessions.\n[[api/gateway]]\n`);
    await writeMarkdown(path.join(projectRoot, 'auth', 'internal', 'refresh-token.md'),
        `---\nposition:\n  x: 460\n  y: 100\n---\n# Refresh Token\nNested auth detail.\n[[api/gateway]]\n`);

    await writeMarkdown(path.join(projectRoot, 'api', 'gateway.md'),
        `---\nposition:\n  x: 160\n  y: 340\n---\n# API Gateway\nMain entry point.\n[[api/router]]\n`);
    await writeMarkdown(path.join(projectRoot, 'api', 'router.md'),
        `---\nposition:\n  x: 300\n  y: 340\n---\n# Router\nRequest routing.\n`);

    await writeMarkdown(path.join(projectRoot, 'entry.md'),
        `---\nposition:\n  x: 620\n  y: 260\n---\n# Entry\nLinks to the folder note identity.\n[[example]]\n`);
    await writeMarkdown(path.join(projectRoot, 'example', 'example.md'),
        `---\nposition:\n  x: 760\n  y: 260\n---\n# Example Folder Note\nThis file is the identity note for example/.\n`);

    return projectRoot;
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-missing-scenarios-'));
        const projectRoot = await createMissingScenarioProject(tempDir);
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-missing-scenarios-ud-'));

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
            id: 'folder-missing-scenarios-test',
            path: projectRoot,
            name: 'folder-missing-scenarios-test-project',
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

        const closeTask = (async (): Promise<void> => {
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
        })();

        const closed = await Promise.race([
            closeTask.then(() => true).catch(() => true),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!closed) {
            electronApp.process().kill('SIGKILL');
            await Promise.race([
                closeTask.catch(() => undefined),
                new Promise<void>(resolve => setTimeout(resolve, 2000)),
            ]);
        }
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
        await clickVisibleElementCenter(window, window.locator('button:has-text("folder-missing-scenarios-test-project")').first());

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

async function collapseSidebarFolder(appWindow: Page, folderName: string, projectRoot: string): Promise<void> {
    const row = await ensureSidebarFolderVisible(appWindow, folderName, projectRoot);
    const toggle = row.locator('.folder-tree-graph-collapse-icon');
    await expect(toggle).toHaveClass(/expanded/);
    await clickVisibleElementCenter(appWindow, toggle);
    await expect(toggle).toHaveClass(/collapsed/, { timeout: 10000 });
}

async function getFolderGraphSnapshot(appWindow: Page, folderSuffix: string): Promise<FolderGraphSnapshot> {
    return appWindow.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const folder = cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
            n.data('isFolderNode') && n.id().endsWith(suffix)
        ).first() as import('cytoscape').NodeSingular;

        if (!folder.length) throw new Error(`No folder node ending with ${suffix}`);

        const folderId = folder.id();
        const visibleRegularDescendants = cy.nodes().filter((n: import('cytoscape').NodeSingular) =>
            !n.data('isFolderNode')
            && !n.data('isShadowNode')
            && n.id() !== folderId
            && n.id().startsWith(folderId)
        ).map((n: import('cytoscape').NodeSingular) => n.id()).sort();

        const syntheticEdges = cy.edges().filter((e: import('cytoscape').EdgeSingular) =>
            e.data('isSyntheticEdge')
            && (e.source().id() === folderId || e.target().id() === folderId)
        ).length;

        return {
            folderId,
            collapsed: (folder.data('collapsed') as boolean) ?? false,
            childCount: folder.data('childCount') as number | undefined,
            visibleRegularDescendants,
            syntheticEdges,
        };
    }, folderSuffix);
}

async function getSyntheticEdgesBetween(appWindow: Page, leftId: string, rightId: string): Promise<EdgeSnapshot[]> {
    return appWindow.evaluate(({ left, right }: { left: string; right: string }) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        return cy.edges('[?isSyntheticEdge]').filter((edge: import('cytoscape').EdgeSingular) => {
            const source = edge.source().id();
            const target = edge.target().id();
            return (source === left && target === right) || (source === right && target === left);
        }).map((edge: import('cytoscape').EdgeSingular) => ({
            source: edge.source().id(),
            target: edge.target().id(),
            edgeCount: edge.data('edgeCount') as number | undefined,
            label: edge.data('label') as string | undefined,
            synthetic: edge.data('isSyntheticEdge') === true,
        }));
    }, { left: leftId, right: rightId });
}

async function getEdges(appWindow: Page, sourceId: string, targetId: string): Promise<EdgeSnapshot[]> {
    return appWindow.evaluate(({ source, target }: { source: string; target: string }) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        return cy.edges().filter((edge: import('cytoscape').EdgeSingular) =>
            edge.source().id() === source && edge.target().id() === target
        ).map((edge: import('cytoscape').EdgeSingular) => ({
            source: edge.source().id(),
            target: edge.target().id(),
            edgeCount: edge.data('edgeCount') as number | undefined,
            label: edge.data('label') as string | undefined,
            synthetic: edge.data('isSyntheticEdge') === true,
        }));
    }, { source: sourceId, target: targetId });
}

async function visibleNodeIds(appWindow: Page): Promise<string[]> {
    return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        return cy.nodes().filter((node: import('cytoscape').NodeSingular) =>
            !node.data('isShadowNode')
        ).map((node: import('cytoscape').NodeSingular) => node.id()).sort();
    });
}

test.describe('Folder Nodes - Missing OpenSpec Scenarios', () => {
    test('collapsed descendants connect to another collapsed folder through one folder-level synthetic edge', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 8);
        await openFolderTreeSidebar(appWindow);
        await captureStateScreenshot(appWindow, 'before-collapse.png');

        await collapseSidebarFolder(appWindow, 'auth', projectRoot);
        await collapseSidebarFolder(appWindow, 'api', projectRoot);

        await expect.poll(
            () => getSyntheticEdgesBetween(appWindow, fixture.authFolderId, fixture.apiFolderId),
            {
                message: 'Waiting for collapsed auth/ and api/ to aggregate descendant links into one folder-level edge',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toEqual([{
            source: fixture.authFolderId,
            target: fixture.apiFolderId,
            edgeCount: 2,
            label: undefined,
            synthetic: true,
        }]);

        const auth = await getFolderGraphSnapshot(appWindow, 'auth/');
        const api = await getFolderGraphSnapshot(appWindow, 'api/');
        expect(auth.collapsed).toBe(true);
        expect(api.collapsed).toBe(true);
        expect(auth.visibleRegularDescendants).toEqual([]);
        expect(api.visibleRegularDescendants).toEqual([]);
        await captureStateScreenshot(appWindow, 'after-both-collapse.png');
    });

    test('delta update under a collapsed folder keeps it collapsed and updates badge plus synthetic topology', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 8);
        await openFolderTreeSidebar(appWindow);
        await collapseSidebarFolder(appWindow, 'auth', projectRoot);

        await expect.poll(
            () => getFolderGraphSnapshot(appWindow, 'auth/'),
            {
                message: 'Waiting for auth/ to be collapsed before mutating the fixture on disk',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toMatchObject({
            collapsed: true,
            childCount: 4,
            visibleRegularDescendants: [],
        });

        await writeMarkdownAtomically(path.join(projectRoot, 'auth', 'new-login.md'),
            `---\nposition:\n  x: 580\n  y: 100\n---\n# New Login\nA new direct auth child created while auth/ is collapsed.\n[[api/gateway]]\n`);

        await expect.poll(
            () => getFolderGraphSnapshot(appWindow, 'auth/'),
            {
                message: 'Waiting for collapsed auth/ badge to include auth/new-login.md',
                timeout: 20000,
                intervals: [500, 1000, 2000]
            }
        ).toMatchObject({
            collapsed: true,
            childCount: 5,
            visibleRegularDescendants: [],
        });

        await expect.poll(
            () => getEdges(appWindow, fixture.authFolderId, fixture.apiGatewayId).then(sortEdges),
            {
                message: 'Waiting for auth/ synthetic edge to include the new cross-boundary file link',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toEqual([{
            source: fixture.authFolderId,
            target: fixture.apiGatewayId,
            edgeCount: 3,
            label: undefined,
            synthetic: true,
        }]);

        await captureStateScreenshot(appWindow, 'after-delta.png');
    });

    test('folder note resolves folder identity when basename wikilink is collapsed', async ({ appWindow, projectRoot }) => {
        test.setTimeout(70000);
        const fixture = buildFixture(projectRoot);

        await waitForGraphLoaded(appWindow, 8);
        await openFolderTreeSidebar(appWindow);

        await expect.poll(
            () => getEdges(appWindow, fixture.entryId, fixture.exampleFolderId).then(sortEdges),
            {
                message: 'Waiting for [[example]] to resolve to the expanded example/ folder identity',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toEqual([{
            source: fixture.entryId,
            target: fixture.exampleFolderId,
            edgeCount: undefined,
            label: undefined,
            synthetic: false,
        }]);
        expect(await visibleNodeIds(appWindow)).not.toContain(fixture.exampleNoteId);
        await captureStateScreenshot(appWindow, 'before-folder-note.png');

        await collapseSidebarFolder(appWindow, 'example', projectRoot);

        await expect.poll(
            () => getEdges(appWindow, fixture.entryId, fixture.exampleFolderId).then(sortEdges),
            {
                message: 'Waiting for [[example]] edge to attach to collapsed example/ folder identity',
                timeout: 10000,
                intervals: [250, 500, 1000]
            }
        ).toEqual([{
            source: fixture.entryId,
            target: fixture.exampleFolderId,
            edgeCount: undefined,
            label: undefined,
            synthetic: true,
        }]);

        const example = await getFolderGraphSnapshot(appWindow, 'example/');
        expect(example.collapsed).toBe(true);
        expect(example.childCount).toBe(1);
        expect(await visibleNodeIds(appWindow)).not.toContain(fixture.exampleNoteId);
        await captureStateScreenshot(appWindow, 'after-folder-note-collapse.png');
    });
});
