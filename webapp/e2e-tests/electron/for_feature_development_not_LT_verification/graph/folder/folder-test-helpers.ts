/**
 * Shared helpers for folder node e2e tests.
 * Pure functions + test project factory + diagnostic utilities.
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { HostAPI } from '@/shell/hostApi';

export interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    hostAPI?: HostAPI;
}

// ── Project Factory ─────────────────────────────────────────────────────
// Creates a test project with explicit folder structure:
//   auth/login-flow.md, auth/jwt-token.md, auth/session-manager.md  (3 files)
//   api/gateway.md, api/router.md                                    (2 files)
//   utils/logger.md, utils/config.md                                 (2 files)
//   readme.md                                                        (root, no folder)
export async function createFolderTestProject(basePath: string): Promise<string> {
    const projectRoot = path.join(basePath, 'folder-test-project');

    await fs.mkdir(path.join(projectRoot, 'auth'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'api'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'utils'), { recursive: true });

    await fs.writeFile(path.join(projectRoot, 'auth', 'login-flow.md'),
        `---\nposition:\n  x: 100\n  y: 100\n---\n# Login Flow\nHandles user login.\n[[auth/jwt-token]]\n`);
    await fs.writeFile(path.join(projectRoot, 'auth', 'jwt-token.md'),
        `---\nposition:\n  x: 200\n  y: 100\n---\n# JWT Token\nToken generation.\n[[auth/session-manager]]\n`);
    await fs.writeFile(path.join(projectRoot, 'auth', 'session-manager.md'),
        `---\nposition:\n  x: 300\n  y: 100\n---\n# Session Manager\nManages sessions.\n[[api/gateway]]\n`);

    await fs.writeFile(path.join(projectRoot, 'api', 'gateway.md'),
        `---\nposition:\n  x: 100\n  y: 300\n---\n# API Gateway\nMain entry point.\n[[api/router]]\n`);
    await fs.writeFile(path.join(projectRoot, 'api', 'router.md'),
        `---\nposition:\n  x: 200\n  y: 300\n---\n# Router\nRequest routing.\n[[auth/login-flow]]\n`);

    await fs.writeFile(path.join(projectRoot, 'utils', 'logger.md'),
        `---\nposition:\n  x: 100\n  y: 500\n---\n# Logger\nLogging utility.\n`);
    await fs.writeFile(path.join(projectRoot, 'utils', 'config.md'),
        `---\nposition:\n  x: 200\n  y: 500\n---\n# Config\nApp configuration.\n`);

    await fs.writeFile(path.join(projectRoot, 'readme.md'),
        `---\nposition:\n  x: 400\n  y: 300\n---\n# Project Overview\nTest project.\n[[auth/login-flow]]\n[[api/gateway]]\n`);

    return projectRoot;
}

// ── Graph Waiting ─────────────────────────────────────────────────────

export async function waitForGraphLoaded(page: Page, minNodes = 1): Promise<void> {
    await expect.poll(async () => {
        return page.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return 0;
            return cy.nodes().length;
        });
    }, {
        message: `Waiting for graph to have >= ${minNodes} nodes`,
        timeout: 20000,
        intervals: [500, 1000, 1000, 2000]
    }).toBeGreaterThanOrEqual(minNodes);
}

// ── Folder Collapse Trigger ───────────────────────────────────────────

/**
 * Toggle a folder's collapsed state via its FolderHandleService chevron chip —
 * the user-facing affordance for collapse/expand. (Double-tapping the folder
 * body no longer collapses it; the chevron, vertical menu, and folder-tree
 * sidebar are the deliberate triggers.)
 *
 * Fires the chevron button's real click handler directly rather than via screen
 * coordinates, so it is robust to viewport position and occlusion. Returns the
 * resolved folder id. Throws if the folder or its chip cannot be found, so a
 * missing affordance surfaces as a loud failure rather than a silent no-op.
 */
export async function toggleFolderViaChevron(page: Page, folderSuffix: string): Promise<string> {
    return page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
            .first();
        if (!folder.length) throw new Error(`No folder node ending with: ${suffix}`);
        const folderId = folder.id();
        const chip = Array.from(document.querySelectorAll<HTMLElement>('.vt-folder-handle'))
            .find((el: HTMLElement) => el.dataset.folderId === folderId);
        if (!chip) throw new Error(`No folder handle chip for: ${folderId}`);
        const chevron = chip.querySelector<HTMLButtonElement>('.vt-folder-handle__chevron');
        if (!chevron) throw new Error(`No folder chevron button for: ${folderId}`);
        chevron.click();
        return folderId;
    }, folderSuffix);
}

