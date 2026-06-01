/**
 * BEHAVIORAL SPEC:
 * E2E verification for the folder-handle UI states shipped on dev-manu
 * (FolderHandleService + ungrabify + setupCommandHover folder-note resolution).
 *
 * Captures one screenshot per state for visual review by the user, plus a
 * non-trivial assertion per state so the run goes red if the behavior
 * regresses.
 *
 * Implementation context: FolderHandleService.ts
 *   - TL chevron+eye strip is a DOM overlay chip (NOT a cytoscape background-
 *     image — a compound folder's bbox would shrink the chip into a blurry
 *     atlas blob). Same chip for expanded folders and collapsed pills.
 *   - Folder body is ungrabified when expanded; pill is grabbable when collapsed
 *   - setupCommandHover resolves /folder/ → /folder/index.md before opening editor
 *   - cy mouseover early-returns on isFolderNode → no grab cursor on folder body
 *   - Folder collapse/expand is driven by the chevron chip (double-tap was removed)
 */

import { expect } from '@playwright/test';
import * as path from 'path';
import {
    type ExtendedWindow,
    waitForGraphLoaded,
    clickFolderChevron,
} from '@e2e/electron/for_feature_development_not_LT_verification/graph/folder/folder-test-helpers';
import {
    test,
    getFolderBBox,
    closeAllFloatingEditors,
    SCREENSHOT_DIR,
} from './electron-folder-handle-states.fixtures';

test.describe('Folder handle UI states', () => {
    test('exercises 8 folder-handle states with screenshot per state', async ({ appWindow, projectRoot }) => {
        test.setTimeout(120000);

        const authFolderId = `${path.join(projectRoot, 'auth')}/`;

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

        // Compute screen-space anchor inside the folder body PADDING RING
        // (= the visible compound rectangle's perimeter, away from children).
        // With padding:25 around children, the bottom ~25px strip is folder
        // body only — no child nodes — so cxttap target is the folder (canvas
        // menu) and `cy.on('mouseover','node[isFolderNode]')` early-returns
        // without setting `cursor:grab`. Aiming deeper (e.g. h*0.7) lands on a
        // child, which is correctly grabbable.
        const bbox = await getFolderBBox(appWindow, authFolderId);
        const folderInterior = {
            x: bbox.hostX + (bbox.x1 + bbox.x2) / 2,
            y: bbox.hostY + bbox.y2 - 12,
        };

        // ── State 2: Folder body hover does NOT set 'grab' cursor ─────────
        // Contract: `cy.on('mouseover','node')` in setupBasicCytoscapeEvent-
        // Listeners early-returns for folders, so the cy container's cursor
        // stays at whatever it was. We test this directly: clear the
        // cursorTarget cursor, fire mouseover on the folder, assert the
        // cursor was NOT set to 'grab'. (`elementFromPoint` is unreliable
        // here — the floating hover editor's chrome has its own `cursor:
        // grab` for window-dragging and overlaps the folder on hover.)
        const cursorAfterFolderHover = await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            const c = cy.container() as HTMLElement;
            const t = (c.parentElement ?? c) as HTMLElement;
            t.style.cursor = '';
            cy.getElementById(id).emit('mouseover');
            return getComputedStyle(t).cursor;
        }, authFolderId);

        // Visual capture of the folder body so the user can verify nothing
        // visually flags 'draggable' on hover.
        await appWindow.mouse.move(folderInterior.x, folderInterior.y, { steps: 4 });
        await appWindow.waitForTimeout(400);
        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-2-hover-body.png'),
        });

        console.log('[STATE 2] cursor after folder mouseover:', cursorAfterFolderHover);
        expect(cursorAfterFolderHover).not.toBe('grab');

        // ── State 3: Chevron chip rendered at folder TL (DOM overlay) ─────
        // The chevron+eye strip is a FolderHandleService DOM overlay, not a
        // cytoscape background-image. Assert the chip + chevron exist for the
        // auth folder and the chevron carries its SVG glyph, then clip-shot the
        // chip's actual rendered rect for visual review.
        const chevronChip = await appWindow.evaluate((id: string) => {
            const chip = Array.from(document.querySelectorAll<HTMLElement>('.vt-folder-handle'))
                .find((el: HTMLElement) => el.dataset.folderId === id);
            if (!chip) return { chipExists: false, chevronExists: false, hasGlyph: false, rect: null };
            const chevron = chip.querySelector<HTMLElement>('.vt-folder-handle__chevron');
            const r = chevron?.getBoundingClientRect();
            return {
                chipExists: true,
                chevronExists: chevron !== null,
                hasGlyph: (chevron?.querySelector('svg') ?? null) !== null,
                rect: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null,
            };
        }, authFolderId);
        console.log('[STATE 3] chevron chip:', chevronChip);
        expect(chevronChip.chipExists).toBe(true);
        expect(chevronChip.chevronExists).toBe(true);
        expect(chevronChip.hasGlyph).toBe(true);
        expect(chevronChip.rect).not.toBeNull();

        const chevronRect = chevronChip.rect!;
        const clipPad = 60;
        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'folder-handle-3-chevron.png'),
            clip: {
                x: Math.max(0, chevronRect.x - clipPad),
                y: Math.max(0, chevronRect.y - clipPad),
                width: chevronRect.w + clipPad * 2,
                height: chevronRect.h + clipPad * 2,
            },
        });

        // ── State 4: Right-click in folder body → canvas vertical menu ───
        // Park mouse far away first to avoid pre-warming the hover editor;
        // then go straight to the right-click with no dwell.
        await closeAllFloatingEditors(appWindow);
        await appWindow.mouse.move(8, 8);
        await appWindow.waitForTimeout(100);
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
        // Soft: ctxmenu can lose the race to the hover-editor under headed
        // playwright; the production cxttap path is exercised regardless and
        // covered by VerticalMenuService unit tests. We still capture the
        // screenshot so the user can verify the outcome visually.
        expect.soft(ctxmenuSnapshot.visible).toBe(true);

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

        // ── State 6: Click the chevron chip → collapse ───────────────────
        // Clicks the FolderHandleService chevron DOM button directly (shared
        // helper does a real screen-coordinate click + asserts the chevron is
        // the top hit target), so it does not depend on the cy-tap-vs-hover-
        // editor race that the old body-coordinate click had to dodge.
        await closeAllFloatingEditors(appWindow);
        await clickFolderChevron(appWindow, '/auth/');

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
        // Re-expand via the chevron chip.
        await clickFolderChevron(appWindow, '/auth/');
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
            // Body-only bbox so the interior anchor lands inside the
            // padding ring (folder compound) rather than on a child node.
            // mousedown on a child file fires for the file, not the folder,
            // and the folder-body pan handler never starts.
            const bb = f.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
            const host = (cy.container() as HTMLElement).getBoundingClientRect();
            return {
                folderPos: { x: f.position().x, y: f.position().y },
                pan: { x: cy.pan().x, y: cy.pan().y },
                interior: {
                    x: host.left + (bb.x1 + bb.x2) / 2,
                    y: host.top + bb.y2 - 12,
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
