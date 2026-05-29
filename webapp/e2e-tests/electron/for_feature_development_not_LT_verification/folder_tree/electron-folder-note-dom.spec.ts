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
    clickVisibleElementCenter,
    getStableElectronRenderingFlags,
} from './folder-spec-e2e-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

interface RectSnapshot {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly cx: number;
    readonly cy: number;
}

interface FolderHandleSnapshot {
    readonly chip: RectSnapshot;
    readonly chevron: RectSnapshot;
    readonly eye: RectSnapshot;
    readonly folderBbox: {
        readonly x1: number;
        readonly y1: number;
        readonly x2: number;
        readonly y2: number;
    };
    readonly chipOffsetFromFolder: {
        readonly dx: number;
        readonly dy: number;
    };
}

interface CodeMirrorElement extends HTMLElement {
    readonly cmView?: {
        readonly view?: {
            readonly state: {
                readonly doc: { toString(): string };
            };
        };
    };
}

async function writeMarkdown(filePath: string, body: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, 'utf8');
}

async function createFolderNoteDomProject(basePath: string): Promise<string> {
    const projectRoot = path.join(basePath, 'folder-note-dom-project');

    await writeMarkdown(path.join(projectRoot, 'auth', 'index.md'),
        `---\nposition:\n  x: 60\n  y: 100\n---\n# Auth Folder Note\n\nUnique folder note content for DOM hover.\n`);
    await writeMarkdown(path.join(projectRoot, 'auth', 'login.md'),
        `---\nposition:\n  x: 220\n  y: 120\n---\n# Login\n\nLinks to its containing folder note.\n[[auth/index]]\n`);
    await writeMarkdown(path.join(projectRoot, 'outside.md'),
        `---\nposition:\n  x: 520\n  y: 220\n---\n# Outside\n\n[[auth]]\n`);

    return projectRoot;
}

function idsForProject(projectRoot: string): {
    readonly authFolderId: string;
    readonly authNoteId: string;
    readonly loginId: string;
} {
    return {
        authFolderId: `${path.join(projectRoot, 'auth')}/`,
        authNoteId: path.join(projectRoot, 'auth', 'index.md'),
        loginId: path.join(projectRoot, 'auth', 'login.md'),
    };
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-note-dom-'));
        const projectRoot = await createFolderNoteDomProject(tempDir);
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-note-dom-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: projectRoot,
            projectConfig: {
                [projectRoot]: {
                    writeFolderPath: projectRoot,
                    readPaths: [],
                },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'folder-note-dom-test',
            path: projectRoot,
            name: 'folder-note-dom-test-project',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true,
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
                MINIMIZE_TEST: '0',
                VOICETREE_PERSIST_STATE: '1',
            },
            timeout: 15000,
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
            if (text.includes('folder') || text.includes('Folder') || text.includes('error') || text.includes('Error')) {
                console.log(`BROWSER [${msg.type()}]:`, text);
            }
        });
        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
        await clickVisibleElementCenter(window, window.locator('button:has-text("folder-note-dom-test-project")').first());

        const hasCytoscape = await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 10000 },
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
                { timeout: 30000 },
            );
        }

        await window.waitForTimeout(3000);
        await use(window);
    },
});

async function getVisibleGraphSnapshot(appWindow: Page): Promise<{
    readonly nodeIds: readonly string[];
    readonly edges: readonly { readonly source: string; readonly target: string; readonly synthetic: boolean }[];
}> {
    return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        return {
            nodeIds: cy.nodes().filter((node: import('cytoscape').NodeSingular) =>
                !node.data('isShadowNode')
            ).map((node: import('cytoscape').NodeSingular) => node.id()).sort(),
            edges: cy.edges().map((edge: import('cytoscape').EdgeSingular) => ({
                source: edge.source().id(),
                target: edge.target().id(),
                synthetic: edge.data('isSyntheticEdge') === true,
            })).sort((left, right) => `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`)),
        };
    });
}

async function fitGraph(appWindow: Page): Promise<void> {
    await appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        cy.fit(undefined, 80);
    });
    await appWindow.waitForTimeout(600);
}

