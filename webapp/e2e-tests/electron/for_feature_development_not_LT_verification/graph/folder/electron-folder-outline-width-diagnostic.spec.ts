/**
 * DIAGNOSTIC: Folder Outline Width Bug
 *
 * Measures actual computed Cytoscape styles to determine whether the
 * "folder outlines too massive" visual bug is caused by:
 *   (A) folder node border-width (should be 1.5px from stylesheet)
 *   (B) edge widths (7.5px default, up to 12.5px with edgeCount — 2.5x scale)
 *
 * Previous work:
 *   - voicetree-5-3-2/fix-folder-compound-border-width.md (isFolderNode guard)
 *   - voicetree-5-3-2/diagnostic-folder-border-width.md (Amy's hypothesis)
 *
 * This test proves the root cause by collecting actual pixel values
 * and taking before/after screenshots with reduced edge widths.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
    type ExtendedWindow,
    createFolderTestVault,
    waitForGraphLoaded,
} from './folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

// ── Fixtures ──────────────────────────────────────────────────────────

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    vaultPath: string;
}>({
    vaultPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-outline-diag-'));
        const vaultPath = await createFolderTestVault(tempDir);
        await use(vaultPath);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ vaultPath }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-outline-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: vaultPath,
            vaultConfig: {
                [vaultPath]: {
                    writePath: vaultPath,
                    readPaths: []
                }
            }
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'outline-diag',
            path: vaultPath,
            name: 'outline-diag-vault',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
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
            const w = await electronApp.firstWindow();
            await w.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) await api.main.stopFileWatching();
            });
            await w.waitForTimeout(300);
        } catch { /* cleanup best-effort */ }

        await electronApp.close();
        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp, vaultPath }, use) => {
        const w = await electronApp.firstWindow({ timeout: 20000 });
        w.on('console', msg => {
            const t = msg.text();
            if (t.includes('folder') || t.includes('Folder') || t.includes('Error') || t.includes('error')
                || t.includes('watching') || t.includes('[App]')) {
                console.log(`BROWSER [${msg.type()}]:`, t);
            }
        });
        w.on('pageerror', err => console.error('PAGE ERROR:', err.message));

        await w.waitForLoadState('domcontentloaded');

        await w.evaluate(async (vp: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (api) await api.main.startFileWatching(vp);
        }, vaultPath);

        await w.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 }
        );
        await w.waitForTimeout(3000);
        await use(w);
    }
});

// ── Types for diagnostic data ────────────────────────────────────────

interface FolderNodeMeasurement {
    id: string;
    borderWidth: number;
    borderStyle: string;
    degree: number;
    childCount: number;
}

interface EdgeMeasurement {
    sourceId: string;
    targetId: string;
    width: number;
    edgeCount: number | null;
    touchesFolder: boolean;
}

interface RegularNodeMeasurement {
    id: string;
    borderWidth: number;
    degree: number;
}

// ── Tests ─────────────────────────────────────────────────────────────

