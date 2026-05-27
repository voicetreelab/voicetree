import type { Page } from '@playwright/test';

export async function simulateSettledGraphPanZoom(appWindow: Page): Promise<void> {
  await appWindow.evaluate(async () => {
    interface CyPanZoom {
      panBy(p: { x: number; y: number }): void;
      zoom(o: { level: number; renderedPosition: { x: number; y: number } }): void;
      zoom(): number;
      width(): number;
      height(): number;
      nodes(): { length: number };
      edges(): { length: number };
    }
    interface ExtWindow { cytoscapeInstance?: CyPanZoom }
    const cy = (window as unknown as ExtWindow).cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance not available');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderer = (cy as unknown as { renderer: () => Record<string, any> }).renderer();

    const signalVpManip = () => {
      if (!renderer?.hideEdgesOnViewport) return;
      renderer.data.wheelZooming = true;
      if (renderer.data.wheelTimeout) clearTimeout(renderer.data.wheelTimeout);
      renderer.data.wheelTimeout = setTimeout(() => {
        renderer.data.wheelZooming = false;
        renderer.redrawHint('eles', true);
        renderer.redraw();
      }, 150);
    };

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    console.log(`[PanZoom] hideEdgesOnViewport: ${renderer?.hideEdgesOnViewport}`);
    console.log(`[PanZoom] Nodes: ${cy.nodes().length}, Edges: ${cy.edges().length}`);

    for (let i = 0; i < 30; i++) {
      signalVpManip();
      cy.panBy({ x: 150 * Math.sin(i * 0.4), y: 150 * Math.cos(i * 0.4) });
      await delay(50);
    }

    const center = { x: cy.width() / 2, y: cy.height() / 2 };
    for (let i = 0; i < 10; i++) {
      signalVpManip();
      cy.zoom({ level: (cy.zoom as () => number)() * 1.3, renderedPosition: center });
      await delay(50);
      signalVpManip();
      cy.zoom({ level: (cy.zoom as () => number)() / 1.3, renderedPosition: center });
      await delay(50);
    }

    for (let i = 0; i < 10; i++) {
      signalVpManip();
      cy.panBy({ x: 100 * Math.cos(i * 0.7), y: -100 * Math.sin(i * 0.7) });
      cy.zoom({ level: (cy.zoom as () => number)() * (i % 2 === 0 ? 1.1 : 0.9), renderedPosition: center });
      await delay(50);
    }

    await delay(300);
    console.log(`[PanZoom] Final zoom level: ${(cy.zoom as () => number)().toFixed(3)}`);
  });
}
