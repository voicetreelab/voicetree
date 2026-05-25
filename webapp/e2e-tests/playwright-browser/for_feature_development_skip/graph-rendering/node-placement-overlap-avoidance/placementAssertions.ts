import { expect, type Page } from '@playwright/test';
import { type ExtendedWindow } from '@e2e/playwright-browser/graph-delta-test-utils';

export interface NodeBBox {
  readonly id: string;
  readonly x1: number;
  readonly x2: number;
  readonly y1: number;
  readonly y2: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Get all node bounding boxes from cytoscape.
 */
export async function getAllNodeBBoxes(page: Page): Promise<NodeBBox[]> {
  return page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return [];
    return cy.nodes().map((node) => {
      const pos = node.position();
      const w = node.width();
      const h = node.height();
      return {
        id: node.id(),
        x1: pos.x - w / 2,
        x2: pos.x + w / 2,
        y1: pos.y - h / 2,
        y2: pos.y + h / 2,
        width: w,
        height: h,
      };
    });
  });
}

/**
 * AABB overlap check between two bounding boxes.
 */
function rectsOverlap(a: NodeBBox, b: NodeBBox): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/**
 * Assert that no two node bounding boxes overlap.
 * Logs all node positions for debugging on failure.
 */
export function assertNoOverlaps(bboxes: NodeBBox[]): void {
  const overlaps: string[] = [];
  for (let i = 0; i < bboxes.length; i++) {
    for (let j = i + 1; j < bboxes.length; j++) {
      const a = bboxes[i];
      const b = bboxes[j];
      if (rectsOverlap(a, b)) {
        overlaps.push(
          `"${a.id}" [${a.x1.toFixed(0)},${a.y1.toFixed(0)} -> ${a.x2.toFixed(0)},${a.y2.toFixed(0)}] intersects ` +
          `"${b.id}" [${b.x1.toFixed(0)},${b.y1.toFixed(0)} -> ${b.x2.toFixed(0)},${b.y2.toFixed(0)}]`
        );
      }
    }
  }
  expect(overlaps, `Found ${overlaps.length} overlapping node pairs:\n${overlaps.join('\n')}`).toHaveLength(0);
}

export function createTargetSizedBBoxes(
  positions: readonly { readonly x: number; readonly y: number }[],
  parentId: string,
  childIdPrefix: string,
  targetSize: number
): NodeBBox[] {
  return positions.map((pos, i) => ({
    id: i === 0 ? parentId : `${childIdPrefix}_${i - 1}.md`,
    x1: pos.x - targetSize / 2,
    x2: pos.x + targetSize / 2,
    y1: pos.y - targetSize / 2,
    y2: pos.y + targetSize / 2,
    width: targetSize,
    height: targetSize,
  }));
}