test.describe('Folder Outline Width — Root Cause Diagnostic', () => {

    test('measure all computed border-widths and edge widths', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        // Fit the graph so everything is visible
        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (cy) cy.fit(undefined, 50);
        });
        await appWindow.waitForTimeout(500);

        // Collect measurements
        const data = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return null;

            const folderNodes: FolderNodeMeasurement[] = [];
            const regularNodes: RegularNodeMeasurement[] = [];
            const edges: EdgeMeasurement[] = [];

            const folderIds = new Set<string>();

            cy.nodes().forEach((n: import('cytoscape').NodeSingular) => {
                if (n.data('isShadowNode')) return;

                const bw = parseFloat(n.style('border-width'));
                if (n.data('isFolderNode')) {
                    folderIds.add(n.id());
                    folderNodes.push({
                        id: n.id(),
                        borderWidth: bw,
                        borderStyle: n.style('border-style') as string,
                        degree: n.degree(),
                        childCount: n.children().length,
                    });
                } else {
                    regularNodes.push({
                        id: n.id(),
                        borderWidth: bw,
                        degree: n.degree(),
                    });
                }
            });

            cy.edges().forEach((e: import('cytoscape').EdgeSingular) => {
                const w = parseFloat(e.style('width'));
                const src = e.source().id();
                const tgt = e.target().id();
                edges.push({
                    sourceId: src,
                    targetId: tgt,
                    width: w,
                    edgeCount: e.data('edgeCount') ?? null,
                    touchesFolder: folderIds.has(src) || folderIds.has(tgt),
                });
            });

            return { folderNodes, regularNodes, edges };
        });

        expect(data).not.toBeNull();

        // ── Report ────────────────────────────────────────────────
        const lines: string[] = [];
        lines.push('=== FOLDER OUTLINE WIDTH DIAGNOSTIC ===');
        lines.push('');

        lines.push('--- FOLDER NODE BORDER-WIDTHS ---');
        for (const f of data!.folderNodes) {
            const shortId = f.id.split('/').slice(-2).join('/');
            lines.push(`  ${shortId}: border-width=${f.borderWidth}px, style=${f.borderStyle}, degree=${f.degree}, children=${f.childCount}`);
        }
        const folderBorderWidths = data!.folderNodes.map(f => f.borderWidth);
        const maxFolderBorder = Math.max(...folderBorderWidths, 0);
        lines.push(`  MAX folder border-width: ${maxFolderBorder}px`);
        lines.push('');

        lines.push('--- REGULAR NODE BORDER-WIDTHS ---');
        for (const r of data!.regularNodes) {
            const shortId = r.id.split('/').pop() ?? r.id;
            lines.push(`  ${shortId}: border-width=${r.borderWidth}px, degree=${r.degree}`);
        }
        const regularBorderWidths = data!.regularNodes.map(r => r.borderWidth);
        const maxRegularBorder = Math.max(...regularBorderWidths, 0);
        lines.push(`  MAX regular node border-width: ${maxRegularBorder}px`);
        lines.push('');

        lines.push('--- EDGE WIDTHS ---');
        for (const e of data!.edges) {
            const srcShort = e.sourceId.split('/').pop() ?? e.sourceId;
            const tgtShort = e.targetId.split('/').pop() ?? e.targetId;
            const folderTag = e.touchesFolder ? ' [FOLDER-ADJACENT]' : '';
            lines.push(`  ${srcShort} -> ${tgtShort}: width=${e.width}px, edgeCount=${e.edgeCount}${folderTag}`);
        }
        const edgeWidths = data!.edges.map(e => e.width);
        const maxEdgeWidth = Math.max(...edgeWidths, 0);
        const avgEdgeWidth = edgeWidths.length ? edgeWidths.reduce((a, b) => a + b, 0) / edgeWidths.length : 0;
        lines.push(`  MAX edge width: ${maxEdgeWidth}px`);
        lines.push(`  AVG edge width: ${avgEdgeWidth.toFixed(1)}px`);
        lines.push('');

        lines.push('--- RATIO ANALYSIS ---');
        lines.push(`  Edge-to-folder-border ratio: ${maxFolderBorder > 0 ? (maxEdgeWidth / maxFolderBorder).toFixed(1) : 'N/A'}x`);
        lines.push(`  Edge-to-regular-border ratio: ${maxRegularBorder > 0 ? (maxEdgeWidth / maxRegularBorder).toFixed(1) : 'N/A'}x`);
        lines.push('');

        const edgeIsCulprit = maxEdgeWidth > maxFolderBorder * 2;
        const borderIsCulprit = maxFolderBorder > 5;
        lines.push('--- VERDICT ---');
        if (edgeIsCulprit && !borderIsCulprit) {
            lines.push('  ROOT CAUSE: Edge widths are the visual culprit.');
            lines.push(`  Edges (${maxEdgeWidth}px) dwarf folder borders (${maxFolderBorder}px).`);
            lines.push('  FIX: Reduce 2.5x edge width scaling in defaultEdgeStyles.ts');
        } else if (borderIsCulprit) {
            lines.push('  ROOT CAUSE: Folder border-widths are still being overridden.');
            lines.push(`  Folder borders at ${maxFolderBorder}px — isFolderNode guard may not be working.`);
            lines.push('  FIX: Debug the isFolderNode guard in updateNodeSizes.ts');
        } else {
            lines.push('  INCONCLUSIVE: Both values are moderate. Visual inspection needed.');
        }

        const report = lines.join('\n');
        console.log(report);
        await fs.writeFile('/tmp/folder-outline-diagnostic.txt', report, 'utf8');

        // Screenshot: current state
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/folder-outline-BEFORE.png'
        });

        // ── Assertions that document the current state ────────────
        // Folder border-width should be <= 2px (the stylesheet sets 1.5)
        // If this fails, the isFolderNode guard is broken
        expect(maxFolderBorder).toBeLessThanOrEqual(3);

        // Edge width should be much larger than folder border — proving edges are the issue
        expect(maxEdgeWidth).toBeGreaterThan(maxFolderBorder * 2);
    });

    test('A/B screenshot: reduce edge widths to original values', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (cy) cy.fit(undefined, 50);
        });
        await appWindow.waitForTimeout(500);

        // Screenshot A: current (2.5x scaled) edge widths
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/folder-outline-edges-CURRENT.png'
        });

        // Override edge widths back to original (pre-2.5x) values
        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return;

            cy.edges().forEach((e: import('cytoscape').EdgeSingular) => {
                const currentWidth = parseFloat(e.style('width'));
                // Reverse the 2.5x scale
                e.style('width', currentWidth / 2.5);
            });
        });
        await appWindow.waitForTimeout(500);

        // Screenshot B: original edge widths
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/folder-outline-edges-REDUCED.png'
        });

        // Measure the visual difference
        const afterWidths = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return [];
            return cy.edges().map((e: import('cytoscape').EdgeSingular) => parseFloat(e.style('width')));
        });

        const maxAfter = Math.max(...afterWidths, 0);
        console.log(`Edge widths after reduction: max=${maxAfter}px`);
        console.log('Compare screenshots:');
        console.log('  BEFORE: e2e-tests/screenshots/folder-outline-edges-CURRENT.png');
        console.log('  AFTER:  e2e-tests/screenshots/folder-outline-edges-REDUCED.png');

        // The reduced values should be close to the original pre-scale values
        expect(maxAfter).toBeLessThanOrEqual(5);
    });
});

export { test };
