/**
 * Pan/zoom simulation for perf testing using REAL Playwright mouse wheel events.
 *
 * Replaces the old cy.panBy()/cy.zoom() approach which bypassed the real input
 * pipeline entirely (NavigationGestureService, DOM wheel events, floating window updates).
 *
 * Also measures FPS via requestAnimationFrame (rAF) and attempts to read
 * Cytoscape's native renderer FPS counter.
 */

import type { Page } from '@playwright/test';

export interface PanZoomFpsResult {
  rafFps: number;
  cytoscapeFps?: number;
  frameCount: number;
}

/**
 * Simulate realistic pan/zoom operations using real DOM mouse wheel events.
 * Returns FPS measurements from rAF and optionally Cytoscape's native counter.
 */
export async function simulatePanZoom(appWindow: Page): Promise<PanZoomFpsResult> {
  // Start rAF FPS measurement + log graph stats
  await appWindow.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy = (window as any).cytoscapeInstance;
    if (cy) {
      console.log(`[PanZoom] Nodes: ${cy.nodes().length}, Edges: ${cy.edges().length}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__pzFrameTimes = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__pzLastFrame = performance.now();
    const measure = () => {
      const now = performance.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__pzFrameTimes.push(now - (window as any).__pzLastFrame);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__pzLastFrame = now;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__pzRafId = requestAnimationFrame(measure);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__pzRafId = requestAnimationFrame(measure);
  });

  // Move mouse to viewport center before driving events
  const viewport = appWindow.viewportSize();
  const centerX = (viewport?.width ?? 1280) / 2;
  const centerY = (viewport?.height ?? 800) / 2;
  await appWindow.mouse.move(centerX, centerY);

  // 30 pan operations via mouse wheel (trackpad scroll simulation)
  for (let i = 0; i < 30; i++) {
    const dx = Math.round(150 * Math.sin(i * 0.4));
    const dy = Math.round(150 * Math.cos(i * 0.4));
    await appWindow.mouse.wheel(dx, dy);
    await appWindow.waitForTimeout(50);
  }

  // 10 zoom in/out cycles via Ctrl+wheel (trackpad pinch simulation)
  for (let i = 0; i < 10; i++) {
    await appWindow.keyboard.down('Control');
    await appWindow.mouse.wheel(0, -100); // zoom in
    await appWindow.keyboard.up('Control');
    await appWindow.waitForTimeout(50);
    await appWindow.keyboard.down('Control');
    await appWindow.mouse.wheel(0, 100); // zoom out
    await appWindow.keyboard.up('Control');
    await appWindow.waitForTimeout(50);
  }

  // 10 combined pan+zoom operations
  for (let i = 0; i < 10; i++) {
    const dx = Math.round(100 * Math.cos(i * 0.7));
    const dy = Math.round(-100 * Math.sin(i * 0.7));
    await appWindow.mouse.wheel(dx, dy);
    await appWindow.waitForTimeout(25);
    await appWindow.keyboard.down('Control');
    await appWindow.mouse.wheel(0, i % 2 === 0 ? -50 : 50);
    await appWindow.keyboard.up('Control');
    await appWindow.waitForTimeout(25);
  }

  // Wait for final render frames + edge-show timeout
  await appWindow.waitForTimeout(300);

  // Stop rAF measurement and collect results
  return appWindow.evaluate((): { rafFps: number; cytoscapeFps?: number; frameCount: number } => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cancelAnimationFrame((window as any).__pzRafId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const times: number[] = (window as any).__pzFrameTimes ?? [];
    const frameCount = times.length;

    let rafFps = 0;
    if (times.length >= 4) {
      // Drop first 2 and last 2 frames to stabilize measurement
      const trimmed = times.slice(2, -2);
      if (trimmed.length > 0) {
        const avg = trimmed.reduce((a: number, b: number) => a + b, 0) / trimmed.length;
        rafFps = Math.round(1000 / avg);
      }
    }

    // Try to read Cytoscape's native FPS counter from renderer internals
    let cytoscapeFps: number | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as any).cytoscapeInstance;
      if (cy) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renderer = (cy as any).renderer?.();
        if (typeof renderer?.fps === 'number') {
          cytoscapeFps = renderer.fps;
        } else if (typeof renderer?.averageRedrawTime === 'number' && renderer.averageRedrawTime > 0) {
          cytoscapeFps = Math.round(1000 / renderer.averageRedrawTime);
        }
      }
    } catch {
      // Ignore renderer read errors — native FPS is best-effort
    }

    return { rafFps, cytoscapeFps, frameCount };
  });
}
