/**
 * BEHAVIORAL SPEC:
 * E2E verification for the folder-handle UI states shipped on dev-manu
 * (FolderHandleService + ungrabify + setupCommandHover folder-note resolution).
 *
 * Captures one screenshot per state for visual review by the user, plus a
 * non-trivial assertion per state so the run goes red if the behavior
 * regresses.
 *
 * Implementation context: folder-handle-impl-shipped.md
 *   - DOM chevron chip at TL of every expanded folder (.vt-folder-handle__chevron)
 *   - Folder body is ungrabified when expanded; pill is grabbable when collapsed
 *   - setupCommandHover resolves /folder/ → /folder/index.md before opening editor
 *   - cy mouseover early-returns on isFolderNode → no grab cursor on folder body
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
} from '@e2e/electron/for_feature_development_not_LT_verification/graph/folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'e2e-tests/screenshots');

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

async function getFolderBBox(appWindow: Page, folderId: string): Promise<BBoxScreen> {
    return appWindow.evaluate((id: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.getElementById(id);
        if (folder.length === 0) throw new Error(`No folder ${id}`);
        const bb = folder.renderedBoundingBox();
        const host = (cy.container() as HTMLElement).getBoundingClientRect();
        return {
            x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2, w: bb.w, h: bb.h,
            hostX: host.left, hostY: host.top,
        };
    }, folderId);
}

async function closeAllFloatingEditors(appWindow: Page): Promise<void> {
    // Click an empty corner; HoverEditor uses click-outside to close.
    await appWindow.mouse.move(8, 8);
    await appWindow.mouse.click(8, 8);
    await appWindow.waitForTimeout(250);
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    vaultPath: string;
}>({
    vaultPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-handle-test-'));
        const vaultPath = await createFolderTestVault(tempDir);
        // Folder note so HoverEditor can resolve /<vault>/auth/ → /<vault>/auth/index.md
        await fs.writeFile(
            path.join(vaultPath, 'auth', 'index.md'),
            `---\nposition:\n  x: 50\n  y: 120\n---\n# Auth Folder Note\n\nThis is the folder note for the auth/ folder.\n`,
        );
        await use(vaultPath);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ vaultPath }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-folder-handle-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: vaultPath,
            vaultConfig: {
                [vaultPath]: { writePath: vaultPath, readPaths: [] },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'folder-handle-test',
            path: vaultPath,
            name: 'folder-handle-test-vault',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true,
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
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
            },
            timeout: 30000,
        });

        await use(electronApp);

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
        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 20000 });

        window.on('console', msg => {
            const text = msg.text();
            if (text.includes('error') || text.includes('Error') || text.includes('folder')) {
                console.log(`BROWSER [${msg.type()}]:`, text);
            }
        });
        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
        await window.locator('button:has-text("folder-handle-test-vault")').first().click();

        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 },
        );
        await window.waitForTimeout(3000);
        await use(window);
    },
});

test.describe('Folder handle UI states', () => {
    test('exercises 8 folder-handle states with screenshot per state', async ({ appWindow, vaultPath }) => {
        test.setTimeout(120000);

        const authFolderId = `${path.join(vaultPath, 'auth')}/`;

        await waitForGraphLoaded(appWindow, 3);

        // Fit graph so the auth folder is comfortably visible.
        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return;
            cy.fit(undefined, 60);
        });
        await appWindow.waitForTimeout(600);

        // ── State 1: Baseline ───────────────────────────────────────────
        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-1-baseline.png'),
        });

        const baseline = await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            const f = cy.getElementById(id);
            return {
                exists: f.length > 0,
                isFolderNode: f.data('isFolderNode') === true,
                collapsed: (f.data('collapsed') as boolean) ?? false,
                grabbable: f.grabbable(),
                childCount: f.children().length,
            };
        }, authFolderId);

        expect(baseline.exists).toBe(true);
        expect(baseline.isFolderNode).toBe(true);
        expect(baseline.collapsed).toBe(false);
        // Folder shipped as ungrabified when expanded.
        expect(baseline.grabbable).toBe(false);
        expect(baseline.childCount).toBeGreaterThan(0);

        // Compute screen-space anchor inside the folder body (away from TL chevron).
        const bbox = await getFolderBBox(appWindow, authFolderId);
        const folderInterior = {
            x: bbox.hostX + (bbox.x1 + bbox.x2) / 2,
            // Aim below center — avoids the TL chip and any title text.
            y: bbox.hostY + bbox.y1 + (bbox.h * 0.7),
        };

        // ── State 2: Hover folder body → cursor is NOT 'grab' ────────────
        // Park the mouse outside first so any stale cursor clears.
        await appWindow.mouse.move(8, 8);
        await appWindow.waitForTimeout(200);
        await appWindow.mouse.move(folderInterior.x, folderInterior.y, { steps: 8 });
        await appWindow.waitForTimeout(400);

        const cursorAtFolderBody = await appWindow.evaluate((p: { x: number; y: number }) => {
            const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
            if (!el) return { cursor: '(no element)', tag: '(none)' };
            return { cursor: getComputedStyle(el).cursor, tag: el.tagName };
        }, folderInterior);

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-2-hover-body.png'),
        });

        console.log('[STATE 2] cursor at folder body:', cursorAtFolderBody);
        expect(cursorAtFolderBody.cursor).not.toBe('grab');

        // ── State 3: Chevron chip is visible at TL corner ────────────────
        const chevron = appWindow.locator('.vt-folder-handle__chevron').first();
        await expect(chevron).toBeVisible({ timeout: 5000 });

        const chevronBox = await chevron.boundingBox();
        expect(chevronBox).not.toBeNull();

        // Wide clip around the chevron so the user can verify it sits at the
        // folder's TL corner.
        const clipPad = 60;
        const clip = chevronBox
            ? {
                x: Math.max(0, chevronBox.x - clipPad),
                y: Math.max(0, chevronBox.y - clipPad),
                width: chevronBox.width + clipPad * 2,
                height: chevronBox.height + clipPad * 2,
            }
            : undefined;
        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-3-chevron.png'),
            clip,
        });

        // ── State 4: Right-click in folder body → canvas vertical menu ───
        await closeAllFloatingEditors(appWindow);
        await appWindow.mouse.move(folderInterior.x, folderInterior.y, { steps: 4 });
        await appWindow.waitForTimeout(150);
        await appWindow.mouse.click(folderInterior.x, folderInterior.y, { button: 'right' });
        await appWindow.waitForTimeout(600);

        const ctxmenuSnapshot = await appWindow.evaluate(() => {
            const m = document.querySelector('.ctxmenu') as HTMLElement | null;
            if (!m) return { visible: false, width: 0, height: 0, text: '' };
            return {
                visible: m.offsetWidth > 0 && m.offsetHeight > 0,
                width: m.offsetWidth,
                height: m.offsetHeight,
                text: (m.textContent ?? '').trim().slice(0, 200),
            };
        });

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-4-rightclick.png'),
        });

        console.log('[STATE 4] ctxmenu snapshot:', ctxmenuSnapshot);
        expect(ctxmenuSnapshot.visible).toBe(true);

        // Dismiss the menu so it doesn't bleed into later screenshots.
        await appWindow.keyboard.press('Escape');
        await appWindow.mouse.click(8, 8);
        await appWindow.waitForTimeout(300);

        // ── State 5: Hover expanded folder → folder-note hover editor ────
        await closeAllFloatingEditors(appWindow);
        // Force the cy listener path explicitly so we exercise setupCommandHover.
        await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            cy.getElementById(id).emit('mouseover');
        }, authFolderId);
        await appWindow.waitForTimeout(900);

        const hoverEditorState5 = await appWindow.evaluate(() => {
            const ed = document.querySelector('[id^="window-editor-"]') as HTMLElement | null;
            return {
                exists: !!ed,
                id: ed?.id ?? '',
                title: ed?.querySelector('.cy-floating-window-title')?.textContent ?? '',
            };
        });

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-5-hover-editor-expanded.png'),
        });

        console.log('[STATE 5] hover editor (expanded):', hoverEditorState5);
        expect(hoverEditorState5.exists).toBe(true);

        await closeAllFloatingEditors(appWindow);

        // ── State 6: Click chevron → folder collapses to pill ────────────
        await chevron.click();

        await expect.poll(
            async () =>
                appWindow.evaluate((id: string) => {
                    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
                    return (cy.getElementById(id).data('collapsed') as boolean) ?? false;
                }, authFolderId),
            { timeout: 5000, intervals: [200, 400, 600] },
        ).toBe(true);

        // After collapse, the folder pill is grabbable again per the shipped contract.
        const collapsedSnapshot = await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            const f = cy.getElementById(id);
            return {
                collapsed: (f.data('collapsed') as boolean) ?? false,
                grabbable: f.grabbable(),
                visibleDescendants: cy.nodes().filter(
                    (n: import('cytoscape').NodeSingular) =>
                        !n.data('isShadowNode') &&
                        n.id() !== id &&
                        n.id().startsWith(id),
                ).length,
            };
        }, authFolderId);

        await appWindow.waitForTimeout(400);
        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-6-collapsed.png'),
        });

        console.log('[STATE 6] collapsed snapshot:', collapsedSnapshot);
        expect(collapsedSnapshot.collapsed).toBe(true);
        expect(collapsedSnapshot.grabbable).toBe(true);
        expect(collapsedSnapshot.visibleDescendants).toBe(0);

        // ── State 7: Hover collapsed pill → folder-note hover editor ─────
        await closeAllFloatingEditors(appWindow);
        await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            cy.getElementById(id).emit('mouseover');
        }, authFolderId);
        await appWindow.waitForTimeout(900);

        const hoverEditorState7 = await appWindow.evaluate(() => {
            const ed = document.querySelector('[id^="window-editor-"]') as HTMLElement | null;
            return {
                exists: !!ed,
                id: ed?.id ?? '',
                title: ed?.querySelector('.cy-floating-window-title')?.textContent ?? '',
            };
        });

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-7-hover-editor-collapsed.png'),
        });

        console.log('[STATE 7] hover editor (collapsed):', hoverEditorState7);
        expect(hoverEditorState7.exists).toBe(true);

        await closeAllFloatingEditors(appWindow);

        // ── State 8: Drag inside expanded body → pans, folder stays put ──
        // Re-expand via dbltap.
        await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            cy.getElementById(id).emit('dbltap');
        }, authFolderId);
        await expect.poll(
            async () =>
                appWindow.evaluate((id: string) => {
                    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
                    return (cy.getElementById(id).data('collapsed') as boolean) ?? false;
                }, authFolderId),
            { timeout: 5000, intervals: [200, 400] },
        ).toBe(false);
        await appWindow.waitForTimeout(600);

        const beforeDrag = await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            const f = cy.getElementById(id);
            const bb = f.renderedBoundingBox();
            const host = (cy.container() as HTMLElement).getBoundingClientRect();
            return {
                folderPos: { x: f.position().x, y: f.position().y },
                pan: { x: cy.pan().x, y: cy.pan().y },
                interior: {
                    x: host.left + (bb.x1 + bb.x2) / 2,
                    y: host.top + bb.y1 + bb.h * 0.7,
                },
            };
        }, authFolderId);

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-8a-before-drag.png'),
        });

        // Perform a slow, multi-step drag so cytoscape recognises it as a pan.
        await appWindow.mouse.move(beforeDrag.interior.x, beforeDrag.interior.y, { steps: 4 });
        await appWindow.mouse.down();
        const dragSteps = 8;
        const dx = 90;
        const dy = 60;
        for (let i = 1; i <= dragSteps; i++) {
            await appWindow.mouse.move(
                beforeDrag.interior.x + (dx * i) / dragSteps,
                beforeDrag.interior.y + (dy * i) / dragSteps,
                { steps: 3 },
            );
            await appWindow.waitForTimeout(20);
        }
        await appWindow.mouse.up();
        await appWindow.waitForTimeout(500);

        const afterDrag = await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            const f = cy.getElementById(id);
            return {
                folderPos: { x: f.position().x, y: f.position().y },
                pan: { x: cy.pan().x, y: cy.pan().y },
            };
        }, authFolderId);

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-8b-after-drag.png'),
        });

        const folderDx = afterDrag.folderPos.x - beforeDrag.folderPos.x;
        const folderDy = afterDrag.folderPos.y - beforeDrag.folderPos.y;
        const panDx = afterDrag.pan.x - beforeDrag.pan.x;
        const panDy = afterDrag.pan.y - beforeDrag.pan.y;
        console.log('[STATE 8] folder Δ:', { folderDx, folderDy }, 'pan Δ:', { panDx, panDy });

        // Hard assertion: folder must NOT move (ungrabify contract).
        expect(Math.abs(folderDx) + Math.abs(folderDy)).toBeLessThan(2);
        // Soft assertion: pan SHOULD happen on body drag — flag as a UI bug
        // (without failing the run) if cytoscape didn't pan because the
        // mousedown target was the ungrabified node rather than the canvas
        // background. Surfacing this is exactly what state 8 exists for.
        expect.soft(Math.abs(panDx) + Math.abs(panDy)).toBeGreaterThan(5);
    });
});

export { test };
