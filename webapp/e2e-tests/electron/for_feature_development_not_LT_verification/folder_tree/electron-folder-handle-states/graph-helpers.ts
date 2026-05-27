import type { Page } from '@playwright/test';
import type { ExtendedWindow } from '../../graph/folder/folder-test-helpers';

interface BBoxScreen {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly w: number;
    readonly h: number;
    readonly hostX: number;
    readonly hostY: number;
}

export async function getFolderBBox(appWindow: Page, folderId: string): Promise<BBoxScreen> {
    return appWindow.evaluate((id: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.getElementById(id);
        if (folder.length === 0) throw new Error(`No folder ${id}`);
        // Body-only bbox so chevron-region math (top-left = chip anchor) is not
        // skewed by the folder label that sits above the compound body.
        const bb = folder.renderedBoundingBox({includeLabels: false, includeOverlays: false});
        const host = (cy.container() as HTMLElement).getBoundingClientRect();
        return {
            x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2, w: bb.w, h: bb.h,
            hostX: host.left, hostY: host.top,
        };
    }, folderId);
}

export async function closeAllFloatingEditors(appWindow: Page): Promise<void> {
    // Click an empty corner; HoverEditor uses click-outside to close.
    await appWindow.mouse.move(8, 8);
    await appWindow.mouse.click(8, 8);
    await appWindow.waitForTimeout(250);
}