/**
 * Click a folder's chevron chip via a real screen-coordinate mouse click,
 * asserting the chevron is the top hit target first. Unlike
 * {@link toggleFolderViaChevron} (which fires the handler programmatically),
 * this exercises genuine on-screen clickability — use it when a test's purpose
 * is to verify the chevron is actually reachable by the pointer.
 */
export async function clickFolderChevron(page: Page, folderSuffix: string): Promise<void> {
    const point = await page.evaluate((suffix: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.nodes()
            .filter((n: NodeSingular) => n.data('isFolderNode') && n.id().endsWith(suffix))
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

// ── Diagnostic Snapshot ───────────────────────────────────────────────

export interface GraphDiagnostic {
    totalNodes: number;
    totalEdges: number;
    folderNodes: { id: string; childCount: number; isParent: boolean }[];
    regularNodes: { id: string; parent: string | null; hasPresentation: boolean }[];
    rootNodes: string[];
    domFolderPresentations: number;
    domRegularPresentations: number;
}

export async function dumpGraphState(page: Page): Promise<GraphDiagnostic> {
    return page.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return {
            totalNodes: 0, totalEdges: 0,
            folderNodes: [], regularNodes: [], rootNodes: [],
            domFolderPresentations: 0, domRegularPresentations: 0,
        };

        const folderNodes: { id: string; childCount: number; isParent: boolean }[] = [];
        const regularNodes: { id: string; parent: string | null; hasPresentation: boolean }[] = [];
        const rootNodes: string[] = [];

        cy.nodes().forEach((n: NodeSingular) => {
            if (n.data('isFolderNode')) {
                folderNodes.push({ id: n.id(), childCount: n.children().length, isParent: n.isParent() });
            } else if (!n.data('isShadowNode')) {
                const parent = n.data('parent') || null;
                const hasPresentation = !!document.querySelector(`.node-presentation[data-node-id="${n.id()}"]`);
                regularNodes.push({ id: n.id(), parent, hasPresentation });
                if (!parent) rootNodes.push(n.id());
            }
        });

        return {
            totalNodes: cy.nodes().length,
            totalEdges: cy.edges().length,
            folderNodes, regularNodes, rootNodes,
            domFolderPresentations: document.querySelectorAll('.folder-presentation').length,
            domRegularPresentations: document.querySelectorAll('.node-presentation:not(.folder-presentation)').length,
        };
    });
}

// ── Folder Card DOM Snapshot ──────────────────────────────────────────

export interface FolderCardSnapshot {
    nodeId: string;
    shadowNodeId: string;
    hasAccent: boolean;
    hasTitle: boolean;
    titleText: string;
    hasCountBadge: boolean;
    countText: string;
    hasToggle: boolean;
    toggleText: string;
    opacity: string;
    width: string;
    borderRadius: string;
    classList: string[];
}

export async function snapshotFolderCards(page: Page): Promise<FolderCardSnapshot[]> {
    return page.evaluate(() => {
        const cards = document.querySelectorAll('.folder-presentation');
        return Array.from(cards).map(card => {
            const el = card as HTMLElement;
            return {
                nodeId: el.dataset.nodeId ?? '(none)',
                shadowNodeId: el.dataset.shadowNodeId ?? '(none)',
                hasAccent: !!card.querySelector('.node-presentation-accent'),
                hasTitle: !!card.querySelector('.node-presentation-title'),
                titleText: card.querySelector('.node-presentation-title')?.textContent ?? '',
                hasCountBadge: !!card.querySelector('.folder-child-count'),
                countText: card.querySelector('.folder-child-count')?.textContent ?? '',
                hasToggle: !!card.querySelector('.folder-toggle'),
                toggleText: card.querySelector('.folder-toggle')?.textContent ?? '',
                opacity: el.style.opacity,
                width: el.style.width,
                borderRadius: el.style.borderRadius,
                classList: Array.from(el.classList),
            };
        });
    });
}

// ── Zoom Helper ───────────────────────────────────────────────────────

export async function setZoomAndCenter(page: Page, zoom: number): Promise<void> {
    await page.evaluate((z: number) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscape');
        cy.zoom(z);
        cy.center();
    }, zoom);
    await page.waitForTimeout(800);
}
