/**
 * Shared helpers for folder node e2e tests.
 * Pure functions + test vault factory + diagnostic utilities.
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

export interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: ElectronAPI;
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
