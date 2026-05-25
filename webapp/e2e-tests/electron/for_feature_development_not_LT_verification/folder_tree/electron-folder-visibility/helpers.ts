import { expect, type Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    type ExtendedWindow,
} from '../../graph/folder/folder-test-helpers';
import {
    clickVisibleElementCenter,
    cssString,
    openFolderTreeSidebar,
} from '../folder-spec-e2e-helpers';

type FolderVisibilityMenuAction = 'Expand' | 'Collapse' | 'Hide';

export interface VisibilityFixture {
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

interface CanonicalRootSnapshot extends GraphNodeSnapshot {
    readonly parentData: string | null;
    readonly hasSnapshotParent: boolean;
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

export function buildFixture(projectRoot: string): VisibilityFixture {
    const draftsPath = path.join(projectRoot, 'drafts');
    const workspacePath = path.join(projectRoot, 'workspace');
    const featurePath = path.join(workspacePath, 'feature');
    const secretPath = path.join(projectRoot, 'secret');
    const publicPath = path.join(projectRoot, 'public');

    return {
        rootNoteId: path.join(projectRoot, 'root.md'),
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

export async function writeMarkdownAtomically(filePath: string, body: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, body, 'utf8');
    await fs.rename(tempPath, filePath);
}

export async function createVisibilityVault(basePath: string): Promise<string> {
    const projectRoot = path.join(basePath, 'folder-visibility-vault');

    await writeMarkdown(path.join(projectRoot, 'root.md'),
        `---\nposition:\n  x: 60\n  y: 80\n---\n# Root\nVisible root-level note.\n`);

    await writeMarkdown(path.join(projectRoot, 'drafts', 'todo.md'),
        `---\nposition:\n  x: 180\n  y: 80\n---\n# Draft Todo\nUnmapped folder content.\n`);

    await writeMarkdown(path.join(projectRoot, 'workspace', 'feature', 'leaf.md'),
        `---\nposition:\n  x: 320\n  y: 120\n---\n# Feature Leaf\nChild content that should survive ancestor visibility changes.\n`);

    await writeMarkdown(path.join(projectRoot, 'secret', 'existing.md'),
        `---\nposition:\n  x: 460\n  y: 120\n---\n# Secret Existing\nExisting hidden-folder content.\n`);

    await writeMarkdown(path.join(projectRoot, 'public', 'target.md'),
        `---\nposition:\n  x: 620\n  y: 120\n---\n# Public Target\nVisible public endpoint.\n`);

    return projectRoot;
}

function sidebarFolderRow(appWindow: Page, absolutePath: string) {
    return appWindow.locator(`.folder-tree-folder[title="${cssString(absolutePath)}"]`).first();
}

async function ensureSidebarPathVisible(appWindow: Page, projectRoot: string, absolutePath: string): Promise<void> {
    await openFolderTreeSidebar(appWindow);

    const relativePath = path.relative(projectRoot, absolutePath);
    if (!relativePath || relativePath.startsWith('..')) {
        await expect(sidebarFolderRow(appWindow, absolutePath)).toBeVisible({ timeout: 5000 });
        return;
    }

    let currentPath = projectRoot;
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

export async function setFolderVisibilityWithContextMenu(
    appWindow: Page,
    projectRoot: string,
    absolutePath: string,
    action: FolderVisibilityMenuAction,
): Promise<void> {
    await ensureSidebarPathVisible(appWindow, projectRoot, absolutePath);
    const row = sidebarFolderRow(appWindow, absolutePath);
    await expect(row).toBeVisible({ timeout: 5000 });

    const box = await row.boundingBox();
    if (!box) throw new Error(`Expected folder row ${absolutePath} to have a bounding box`);
    await appWindow.mouse.click(box.x + Math.min(24, box.width / 2), box.y + box.height / 2, { button: 'right' });

    const item = appWindow.locator(`.ctxmenu li:has-text("${action}")`).first();
    await clickVisibleElementCenter(appWindow, item);
}

export async function getNodeSnapshot(appWindow: Page, id: string): Promise<GraphNodeSnapshot> {
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

export async function expectNodeToUseCanonicalRootParent(appWindow: Page, id: string): Promise<void> {
    const snapshot = await getCanonicalRootSnapshot(appWindow, id);
    expect(snapshot.parentData).toBeNull();
    expect(snapshot.hasSnapshotParent).toBe(false);
}

export async function getCanonicalRootSnapshot(appWindow: Page, id: string): Promise<CanonicalRootSnapshot> {
    return appWindow.evaluate((nodeId: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');

        const node = cy.nodes().filter((candidate: import('cytoscape').NodeSingular) =>
            candidate.id() === nodeId && !candidate.data('isShadowNode')
        ).first() as import('cytoscape').NodeSingular;

        if (!node.length) {
            return {
                id: nodeId,
                present: false,
                parentData: null,
                hasSnapshotParent: false,
            };
        }

        const parent = node.parent();
        return {
            id: node.id(),
            present: true,
            isFolderNode: node.data('isFolderNode') === true,
            collapsed: (node.data('collapsed') as boolean | undefined) ?? false,
            childCount: node.data('childCount') as number | undefined,
            ...(parent.length > 0 ? { parent: parent.id() } : {}),
            parentData: (node.data('parent') as string | undefined) ?? null,
            hasSnapshotParent: parent.length > 0,
        };
    }, id);
}

export async function getHiddenFolderLeakSnapshot(
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