async function panFolderHandleIntoInteractiveViewport(appWindow: Page, folderId: string): Promise<void> {
    await appWindow.evaluate((id: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const folder = cy.getElementById(id);
        if (folder.length === 0) throw new Error(`No folder ${id}`);

        const container = cy.container();
        if (container === null) throw new Error('No Cytoscape container');

        const sidebarRight = (document.querySelector('[data-testid="folder-tree-sidebar"]') as HTMLElement | null)
            ?.getBoundingClientRect().right ?? 0;
        const containerRect = container.getBoundingClientRect();
        const folderBbox = (folder as import('cytoscape').NodeSingular).renderedBoundingBox();
        const chipPx = 22;
        const eyeCenterX = containerRect.left + folderBbox.x1 + chipPx + (chipPx / 2);
        const eyeCenterY = containerRect.top + folderBbox.y1 + (chipPx / 2);
        const targetEyeCenterX = Math.max(sidebarRight + 80, 160);
        const targetEyeCenterY = 120;
        const pan = cy.pan();

        cy.pan({
            x: pan.x + (targetEyeCenterX - eyeCenterX),
            y: pan.y + (targetEyeCenterY - eyeCenterY),
        });
    }, folderId);
    await appWindow.waitForTimeout(600);
}

async function getFolderHandleSnapshot(appWindow: Page, folderId: string): Promise<FolderHandleSnapshot> {
    return appWindow.evaluate((id: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const folder = cy.getElementById(id);
        if (folder.length === 0) throw new Error(`No folder ${id}`);

        const chip = [...document.querySelectorAll('.vt-folder-handle')]
            .find((el) => (el as HTMLElement).dataset.folderId === id) as HTMLElement | undefined;
        if (chip === undefined) throw new Error(`No folder handle chip for ${id}`);

        const chevron = chip.querySelector('.vt-folder-handle__chevron') as HTMLElement | null;
        const eye = chip.querySelector('.vt-folder-handle__eye') as HTMLElement | null;
        if (chevron === null || eye === null) throw new Error(`Folder handle for ${id} is missing buttons`);

        const container = cy.container();
        if (container === null) throw new Error('No Cytoscape container');

        const containerRect = container.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        const folderBbox = (folder as import('cytoscape').NodeSingular).renderedBoundingBox();
        const chipOffsetX = chipRect.x - containerRect.x;
        const chipOffsetY = chipRect.y - containerRect.y;
        const toRectSnapshot = (rect: DOMRect): RectSnapshot => ({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            cx: rect.x + rect.width / 2,
            cy: rect.y + rect.height / 2,
        });

        return {
            chip: toRectSnapshot(chipRect),
            chevron: toRectSnapshot(chevron.getBoundingClientRect()),
            eye: toRectSnapshot(eye.getBoundingClientRect()),
            folderBbox: {
                x1: folderBbox.x1,
                y1: folderBbox.y1,
                x2: folderBbox.x2,
                y2: folderBbox.y2,
            },
            chipOffsetFromFolder: {
                dx: chipOffsetX - folderBbox.x1,
                dy: chipOffsetY - folderBbox.y1,
            },
        };
    }, folderId);
}

async function expectEyeReceivesPointer(appWindow: Page, eye: RectSnapshot): Promise<void> {
    await expect.poll(
        () => appWindow.evaluate((point: { readonly x: number; readonly y: number }) => {
            const at = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
            const button = at?.closest('.vt-folder-handle__eye') as HTMLElement | null;
            return button?.getAttribute('aria-label') ?? at?.className ?? at?.tagName ?? null;
        }, { x: eye.cx, y: eye.cy }),
        {
            message: 'Waiting for folder-note eye button to be the real DOM pointer target',
            timeout: 5000,
            intervals: [100, 250, 500],
        },
    ).toBe('View folder note');
}

async function getHoverEditorSnapshot(appWindow: Page): Promise<{
    readonly exists: boolean;
    readonly title: string;
    readonly content: string;
}> {
    return appWindow.evaluate(() => {
        const editor = document.querySelector('[id^="window-editor-"]') as HTMLElement | null;
        if (editor === null) return { exists: false, title: '', content: '' };

        const cmContent = editor.querySelector('.cm-content') as CodeMirrorElement | null;
        return {
            exists: true,
            title: editor.querySelector('.cy-floating-window-title')?.textContent ?? '',
            content: cmContent?.cmView?.view?.state.doc.toString() ?? cmContent?.textContent ?? '',
        };
    });
}

