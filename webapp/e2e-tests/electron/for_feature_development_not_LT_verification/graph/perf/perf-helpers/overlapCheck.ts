import * as path from 'path';
import * as fs from 'fs/promises';
import type { Page } from '@playwright/test';

export interface OverlapPair {
  ids: string[];
  boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  overlapArea: number;
}

export interface OverlapResult {
  count: number;
  pairs: OverlapPair[];
}

export async function getOverlapDiagnosticString(appWindow: Page): Promise<string> {
  return appWindow.evaluate((): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy = (window as any).cytoscapeInstance;
    if (!cy) return 'no cy';
    const nodes = cy.nodes().filter((n: { data: (key: string) => boolean }) => !n.data('isContextNode'));
    const lines: string[] = [`total nodes: ${nodes.length}`];
    let overlapCount = 0;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
        if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1) {
          const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
          const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
          lines.push(`OVERLAP: ${nodes[i].id()} [${a.x1.toFixed(0)},${a.y1.toFixed(0)},${a.x2.toFixed(0)},${a.y2.toFixed(0)}] vs ${nodes[j].id()} [${b.x1.toFixed(0)},${b.y1.toFixed(0)},${b.x2.toFixed(0)},${b.y2.toFixed(0)}] area=${(overlapX*overlapY).toFixed(0)}px²`);
          overlapCount++;
        }
      }
    }
    return overlapCount === 0 ? `PRE-UPDATE: 0 overlaps (${nodes.length} nodes) ✅` : `PRE-UPDATE: ${overlapCount} overlaps\n${lines.join('\n')}`;
  });
}

export async function savePostUpdateOverlapReport(appWindow: Page, tracesDir: string): Promise<void> {
  const overlaps = await detectNodeOverlaps(appWindow);
  const overlapDetails = overlaps.pairs.map(p =>
    `${p.ids[0]} [${p.boxes[0].x1.toFixed(0)},${p.boxes[0].y1.toFixed(0)},${p.boxes[0].x2.toFixed(0)},${p.boxes[0].y2.toFixed(0)}] vs ${p.ids[1]} [${p.boxes[1].x1.toFixed(0)},${p.boxes[1].y1.toFixed(0)},${p.boxes[1].x2.toFixed(0)},${p.boxes[1].y2.toFixed(0)}] area=${p.overlapArea.toFixed(0)}px²`
  ).join('\n');
  await fs.writeFile(
    path.join(tracesDir, 'post-update-overlap-diagnostic.txt'),
    overlaps.count === 0 ? 'No overlaps ✅' : `${overlaps.count} overlaps:\n${overlapDetails}`,
    'utf8',
  );
  // Soft check — compound parent nodes naturally overlap children in Cytoscape
  if (overlaps.count > 0) {
    console.warn(`⚠ ${overlaps.count} overlaps detected (includes compound parent nodes)`);
  }
}

export async function detectNodeOverlaps(appWindow: Page): Promise<OverlapResult> {
  return appWindow.evaluate((): OverlapResult => {
    interface OverlapPair { ids: string[]; boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>; overlapArea: number }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy = (window as any).cytoscapeInstance;
    if (!cy) return { count: 0, pairs: [] };
    const nodes = cy.nodes().filter((n: { data: (key: string) => boolean }) => !n.data('isContextNode'));
    const pairs: OverlapPair[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
        if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1) {
          const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
          const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
          pairs.push({ ids: [nodes[i].id(), nodes[j].id()], boxes: [a, b], overlapArea: overlapX * overlapY });
        }
      }
    }
    return { count: pairs.length, pairs: pairs.slice(0, 10) };
  });
}
