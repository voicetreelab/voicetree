/**
 * BEHAVIORAL SPEC:
 * Two-finger trackpad pan must work when the cursor is inside an expanded
 * folder body. Regression target: per-frame folder-handle work on `pan zoom`
 * events stalls the main thread during high-frequency wheel input, causing
 * the canvas to freeze even though pan events keep arriving.
 *
 * Strategy (per first-principles design):
 *   1. Flip the IPC trackpad flag to true via the existing uiAPI proxy
 *      (main process side) so NavigationGestureService routes the burst to
 *      the pan branch instead of zoomAtCursor.
 *   2. Dispatch synthetic wheel events shaped like real trackpad input
 *      (deltaMode:0, fractional deltaY, |deltaY|<50, non-zero deltaX,
 *      ctrlKey:false) at coordinates *inside* the folder bbox.
 *   3. Assert observable side effect: cy.pan() moved by ≈ sum of deltas.
 *   4. Probe rAF count during the burst to catch main-thread saturation —
 *      pan delta alone passes even if framerate collapses.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
    type ExtendedWindow,
    createFolderTestProject,
    waitForGraphLoaded,
} from '@e2e/electron/for_feature_development_not_LT_verification/graph/folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'e2e-tests/screenshots');

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-trackpad-pan-test-'));
        const projectRoot = await createFolderTestProject(tempDir);
        await fs.writeFile(
            path.join(projectRoot, 'auth', 'index.md'),
            `---\nposition:\n  x: 50\n  y: 120\n---\n# Auth Folder Note\n`,
        );
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-trackpad-pan-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: projectRoot,
            projectConfig: {
                [projectRoot]: { writeFolderPath: projectRoot, readPaths: [] },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'trackpad-pan-test',
            path: projectRoot,
            name: 'trackpad-pan-test-project',
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

        // Best-effort cleanup with a hard ceiling — when a test fails
        // playwright sometimes keeps the window open for trace capture and
        // electronApp.close() hangs past the worker teardown budget.
        await Promise.race([
            (async () => {
                try {
                    const window = await electronApp.firstWindow();
                    await window.evaluate(async () => {
                        const api = (window as unknown as ExtendedWindow).electronAPI;
                        if (api) await api.main.stopFileWatching();
                    });
                } catch {
                    // ignore — we still try to close below
                }
                await electronApp.close();
            })(),
            new Promise<void>(resolve => setTimeout(resolve, 8000)),
        ]);

        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 20000 });
        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
        await window.locator('button:has-text("trackpad-pan-test-project")').first().click();
        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 },
        );
        await window.waitForTimeout(3000);
        await use(window);
    },
});

interface FolderAnchor {
    readonly x: number;
    readonly y: number;
    readonly hostX: number;
    readonly hostY: number;
    readonly hostW: number;
    readonly hostH: number;
}

async function getFolderInteriorAnchor(appWindow: Page, folderId: string): Promise<FolderAnchor> {
    return appWindow.evaluate((id: string) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('No cytoscapeInstance');
        const folder = cy.getElementById(id);
        if (folder.length === 0) throw new Error(`No folder ${id}`);
        const bb = folder.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        const host = (cy.container() as HTMLElement).getBoundingClientRect();
        // Center of folder body, slightly off-center to dodge the TL chevron region.
        return {
            x: host.left + (bb.x1 + bb.x2) / 2,
            y: host.top + bb.y1 + bb.h * 0.6,
            hostX: host.left,
            hostY: host.top,
            hostW: host.width,
            hostH: host.height,
        };
    }, folderId);
}

/**
 * Flip the renderer's trackpad flag to `true` by reaching into the main process
 * and sending the same IPC the native trackpad detector would. Production code
 * stays untouched.
 */
async function setRendererTrackpadFlag(
    electronApp: ElectronApplication,
    value: boolean,
): Promise<void> {
    await electronApp.evaluate(({ BrowserWindow }, isOn) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
            throw new Error('No live BrowserWindow to send ui:call');
        }
        win.webContents.send('ui:call', 'setIsTrackpadScrolling', [isOn]);
    }, value);
    // IPC is async; let the renderer flip the module flag before we fire wheels.
    await new Promise(resolve => setTimeout(resolve, 200));
}

interface BurstResult {
    panBefore: { x: number; y: number };
    panAfter: { x: number; y: number };
    expectedDx: number;
    expectedDy: number;
    rafCount: number;
    elapsedMs: number;
    eventsDispatched: number;
}

/**
 * Dispatch a paced burst of trackpad-shaped wheel events at the given screen
 * coordinates, then return pan-delta + rAF count.
 *
 * Pacing: setTimeout(0) between events approximates real trackpad cadence
 * (~120 Hz on macOS) under the main-thread budget. If the thread saturates,
 * the rAF count drops below the wall-clock expectation.
 */
