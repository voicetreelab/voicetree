import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ExtendedWindow } from '../folder-test-helpers';
import type { NodePosition, SyntheticEdgeInfo } from './types';

export async function emitDblTapOnFolder(page: Page, folderSuffix: string): Promise<string> {
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

export async function waitForFolderNode(page: Page, folderSuffix: string): Promise<string> {
    await expect.poll(
        () => page.evaluate((suffix: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return null;
            const folder = cy.nodes()
                .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
                .first();
            return folder.length ? folder.id() : null;
        }, folderSuffix),
        { message: `Waiting for folder node ending with ${folderSuffix}`, timeout: 20000 }
    ).not.toBeNull();

    return page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first();
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        return folder.id();
    }, folderSuffix);
}

export async function closeFolderTreeSidebarIfVisible(page: Page): Promise<void> {
    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    if (!await sidebar.isVisible().catch(() => false)) return;
    await sidebar.locator('.folder-tree-close-btn').click();
    await expect(sidebar).not.toBeVisible({ timeout: 5000 });
}

export async function clickFolderChevron(page: Page, folderSuffix: string): Promise<void> {
    const point = await page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first();
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        const folderId = folder.id();
        const chip = Array.from(document.querySelectorAll<HTMLElement>('.vt-folder-handle'))
            .find((el: HTMLElement) => el.dataset.folderId === folderId);
        if (!chip) throw new Error(`No folder handle chip for: ${folderId}`);
        const chevron = chip.querySelector<HTMLElement>('.vt-folder-handle__chevron');
        if (!chevron) throw new Error(`No folder chevron button for: ${folderId}`);
        const rect = chevron.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (!hit?.closest('.vt-folder-handle__chevron')) {
            const target = hit as HTMLElement | null;
            throw new Error(`Folder chevron is not the top hit target for: ${folderId}; hit=${target?.tagName ?? 'null'} class=${target?.className ?? ''} id=${target?.id ?? ''}`);
        }
        return { x, y };
    }, folderSuffix);

    await page.mouse.click(point.x, point.y);
}

export async function getSyntheticEdges(page: Page): Promise<SyntheticEdgeInfo[]> {
    return page.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return [];
        return cy.edges('[?isSyntheticEdge]').map((e: import('cytoscape').EdgeSingular) => ({
            id: e.id(),
            source: e.source().id(),
            target: e.target().id(),
            isSyntheticEdge: e.data('isSyntheticEdge') as boolean,
            edgeCount: e.data('edgeCount') as number | undefined,
            label: e.data('label') as string | undefined,
        }));
    });
}

export async function getFolderCollapsedState(page: Page, folderSuffix: string): Promise<boolean> {
    return page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first();
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        return (folder.data('collapsed') as boolean) ?? false;
    }, folderSuffix);
}

export async function getFolderNodePosition(page: Page, folderSuffix: string): Promise<NodePosition> {
    return page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first();
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        return { x: folder.position('x'), y: folder.position('y') };
    }, folderSuffix);
}

export async function setFolderNodePosition(page: Page, folderSuffix: string, position: NodePosition): Promise<void> {
    await page.evaluate((payload: { suffix: string; x: number; y: number }) => {
        const { suffix, x, y } = payload;
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first();
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        folder.position({ x, y });
    }, { suffix: folderSuffix, x: position.x, y: position.y });
}

export function distanceBetweenPoints(a: NodePosition, b: NodePosition): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}