async function hoverEyeAndWaitForFolderNote(appWindow: Page, eye: RectSnapshot): Promise<void> {
    await appWindow.mouse.move(8, 8);
    await appWindow.waitForTimeout(250);
    await appWindow.mouse.move(eye.cx, eye.cy, { steps: 8 });

    await expect.poll(
        () => getHoverEditorSnapshot(appWindow),
        {
            message: 'Waiting for real DOM eye hover to open the folder-note editor',
            timeout: 10000,
            intervals: [250, 500, 1000],
        },
    ).toMatchObject({
        exists: true,
        content: expect.stringContaining('Unique folder note content for DOM hover.'),
    });
}

async function clickEyeAndWaitForFolderNote(appWindow: Page, eye: RectSnapshot): Promise<void> {
    await appWindow.mouse.move(8, 8);
    await appWindow.waitForTimeout(250);
    await appWindow.mouse.click(eye.cx, eye.cy);

    await expect.poll(
        () => getHoverEditorSnapshot(appWindow),
        {
            message: 'Waiting for real DOM eye click to open the folder-note editor',
            timeout: 10000,
            intervals: [250, 500, 1000],
        },
    ).toMatchObject({
        exists: true,
        content: expect.stringContaining('Unique folder note content for DOM hover.'),
    });
}

async function closeHoverEditor(appWindow: Page): Promise<void> {
    await appWindow.mouse.move(8, 8);
    await appWindow.waitForTimeout(250);
    await appWindow.mouse.click(8, 8);
    await appWindow.waitForTimeout(350);
}

test.describe('Folder-note DOM affordance', () => {
    test('renders folder note only through the DOM eye chip in expanded and collapsed states', async ({ appWindow, projectRoot }) => {
        test.setTimeout(90000);
        const { authFolderId, authNoteId, loginId } = idsForProject(projectRoot);

        await waitForGraphLoaded(appWindow, 3);
        await fitGraph(appWindow);
        await panFolderHandleIntoInteractiveViewport(appWindow, authFolderId);

        const expandedGraph = await getVisibleGraphSnapshot(appWindow);
        expect(expandedGraph.nodeIds).toContain(authFolderId);
        expect(expandedGraph.nodeIds).toContain(loginId);
        expect(expandedGraph.nodeIds).not.toContain(authNoteId);
        expect(expandedGraph.edges).not.toContainEqual({
            source: loginId,
            target: authFolderId,
            synthetic: false,
        });

        const expandedHandle = await getFolderHandleSnapshot(appWindow, authFolderId);
        await expectEyeReceivesPointer(appWindow, expandedHandle.eye);
        await clickEyeAndWaitForFolderNote(appWindow, expandedHandle.eye);
        await closeHoverEditor(appWindow);
        await hoverEyeAndWaitForFolderNote(appWindow, expandedHandle.eye);
        await closeHoverEditor(appWindow);

        await appWindow.mouse.click(expandedHandle.chevron.cx, expandedHandle.chevron.cy);
        await expect.poll(
            () => appWindow.evaluate((id: string) => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                if (!cy) throw new Error('No cytoscapeInstance');
                return cy.getElementById(id).data('collapsed') === true;
            }, authFolderId),
            {
                message: 'Waiting for real DOM chevron click to collapse auth/',
                timeout: 10000,
                intervals: [250, 500, 1000],
            },
        ).toBe(true);

        await appWindow.waitForTimeout(500);
        const collapsedHandle = await getFolderHandleSnapshot(appWindow, authFolderId);
        expect(Math.abs(collapsedHandle.chipOffsetFromFolder.dx)).toBeLessThanOrEqual(3);
        expect(Math.abs(collapsedHandle.chipOffsetFromFolder.dy)).toBeLessThanOrEqual(3);

        await expectEyeReceivesPointer(appWindow, collapsedHandle.eye);
        await clickEyeAndWaitForFolderNote(appWindow, collapsedHandle.eye);
        await closeHoverEditor(appWindow);
        await hoverEyeAndWaitForFolderNote(appWindow, collapsedHandle.eye);
        await closeHoverEditor(appWindow);
    });
});