async function dispatchTrackpadPanBurst(
    appWindow: Page,
    anchor: { x: number; y: number },
    eventCount: number,
    deltaXPerEvent: number,
    deltaYPerEvent: number,
): Promise<BurstResult> {
    return appWindow.evaluate(
        async ({ x, y, n, dx, dy }) => {
            const cyAny = (window as unknown as { cytoscapeInstance?: { pan: () => { x: number; y: number } } }).cytoscapeInstance;
            if (!cyAny) throw new Error('No cytoscapeInstance');
            const panBefore = { x: cyAny.pan().x, y: cyAny.pan().y };

            const el = document.elementFromPoint(x, y) as HTMLElement | null;
            if (!el) throw new Error(`No element at ${x},${y}`);

            // rAF probe — counts frames during the burst.
            let rafCount = 0;
            let stop = false;
            const tick = (): void => {
                if (stop) return;
                rafCount++;
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);

            const t0 = performance.now();
            let dispatched = 0;
            for (let i = 0; i < n; i++) {
                // Real trackpad sends fractional deltas; jitter them slightly so
                // looksLikeMouseWheel's Number.isInteger() check stays false.
                const jitterY = dy + (i % 5) * 0.13;
                const jitterX = dx + (i % 7) * 0.07;
                el.dispatchEvent(new WheelEvent('wheel', {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    deltaX: jitterX,
                    deltaY: jitterY,
                    deltaMode: 0,
                    ctrlKey: false,
                    shiftKey: false,
                }));
                dispatched++;
                // Yield to event loop / paint — mirrors real wheel cadence.
                await new Promise(r => setTimeout(r, 0));
            }
            // Let any trailing rAF callbacks land.
            await new Promise(r => setTimeout(r, 50));
            stop = true;

            const panAfter = { x: cyAny.pan().x, y: cyAny.pan().y };
            const elapsedMs = performance.now() - t0;

            // Production code applies: pan' = pan - delta (per dispatchSetPan call)
            return {
                panBefore,
                panAfter,
                expectedDx: -dx * n,
                expectedDy: -dy * n,
                rafCount,
                elapsedMs,
                eventsDispatched: dispatched,
            };
        },
        {
            x: anchor.x,
            y: anchor.y,
            n: eventCount,
            dx: deltaXPerEvent,
            dy: deltaYPerEvent,
        },
    );
}

test.describe('Trackpad two-finger pan over folder body', () => {
    test('pans the graph and does not saturate the main thread', async ({
        appWindow,
        electronApp,
        projectRoot,
    }) => {
        test.setTimeout(90000);

        const authFolderId = `${path.join(projectRoot, 'auth')}/`;
        await waitForGraphLoaded(appWindow, 3);

        await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) return;
            cy.fit(undefined, 60);
        });
        await appWindow.waitForTimeout(600);

        // Sanity: the auth folder is expanded and has children.
        const baseline = await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
            const f = cy.getElementById(id);
            return {
                exists: f.length > 0,
                isFolderNode: f.data('isFolderNode') === true,
                collapsed: (f.data('collapsed') as boolean) ?? false,
                childCount: f.children().length,
            };
        }, authFolderId);
        expect(baseline.exists).toBe(true);
        expect(baseline.isFolderNode).toBe(true);
        expect(baseline.collapsed).toBe(false);
        expect(baseline.childCount).toBeGreaterThan(0);

        const anchor = await getFolderInteriorAnchor(appWindow, authFolderId);

        // Park the OS cursor over the anchor so any internal hover-driven
        // listeners reflect a realistic "two fingers on the trackpad" state.
        await appWindow.mouse.move(anchor.x, anchor.y, { steps: 4 });
        await appWindow.waitForTimeout(150);

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'trackpad-pan-folder-1-before.png'),
        });

        // Flip the renderer's trackpad flag via the existing IPC channel.
        await setRendererTrackpadFlag(electronApp, true);

        // Burst: 60 events × 1 setTimeout(0) ≈ ~1s of trackpad input.
        //   deltaX ≈ 2.3 px/event, deltaY ≈ 4.7 px/event → total ≈ (-138, -282)
        const result = await dispatchTrackpadPanBurst(
            appWindow,
            anchor,
            60,
            2.3,
            4.7,
        );

        await setRendererTrackpadFlag(electronApp, false);

        await appWindow.screenshot({
            path: path.join(SCREENSHOT_DIR, 'trackpad-pan-folder-2-after.png'),
        });

        const panDx = result.panAfter.x - result.panBefore.x;
        const panDy = result.panAfter.y - result.panBefore.y;
        const expectedRafs = Math.max(8, Math.floor(result.elapsedMs * 0.045)); // ≥45 fps of effective wall-clock

        console.log('[TRACKPAD PAN]', {
            panBefore: result.panBefore,
            panAfter: result.panAfter,
            panDx,
            panDy,
            expectedDx: result.expectedDx,
            expectedDy: result.expectedDy,
            rafCount: result.rafCount,
            expectedRafs,
            elapsedMs: result.elapsedMs,
            eventsDispatched: result.eventsDispatched,
        });

        // 1. Pan actually moved (regression: stays at 0 because main thread froze).
        expect(Math.abs(panDx) + Math.abs(panDy)).toBeGreaterThan(50);

        // 2. Pan moved in the right direction (sign matches dispatchSetPan formula).
        expect(Math.sign(panDx)).toBe(Math.sign(result.expectedDx));
        expect(Math.sign(panDy)).toBe(Math.sign(result.expectedDy));

        // 3. Pan magnitude is at least 30 % of expected — generous because:
        //    - Store→cy bridge coalesces fast pan dispatches into rAF batches
        //    - First few events can land before the IPC trackpad flag settles
        //    The regression keeps this near 0; a working fix lands well above.
        expect(Math.abs(panDx)).toBeGreaterThan(Math.abs(result.expectedDx) * 0.3);
        expect(Math.abs(panDy)).toBeGreaterThan(Math.abs(result.expectedDy) * 0.3);

        // 4. Main thread was not saturated — rAF kept ticking during the burst.
        //    Soft so the run captures pan correctness even on a CI box that's
        //    inherently slow; a hard failure here is the smoking gun for the
        //    "folder-handle per-frame work hangs the canvas" regression.
        expect.soft(result.rafCount).toBeGreaterThan(expectedRafs);
    });
});

export { test };
