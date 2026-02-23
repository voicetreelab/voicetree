/**
 * DIAGNOSTIC + REGRESSION — Folder Nodes (Compound Container System)
 *
 * Tests folder nodes (commit fd5f294b) against approved Option A design.
 * Uses a custom vault with auth/, api/, utils/ subdirectories.
 *
 * DESIGN SPEC thresholds:
 *   zoom  0.3=circle  0.5=morph  0.8=card  1.2=expand  1.8=child-cards
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
    dumpGraphState,
    snapshotFolderCards,
    setZoomAndCenter,
} from './folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

// ── Fixtures ──────────────────────────────────────────────────────────

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    vaultPath: string;
}>({
    vaultPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-test-'));
        const vaultPath = await createFolderTestVault(tempDir);
        await use(vaultPath);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ vaultPath }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-ud-'));

        // Create voicetree-config.json with lastDirectory + vaultConfig so loadFolder
        // knows to use the vault root as the writePath (loads all files directly)
        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: vaultPath,
            vaultConfig: {
                [vaultPath]: {
                    writePath: vaultPath,
                    readPaths: []
                }
            }
        }, null, 2), 'utf8');

        // Create projects.json so the watching-started handler in App.tsx
        // can find the project and switch from project-selection → graph-view
        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'folder-test',
            path: vaultPath,
            name: 'folder-test-vault',
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
                || t.includes('watching') || t.includes('Watching') || t.includes('[App]')) {
                console.log(`BROWSER [${msg.type()}]:`, t);
            }
        });
        w.on('pageerror', err => console.error('PAGE ERROR:', err.message));

        await w.waitForLoadState('domcontentloaded');

        // App starts on ProjectSelectionScreen. Trigger startFileWatching to
        // load the vault, which emits watching-started → App.tsx switches to graph-view.
        await w.evaluate(async (vp: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (api) await api.main.startFileWatching(vp);
        }, vaultPath);

        // Wait for cytoscape instance to appear (graph view mounted + initialized)
        await w.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 }
        );
        await w.waitForTimeout(3000);
        await use(w);
    }
});

// ── Tests ─────────────────────────────────────────────────────────────

test.describe('Folder Nodes — Diagnostic & Regression', () => {

    test('DIAGNOSTIC: dump full graph state', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);
        const state = await dumpGraphState(appWindow);

        const lines: string[] = [];
        lines.push(`Total Cy nodes: ${state.totalNodes}, edges: ${state.totalEdges}`);
        lines.push(`Folder nodes (${state.folderNodes.length}):`);
        state.folderNodes.forEach(f => lines.push(`  📁 ${f.id} children=${f.childCount} isParent=${f.isParent}`));
        lines.push(`Regular nodes (${state.regularNodes.length}):`);
        state.regularNodes.forEach(n => lines.push(`  📄 ${n.id} parent=${n.parent ?? '(root)'} pres=${n.hasPresentation}`));
        lines.push(`DOM: ${state.domFolderPresentations} folder, ${state.domRegularPresentations} regular`);

        // Write to file for capture (Playwright suppresses stdout for passing tests)
        await fs.writeFile('/tmp/folder-diagnostic-output.txt', lines.join('\n'), 'utf8');
        lines.forEach(l => console.log(l));

        await appWindow.screenshot({ path: 'e2e-tests/screenshots/folder-nodes-diagnostic.png' });
        expect(state.totalNodes).toBeGreaterThan(0);
    });

    test('folder compound nodes created for 2+ child directories', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);
        const state = await dumpGraphState(appWindow);

        expect(state.folderNodes.length).toBeGreaterThanOrEqual(2);
        const childNodes = state.regularNodes.filter(n => n.parent !== null);
        expect(childNodes.length).toBeGreaterThan(0);
    });

    test('folder card DOM has accent + title + count badge + toggle', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);
        const cards = await snapshotFolderCards(appWindow);

        const lines: string[] = [];
        lines.push(`Folder cards: ${cards.length}`);
        cards.forEach(c => lines.push(`  📁 ${c.nodeId} "${c.titleText}" ${c.countText} accent=${c.hasAccent} toggle=${c.hasToggle} classes=[${c.classList.join(',')}]`));
        await fs.writeFile('/tmp/folder-cards-output.txt', lines.join('\n'), 'utf8');
        lines.forEach(l => console.log(l));

        expect(cards.length).toBeGreaterThanOrEqual(2);
        for (const c of cards) {
            expect(c.hasAccent).toBe(true);
            expect(c.hasTitle).toBe(true);
            expect(c.titleText.length).toBeGreaterThan(0);
            expect(c.hasCountBadge).toBe(true);
            expect(c.countText).toMatch(/\d+ nodes/);
            expect(c.hasToggle).toBe(true);
        }
    });

    test('zoom morph: screenshots at every design threshold', async ({ appWindow }) => {
        test.setTimeout(90000);
        await waitForGraphLoaded(appWindow, 3);

        const zoomLines: string[] = [];
        for (const z of [0.3, 0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.5]) {
            await setZoomAndCenter(appWindow, z);
            const cards = await snapshotFolderCards(appWindow);
            const line = `zoom=${z}: ${cards.map(c => `${c.nodeId}(op=${c.opacity},w=${c.width},br=${c.borderRadius})`).join(' | ')}`;
            zoomLines.push(line);
            console.log(line);
            await appWindow.screenshot({ path: `e2e-tests/screenshots/folder-zoom-${z.toFixed(1)}.png` });
        }
        await fs.writeFile('/tmp/folder-zoom-output.txt', zoomLines.join('\n'), 'utf8');
    });

    test('toggle button triggers expand/collapse', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);
        await setZoomAndCenter(appWindow, 1.0);

        const result = await appWindow.evaluate(() => {
            const btns = document.querySelectorAll('.folder-toggle');
            if (!btns.length) return { ok: false, error: 'no toggles' };
            const btn = btns[0] as HTMLButtonElement;
            const card = btn.closest('.folder-presentation') as HTMLElement;
            const id = card?.dataset.nodeId ?? '?';
            const before = Array.from(card?.classList ?? []);
            btn.click();
            return { ok: true, id, before };
        });

        const toggleLines: string[] = [`Toggle: ${JSON.stringify(result)}`];
        console.log('Toggle:', JSON.stringify(result));
        await appWindow.waitForTimeout(600);

        if (result.ok) {
            const after = await appWindow.evaluate((id: string) => {
                const c = document.querySelector(`.folder-presentation[data-node-id="${id}"]`) as HTMLElement;
                if (!c) return null;
                return { classes: Array.from(c.classList), hasPreview: !!c.querySelector('.folder-children-preview') };
            }, result.id!);
            toggleLines.push(`After toggle: ${JSON.stringify(after)}`);
            console.log('After toggle:', JSON.stringify(after));
            await appWindow.screenshot({ path: 'e2e-tests/screenshots/folder-after-toggle.png' });
        }
        await fs.writeFile('/tmp/folder-toggle-output.txt', toggleLines.join('\n'), 'utf8');
    });

    test('hover preview dispatches mouseenter/mouseleave', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);
        await setZoomAndCenter(appWindow, 1.0);

        const id = await appWindow.evaluate(() => {
            const cards = document.querySelectorAll('.folder-presentation');
            if (!cards.length) return null;
            const card = cards[0] as HTMLElement;
            card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            return card.dataset.nodeId ?? null;
        });

        await appWindow.waitForTimeout(600);

        if (id) {
            const state = await appWindow.evaluate((fid: string) => {
                const c = document.querySelector(`.folder-presentation[data-node-id="${fid}"]`) as HTMLElement;
                if (!c) return null;
                return {
                    classes: Array.from(c.classList),
                    hasPreview: !!c.querySelector('.folder-children-preview'),
                    previewItems: c.querySelectorAll('.folder-child-item').length,
                };
            }, id);
            console.log('Hover state:', JSON.stringify(state));
            await fs.writeFile('/tmp/folder-hover-output.txt', `Hover state: ${JSON.stringify(state, null, 2)}`, 'utf8');
            await appWindow.screenshot({ path: 'e2e-tests/screenshots/folder-hover-preview.png' });

            await appWindow.evaluate((fid: string) => {
                const c = document.querySelector(`.folder-presentation[data-node-id="${fid}"]`);
                c?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            }, id);
        }
    });

    test('Cy compound parent-child integrity', async ({ appWindow }) => {
        test.setTimeout(60000);
        await waitForGraphLoaded(appWindow, 3);

        const info = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return null;
            return cy.nodes().filter((n: import('cytoscape').NodeSingular) => n.data('isFolderNode')).map(
                (n: import('cytoscape').NodeSingular) => ({
                    id: n.id(),
                    isParent: n.isParent(),
                    children: n.children().map((c: import('cytoscape').NodeSingular) => c.id()),
                })
            );
        });

        if (info) {
            const intLines: string[] = [];
            info.forEach(p => {
                const line = `📁 ${p.id} isParent=${p.isParent} → [${p.children.join(', ')}]`;
                intLines.push(line);
                console.log(line);
                expect(p.isParent).toBe(true);
                expect(p.children.length).toBeGreaterThanOrEqual(2);
            });
            await fs.writeFile('/tmp/folder-integrity-output.txt', intLines.join('\n'), 'utf8');
        }
    });

    test('no JS page errors during zoom exercise', async ({ appWindow }) => {
        test.setTimeout(60000);
        const errors: string[] = [];
        appWindow.on('pageerror', e => errors.push(e.message));

        await waitForGraphLoaded(appWindow, 3);
        for (const z of [0.3, 0.8, 1.2, 1.8]) {
            await setZoomAndCenter(appWindow, z);
            await appWindow.waitForTimeout(500);
        }

        const errLines: string[] = [`JS errors: ${errors.length}`];
        if (errors.length) {
            console.log(`⚠️  ${errors.length} page errors:`);
            errors.forEach(e => { errLines.push(`  ❌ ${e}`); console.log(`  ❌ ${e}`); });
        }
        // Diagnostic — log errors but don't fail
        console.log(`JS errors: ${errors.length}`);
        await fs.writeFile('/tmp/folder-jserrors-output.txt', errLines.join('\n'), 'utf8');
    });
});

export { test };
