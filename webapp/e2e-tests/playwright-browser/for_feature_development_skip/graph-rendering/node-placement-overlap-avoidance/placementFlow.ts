import { type Page } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';

export async function setupGraphView(page: Page): Promise<void> {
  await setupMockElectronAPI(page);
  await page.goto('/');
  await selectMockProject(page);
  await waitForCytoscapeReady(page);
}

export async function waitForNodeCount(page: Page, count: number): Promise<void> {
  await page.waitForFunction((expectedCount: number) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    return cy && cy.nodes().length >= expectedCount;
  }, count, { timeout: 5000 });
}

export async function calculateCollisionFreeChildPosition(
  page: Page,
  parentId: string,
  childIndex: number
): Promise<{ x: number; y: number }> {
  return page.evaluate(async (args: { parentId: string; childIndex: number }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obstacleModule = await import('/src/shell/edge/UI-edge/floating-windows/anchoring/extractObstaclesFromCytoscape.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const positionModule = await import('/src/pure/graph/positioning/findBestPosition.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const angularModule = await import('/src/pure/graph/positioning/angularPositionSeeding.ts' as any);

    const { extractObstaclesFromCytoscape, extractEdgeSegmentsFromCytoscape } = obstacleModule;
    const { findBestPosition } = positionModule;
    const { calculateChildAngle, DEFAULT_EDGE_LENGTH } = angularModule;

    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape instance not available');

    const parentNode = cy.getElementById(args.parentId);
    if (parentNode.length === 0) throw new Error(`Parent node ${args.parentId} not found`);

    const parentPos = parentNode.position();
    const obstacles = extractObstaclesFromCytoscape(cy, args.parentId);
    const edgeSegments = extractEdgeSegmentsFromCytoscape(cy, args.parentId);
    const desiredAngle = calculateChildAngle(args.childIndex, undefined);

    return findBestPosition(
      parentPos,
      desiredAngle,
      DEFAULT_EDGE_LENGTH,
      { width: 250, height: 250 },
      obstacles,
      undefined,
      edgeSegments
    );
  }, { parentId, childIndex });
}

export async function fitGraphToView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (cy) cy.fit(undefined, 50);
  });
}
