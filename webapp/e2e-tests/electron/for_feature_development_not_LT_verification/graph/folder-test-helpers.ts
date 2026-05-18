/**
 * Shared helpers for folder node e2e tests.
 * Pure functions + test vault factory + diagnostic utilities.
 */

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());
const SCREENSHOT_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'test-results', 'folder-e2e-screenshots', SCREENSHOT_RUN_ID);
const LINUX_RENDERING_FLAGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: ElectronAPI;
}

export function getStableElectronRenderingFlags(): string[] {
    const isHeadlessLinux = process.platform === 'linux' && process.env.HEADLESS_TEST !== '0';
    return process.env.CI || process.env.VT_E2E_HEADLESS_LINUX || isHeadlessLinux
        ? LINUX_RENDERING_FLAGS
        : [];
}

export async function captureStateScreenshot(page: Page, fileName: string): Promise<void> {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, fileName);
    const dataUrl = await page.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        return cy.png({
            output: 'base64uri',
            bg: '#ffffff',
            full: false,
        });
    });
    await fs.writeFile(screenshotPath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log(`Folder e2e screenshot: ${screenshotPath}`);
}

export function cssString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function clickVisibleElementCenter(page: Page, locator: Locator): Promise<void> {
    await expect(locator).toBeVisible({ timeout: 5000 });
    const box = await locator.boundingBox();
    if (!box) throw new Error('Expected visible element to have a bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function openFolderTreeSidebar(page: Page): Promise<void> {
    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    const isVisible = await sidebar.isVisible().catch(() => false);
    if (!isVisible) {
        const folderTreeButton = page.locator('#folder-tree');
        if (await folderTreeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await folderTreeButton.click();
        } else {
            const speedDialToggle = page.locator('.speed-dial-toggle, [data-testid="speed-dial-toggle"]');
            if (await speedDialToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
                await speedDialToggle.click();
                await page.waitForTimeout(300);
            }
            await page.locator('#folder-tree').click({ timeout: 5000 });
        }
    }

    await expect(sidebar).toBeVisible({ timeout: 5000 });
    await expect.poll(
        () => page.locator('.folder-tree-folder').count(),
        {
            message: 'Waiting for folder tree rows to render',
            timeout: 15000,
            intervals: [500, 1000, 2000]
        }
    ).toBeGreaterThan(0);
}

export async function ensureSidebarFolderVisible(page: Page, folderName: string, vaultPath: string): Promise<Locator> {
    const row = page.locator('.folder-tree-folder', {
        has: page.locator('.folder-tree-folder-name', { hasText: folderName })
    }).first();

    if (!await row.isVisible().catch(() => false)) {
        const projectRootRow = page.locator(`.folder-tree-container .folder-tree-folder[title="${cssString(vaultPath)}"]`).first();
        await clickVisibleElementCenter(page, projectRootRow);
        await expect(row).toBeVisible({ timeout: 5000 });
    }

    return row;
}

// ── Vault Factory ─────────────────────────────────────────────────────
// Creates a test vault with explicit folder structure:
//   auth/login-flow.md, auth/jwt-token.md, auth/session-manager.md  (3 files)
//   api/gateway.md, api/router.md                                    (2 files)
//   utils/logger.md, utils/config.md                                 (2 files)
//   readme.md                                                        (root, no folder)
export async function createFolderTestVault(basePath: string): Promise<string> {
    const vaultPath = path.join(basePath, 'folder-test-vault');

    await fs.mkdir(path.join(vaultPath, 'auth'), { recursive: true });
    await fs.mkdir(path.join(vaultPath, 'api'), { recursive: true });
    await fs.mkdir(path.join(vaultPath, 'utils'), { recursive: true });

    await fs.writeFile(path.join(vaultPath, 'auth', 'login-flow.md'),
        `---\nposition:\n  x: 100\n  y: 100\n---\n# Login Flow\nHandles user login.\n[[auth/jwt-token]]\n`);
    await fs.writeFile(path.join(vaultPath, 'auth', 'jwt-token.md'),
        `---\nposition:\n  x: 200\n  y: 100\n---\n# JWT Token\nToken generation.\n[[auth/session-manager]]\n`);
    await fs.writeFile(path.join(vaultPath, 'auth', 'session-manager.md'),
        `---\nposition:\n  x: 300\n  y: 100\n---\n# Session Manager\nManages sessions.\n[[api/gateway]]\n`);

    await fs.writeFile(path.join(vaultPath, 'api', 'gateway.md'),
        `---\nposition:\n  x: 100\n  y: 300\n---\n# API Gateway\nMain entry point.\n[[api/router]]\n`);
    await fs.writeFile(path.join(vaultPath, 'api', 'router.md'),
        `---\nposition:\n  x: 200\n  y: 300\n---\n# Router\nRequest routing.\n[[auth/login-flow]]\n`);

    await fs.writeFile(path.join(vaultPath, 'utils', 'logger.md'),
        `---\nposition:\n  x: 100\n  y: 500\n---\n# Logger\nLogging utility.\n`);
    await fs.writeFile(path.join(vaultPath, 'utils', 'config.md'),
        `---\nposition:\n  x: 200\n  y: 500\n---\n# Config\nApp configuration.\n`);

    await fs.writeFile(path.join(vaultPath, 'readme.md'),
        `---\nposition:\n  x: 400\n  y: 300\n---\n# Project Overview\nTest project.\n[[auth/login-flow]]\n[[api/gateway]]\n`);

    return vaultPath;
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
