/**
 * Regression test for zoom teleportation bug:
 * After clicking an agent (triggering fitToTerminal which animates viewport via cy.animate),
 * the next wheel-zoom causes the viewport to teleport to wrong coordinates because
 * NavigationGestureService.currentZoom is stale.
 *
 * Reproduction:
 * 1. Load graph, record viewport
 * 2. Trigger fitToTerminal (simulates clicking an agent tab)
 * 3. Wait for animation to complete
 * 4. Record post-fit viewport
 * 5. Zoom via Ctrl+wheel at viewport center
 * 6. Assert: pan did NOT jump to wildly different coordinates (teleport)
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import { createFolderTestVault, waitForGraphLoaded } from '../folder/folder-test-helpers';
import { captureViewportDiagnostic, type ExtendedWindow } from '../perf/pan-zoom-diagnostic-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

interface WindowWithGraph extends ExtendedWindow {
  voiceTreeGraphView?: {
    navigateToNodeAndTrack: (nodeId: string) => void;
    navigationService: {
      setLastCreatedNodeId: (nodeId: string) => void;
      fitToLastNode: () => void;
      cycleTerminal: (direction: 1 | -1) => void;
      fitToTerminal: (terminal: unknown) => void;
    };
  };
}

const test = base.extend<{ electronApp: ElectronApplication; appWindow: Page; projectRoot: string }>({
  projectRoot: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-zoom-teleport-'));
    const projectRoot = await createFolderTestVault(tempDir);
    await use(projectRoot);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ projectRoot }, use) => {
    const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-zoom-teleport-ud-'));

    await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
      lastDirectory: projectRoot,
      vaultConfig: {
        [projectRoot]: {
          writeFolderPath: projectRoot,
          readPaths: [],
        },
      },
    }, null, 2), 'utf8');

    await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
      id: 'zoom-teleport-test',
      path: projectRoot,
      name: 'zoom-teleport-vault',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true,
    }], null, 2), 'utf8');

    const app = await electron.launch({
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
      timeout: 15000,
    });

    await use(app);

    try {
      const window = await app.firstWindow();
      await window.evaluate(async () => {
        await (window as unknown as ExtendedWindow).electronAPI?.main.stopFileWatching();
      });
      await window.waitForTimeout(300);
    } catch {
      // Best-effort cleanup
    }

    await app.close();
    await fs.rm(tempUserData, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, projectRoot }, use) => {
    const window = await electronApp.firstWindow({ timeout: 20000 });

    window.on('console', msg => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
      }
    });
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await window.evaluate(async (targetProjectRoot: string) => {
      await (window as unknown as ExtendedWindow).electronAPI?.main.startFileWatching(targetProjectRoot);
    }, projectRoot);

    await window.waitForFunction(() => !!(window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 30000 });
    await window.waitForTimeout(3000);

    await use(window);
  },
});

test.describe('Zoom After Agent Click - Teleport Bug', () => {
  test('zoom after fitToTerminal does not teleport viewport', async ({ appWindow }) => {
    await waitForGraphLoaded(appWindow, 3);

    // Pick a regular node to spawn a terminal on
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance!;
      const candidates = cy.nodes().filter((n: NodeSingular) =>
        !n.data('isFolderNode') && !n.data('isShadowNode') && !n.data('isContextNode')
      );
      return candidates[0].id();
    });

    // Spawn a terminal on the node
    await appWindow.evaluate(async (nodeId: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api?.main) throw new Error('electronAPI.main not available');
      await api.main.spawnPlainTerminal(nodeId, 0);
    }, targetNodeId);

    await expect(appWindow.locator('.cy-floating-window-terminal')).toBeVisible({ timeout: 5000 });

    // ZOOM IN via wheel events to set NavigationGestureService.currentZoom high.
    // This is critical: using wheel events (not cy.zoom) ensures the gesture service
    // tracks the zoom internally via applyZoomAnchored.
    const viewport = appWindow.viewportSize();
    const centerX = (viewport?.width ?? 1280) / 2;
    const centerY = (viewport?.height ?? 800) / 2;
    await appWindow.mouse.move(centerX, centerY);

    for (let i = 0; i < 15; i++) {
      await appWindow.keyboard.down('Control');
      await appWindow.mouse.wheel(0, -100);
      await appWindow.keyboard.up('Control');
      await appWindow.waitForTimeout(60);
    }
    await appWindow.waitForTimeout(500);

    const beforeFit = await captureViewportDiagnostic(appWindow);
    console.log(`Before fit (zoomed via wheel): zoom=${beforeFit.zoom.toFixed(3)}`);

    // Now fitToTerminal (simulates clicking an agent tab).
    // This animates viewport to a DIFFERENT zoom via cy.animate,
    // which does NOT update NavigationGestureService.currentZoom.
    await appWindow.evaluate(() => {
      const graphView = (window as unknown as WindowWithGraph).voiceTreeGraphView;
      if (!graphView) throw new Error('voiceTreeGraphView not available');
      graphView.navigationService.cycleTerminal(1);
    });

    // Wait for 300ms animation + buffer
    await appWindow.waitForTimeout(600);

    const afterFit = await captureViewportDiagnostic(appWindow);
    console.log(`After fit: zoom=${afterFit.zoom.toFixed(3)}, pan=(${afterFit.pan.x.toFixed(0)}, ${afterFit.pan.y.toFixed(0)})`);

    // Capture zoom after FIRST zoom-in event post-fit to detect single-step teleport
    await appWindow.keyboard.down('Control');
    await appWindow.mouse.wheel(0, -50);
    await appWindow.keyboard.up('Control');
    await appWindow.waitForTimeout(300);

    const afterFirstZoom = await captureViewportDiagnostic(appWindow);
    console.log(`After first post-fit zoom: zoom=${afterFirstZoom.zoom.toFixed(3)}`);

    // CRITICAL ASSERTION: First zoom step should not jump by more than 50% of afterFit.zoom.
    // Normal: < 5% change due to clamping.
    // Teleport: zoom jumps from afterFit.zoom toward beforeFit.zoom (which could be 5x+ higher)
    const firstStepChange = Math.abs(afterFirstZoom.zoom - afterFit.zoom) / afterFit.zoom;
    console.log(`First zoom step change: ${(firstStepChange * 100).toFixed(1)}% of post-fit zoom`);

    expect(firstStepChange).toBeLessThan(0.5);
  });

  test('zoom after search navigation does not teleport viewport', async ({ appWindow }) => {
    await waitForGraphLoaded(appWindow, 3);

    // Set a very low starting zoom to create a large discrepancy
    // (navigation will zoom IN to fit the target node at 40% of viewport)
    await appWindow.evaluate(() => {
      const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance!;
      cy.zoom(0.15);
      cy.pan({ x: -2000, y: -2000 });
    });
    await appWindow.waitForTimeout(200);

    const beforeNav = await captureViewportDiagnostic(appWindow);
    console.log(`Before nav: zoom=${beforeNav.zoom.toFixed(3)}`);

    // Navigate to a node via search (uses cyFitWithRelativeZoom → cy.animate)
    await appWindow.evaluate(() => {
      const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance!;
      const graphView = (window as unknown as WindowWithGraph).voiceTreeGraphView;
      if (!graphView) throw new Error('voiceTreeGraphView not available');
      const node = cy.nodes().filter((n: NodeSingular) =>
        !n.data('isFolderNode') && !n.data('isShadowNode') && !n.data('isContextNode')
      )[0];
      graphView.navigateToNodeAndTrack(node.id());
    });

    // Wait for animation
    await appWindow.waitForTimeout(600);

    const afterNav = await captureViewportDiagnostic(appWindow);
    console.log(`After nav: zoom=${afterNav.zoom.toFixed(3)}, pan=(${afterNav.pan.x.toFixed(0)}, ${afterNav.pan.y.toFixed(0)})`);

    // Capture zoom after FIRST wheel event to detect a single-step teleport
    const viewport = appWindow.viewportSize();
    const centerX = (viewport?.width ?? 1280) / 2;
    const centerY = (viewport?.height ?? 800) / 2;
    await appWindow.mouse.move(centerX, centerY);

    await appWindow.keyboard.down('Control');
    await appWindow.mouse.wheel(0, -50);
    await appWindow.keyboard.up('Control');
    await appWindow.waitForTimeout(300);

    const afterFirstZoom = await captureViewportDiagnostic(appWindow);
    console.log(`After first zoom event: zoom=${afterFirstZoom.zoom.toFixed(3)}`);

    // CRITICAL ASSERTION: The first zoom event should NOT cause a large zoom jump.
    // Normal: zoom changes by < 30% in one step (due to initial clamping, even less).
    // Teleport bug: zoom jumps from afterNav to something near beforeNav (0.15).
    const firstZoomChange = Math.abs(afterFirstZoom.zoom - afterNav.zoom) / afterNav.zoom;
    console.log(`First zoom step relative change: ${(firstZoomChange * 100).toFixed(1)}%`);

    // With clamping, first event changes zoom by < 5%. Even without clamping, < 30%.
    // Teleport would be a jump of 100%+ (back toward 0.15 from ~2.0)
    expect(firstZoomChange).toBeLessThan(0.5);

    // Do more zoom events
    for (let i = 0; i < 5; i++) {
      await appWindow.keyboard.down('Control');
      await appWindow.mouse.wheel(0, -50);
      await appWindow.keyboard.up('Control');
      await appWindow.waitForTimeout(80);
    }
    await appWindow.waitForTimeout(300);

    const afterZoom = await captureViewportDiagnostic(appWindow);
    console.log(`After all zoom events: zoom=${afterZoom.zoom.toFixed(3)}`);

    // Final zoom should be within 2x of afterNav (we zoomed in, not teleported)
    expect(afterZoom.zoom).toBeGreaterThan(afterNav.zoom * 0.5);
    expect(afterZoom.zoom).toBeLessThan(afterNav.zoom * 3.0);

    // Pan drift proportional to zoom change is normal; teleport is 2000+
    const panDeltaX = Math.abs(afterZoom.pan.x - afterNav.pan.x);
    const panDeltaY = Math.abs(afterZoom.pan.y - afterNav.pan.y);

    console.log(`Pan delta: dx=${panDeltaX.toFixed(0)}, dy=${panDeltaY.toFixed(0)}`);

    expect(panDeltaX).toBeLessThan(1500);
    expect(panDeltaY).toBeLessThan(1500);
  });
});

export { test };
