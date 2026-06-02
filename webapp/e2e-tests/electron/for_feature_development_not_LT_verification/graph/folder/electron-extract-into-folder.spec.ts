/**
 * BEHAVIORAL SPEC:
 * Extract selected same-parent items into a new folder via the canvas context menu.
 *
 * Contract v1:
 * - Entry point: canvas context menu alongside existing multi-selection actions.
 * - Supported selection set: selected file nodes and folder nodes are allowed only when
 *   they are all current children of the same parent folder.
 * - Guard: action is disabled or no-op when the supported selection count is fewer than 2.
 * - Output shape: create one new folder under that same parent folder.
 * - Inside the new folder, create one `index.md` folder note containing the count of
 *   contained nodes and no wikilinks.
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

async function createExtractIntoFolderProject(basePath: string): Promise<string> {
    const projectRoot = path.join(basePath, 'extract-into-folder-project');

    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });

    await fs.writeFile(
        path.join(projectRoot, 'alpha.md'),
        `---\nposition:\n  x: 120\n  y: 120\n---\n# Alpha\nAlpha body.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'beta.md'),
        `---\nposition:\n  x: 260\n  y: 120\n---\n# Beta\nBeta body.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'overview.md'),
        `---\nposition:\n  x: 420\n  y: 120\n---\n# Overview\nOverview body.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'docs', 'intro.md'),
        `---\nposition:\n  x: 160\n  y: 280\n---\n# Intro\nDocs intro.\n`
    );
    await fs.writeFile(
        path.join(projectRoot, 'docs', 'architecture.md'),
        `---\nposition:\n  x: 300\n  y: 280\n---\n# Architecture\nDocs architecture.\n`
    );

    return projectRoot;
}

type RootEntry = {
    name: string;
    isDirectory: boolean;
};

async function listRootEntries(projectRoot: string): Promise<RootEntry[]> {
    const entries = await fs.readdir(projectRoot, { withFileTypes: true });
    return entries
        .map((entry: import('fs').Dirent): RootEntry => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
        }))
        .sort((left: RootEntry, right: RootEntry) => left.name.localeCompare(right.name));
}

async function findSingleNewRootFolderName(projectRoot: string, beforeNames: readonly string[]): Promise<string | null> {
    const entries = await listRootEntries(projectRoot);
    const beforeSet = new Set(beforeNames);
    const newFolders = entries
        .filter((entry: RootEntry) => entry.isDirectory && !beforeSet.has(entry.name))
        .map((entry: RootEntry) => entry.name);

    return newFolders.length === 1 ? newFolders[0] : null;
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

type ExtractedFolderCollapseState = {
    projectedKind: string | null;
    cytoscapeCollapsed: boolean | null;
};

type ExtractProjectedGraphCaptureWindow = ExtendedWindow & {
    __extractLastProjectedGraph?: { nodes?: readonly { id: string; kind: string }[] };
    __extractUnsubscribeProjectedGraph?: () => void;
};

async function startProjectedGraphCapture(appWindow: Page): Promise<void> {
    await appWindow.evaluate(() => {
        const extendedWindow = window as unknown as ExtractProjectedGraphCaptureWindow;
        extendedWindow.__extractUnsubscribeProjectedGraph?.();
        extendedWindow.__extractLastProjectedGraph = undefined;
        extendedWindow.__extractUnsubscribeProjectedGraph = extendedWindow.hostAPI?.graph?.onProjectedGraphUpdate(
            (graph: { nodes?: readonly { id: string; kind: string }[] }) => {
                extendedWindow.__extractLastProjectedGraph = graph;
            }
        );
    });
}

async function getExtractedFolderCollapseState(
    appWindow: Page,
    folderPath: string
): Promise<ExtractedFolderCollapseState> {
    const folderId = `${folderPath}/`;

    return appWindow.evaluate(async (id: string) => {
        const extendedWindow = window as unknown as ExtractProjectedGraphCaptureWindow;
        const projectedGraph = extendedWindow.__extractLastProjectedGraph;
        const projectedNode = projectedGraph?.nodes?.find((node: { id: string; kind: string }) => node.id === id) ?? null;
        const cyFolder = extendedWindow.cytoscapeInstance?.getElementById(id);

        return {
            projectedKind: projectedNode?.kind ?? null,
            cytoscapeCollapsed: cyFolder?.length ? (cyFolder.data('collapsed') as boolean | undefined) ?? false : null,
        };
    }, folderId);
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
            position: { x: 520, y: 360 },
            renderedPosition: { x: 520, y: 360 },
        });
    });

    await expect(appWindow.locator('.ctxmenu')).toBeVisible({ timeout: 5000 });
}

async function openProjectFromRecentProjects(appWindow: Page): Promise<void> {
    await appWindow.waitForSelector('text=Recent Projects', { timeout: 10000 });
    const projectButton = appWindow.locator('button:has-text("extract-folder-test-project")').first();
    await expect(projectButton).toBeVisible({ timeout: 10000 });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const clickError = await projectButton.click({ timeout: 10000 }).then(
            () => null,
            (error: unknown) => error
        );
        const graphLoaded = await appWindow.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            undefined,
            { timeout: 5000 }
        ).then(
            () => true,
            () => false
        );

        if (graphLoaded) return;
        if (attempt === 3 && clickError) throw clickError;
    }

    await appWindow.waitForFunction(
        () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
        undefined,
        { timeout: 30000 }
    );
}

async function triggerExtractIntoFolder(appWindow: Page): Promise<void> {
    await openCanvasContextMenu(appWindow);
    const extractMenuItem = getExtractMenuItem(appWindow);
    await expect(extractMenuItem).toBeVisible({ timeout: 5000 });
    await extractMenuItem.click();
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-extract-folder-'));
        const projectRoot = await createExtractIntoFolderProject(tempDir);
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-extract-folder-ud-'));

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
            id: 'extract-folder-test',
            path: projectRoot,
            name: 'extract-folder-test-project',
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
                MINIMIZE_TEST: '0',
                VOICETREE_PERSIST_STATE: '1',
            },
            timeout: 15000,
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
        const appWindow = await electronApp.firstWindow({ timeout: 20000 });

        appWindow.on('console', msg => {
            const text = msg.text();
            if (
                text.includes('Extract')
                || text.includes('extract')
                || text.includes('folder')
                || text.includes('Folder')
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
        await openProjectFromRecentProjects(appWindow);
        await appWindow.waitForTimeout(3000);

        await use(appWindow);
    },
});

test.describe('Extract Into Folder Node', () => {
    test('extracts two same-parent file nodes into one new folder with an index.md note', async ({ appWindow, projectRoot }) => {
        test.setTimeout(90000);
        await waitForGraphLoaded(appWindow, 5);

        const alphaId = path.join(projectRoot, 'alpha.md');
        const betaId = path.join(projectRoot, 'beta.md');
        const rootEntriesBefore = await listRootEntries(projectRoot);

        await selectGraphNodes(appWindow, [alphaId, betaId]);
        await startProjectedGraphCapture(appWindow);
        await triggerExtractIntoFolder(appWindow);

        await expect.poll(async () => {
            return (await findSingleNewRootFolderName(projectRoot, rootEntriesBefore.map((entry: RootEntry) => entry.name))) ?? '';
        }, {
            message: 'Waiting for a single new root folder after extracting file nodes',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).not.toBe('');

        const newFolderName = await findSingleNewRootFolderName(
            projectRoot,
            rootEntriesBefore.map((entry: RootEntry) => entry.name)
        );
        expect(newFolderName).not.toBeNull();

        const newFolderPath = path.join(projectRoot, newFolderName!);
        const newFolderEntries = await fs.readdir(newFolderPath, { withFileTypes: true });
        const newFolderFileNames = newFolderEntries
            .filter((entry: import('fs').Dirent) => entry.isFile())
            .map((entry: import('fs').Dirent) => entry.name)
            .sort();

        expect(newFolderFileNames).toEqual(['alpha.md', 'beta.md', 'index.md']);
        expect(await fs.access(path.join(projectRoot, 'alpha.md')).then(() => true).catch(() => false)).toBe(false);
        expect(await fs.access(path.join(projectRoot, 'beta.md')).then(() => true).catch(() => false)).toBe(false);

        await expect.poll(async () => getExtractedFolderCollapseState(appWindow, newFolderPath), {
            message: 'Waiting for the extracted folder to be collapsed in the projected graph',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).toMatchObject({
            projectedKind: 'folder-collapsed',
            cytoscapeCollapsed: true,
        });

        const indexNoteContent = await fs.readFile(path.join(newFolderPath, 'index.md'), 'utf8');
        expect(readWikilinks(indexNoteContent)).toEqual([]);
        expect(indexNoteContent).toContain('Contains 2 nodes.');
    });

    test('extracts a same-parent folder node and file node into one new folder', async ({ appWindow, projectRoot }) => {
        test.setTimeout(90000);
        await waitForGraphLoaded(appWindow, 5);

        const docsFolderId = `${path.join(projectRoot, 'docs')}/`;
        const overviewId = path.join(projectRoot, 'overview.md');
        const rootEntriesBefore = await listRootEntries(projectRoot);

        await selectGraphNodes(appWindow, [docsFolderId, overviewId]);
        await startProjectedGraphCapture(appWindow);
        await triggerExtractIntoFolder(appWindow);

        await expect.poll(async () => {
            return (await findSingleNewRootFolderName(projectRoot, rootEntriesBefore.map((entry: RootEntry) => entry.name))) ?? '';
        }, {
            message: 'Waiting for a single new root folder after extracting a folder node and file node',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).not.toBe('');

        const newFolderName = await findSingleNewRootFolderName(
            projectRoot,
            rootEntriesBefore.map((entry: RootEntry) => entry.name)
        );
        expect(newFolderName).not.toBeNull();

        const newFolderPath = path.join(projectRoot, newFolderName!);
        const newFolderEntries = await fs.readdir(newFolderPath, { withFileTypes: true });
        const childNames = newFolderEntries.map((entry: import('fs').Dirent) => entry.name).sort();

        expect(childNames).toEqual(['docs', 'index.md', 'overview.md']);
        expect(await fs.access(path.join(projectRoot, 'docs')).then(() => true).catch(() => false)).toBe(false);
        expect(await fs.access(path.join(projectRoot, 'overview.md')).then(() => true).catch(() => false)).toBe(false);
        expect(await fs.access(path.join(newFolderPath, 'docs', 'intro.md')).then(() => true).catch(() => false)).toBe(true);
        expect(await fs.access(path.join(newFolderPath, 'docs', 'architecture.md')).then(() => true).catch(() => false)).toBe(true);

        await expect.poll(async () => getExtractedFolderCollapseState(appWindow, newFolderPath), {
            message: 'Waiting for the extracted folder to be collapsed in the projected graph',
            timeout: 10000,
            intervals: [250, 500, 1000],
        }).toMatchObject({
            projectedKind: 'folder-collapsed',
            cytoscapeCollapsed: true,
        });

        const indexNoteContent = await fs.readFile(path.join(newFolderPath, 'index.md'), 'utf8');
        expect(readWikilinks(indexNoteContent)).toEqual([]);
        expect(indexNoteContent).toContain('Contains 2 nodes.');
    });

    test('shows the extract action disabled when fewer than two same-parent items are selected', async ({ appWindow, projectRoot }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 5);

        await selectGraphNodes(appWindow, [path.join(projectRoot, 'alpha.md')]);
        await openCanvasContextMenu(appWindow);

        const extractMenuItem = getExtractMenuItem(appWindow);
        await expect(extractMenuItem).toBeVisible({ timeout: 5000 });
        await expect(extractMenuItem).toHaveClass(/disabled/);
    });
});
