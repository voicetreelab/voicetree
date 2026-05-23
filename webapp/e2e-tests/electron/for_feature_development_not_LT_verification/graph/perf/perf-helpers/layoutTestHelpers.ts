/**
 * Shared layout test helpers for Electron e2e tests.
 *
 * Pure helpers for node bounds capture, bbox computation, gap scoring,
 * and layout-stability polling. Used by electron-rbush-packing and
 * electron-polyomino-separation tests.
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';

// ============================================================================
// Shared types
// ============================================================================

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
}

export interface NodeBounds {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ============================================================================
// Pure helpers
// ============================================================================

/** Capture bounds of all non-context nodes in the graph. */
export async function captureNodeBounds(appWindow: Page): Promise<NodeBounds[]> {
  return appWindow.evaluate((): NodeBounds[] => {
    const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance;
    if (!cy) return [];
    // forEach on NodeCollection types `n` as NodeSingular (has .position())
    const result: NodeBounds[] = [];
    cy.nodes().forEach((n) => {
      if (n.data('isContextNode')) return;
      result.push({
        id: n.id(),
        x: n.position('x'),
        y: n.position('y'),
        // Minimum 40px dimensions for headless Electron (CSS may not load node styles)
        w: Math.max(n.width(), 40),
        h: Math.max(n.height(), 30),
      });
    });
    return result;
  });
}

/** Compute the axis-aligned bounding box of a set of node bounds. */
export function computeBbox(nodes: NodeBounds[]): ComponentBbox {
  return nodes.reduce(
    (bbox, n) => ({
      minX: Math.min(bbox.minX, n.x - n.w / 2),
      minY: Math.min(bbox.minY, n.y - n.h / 2),
      maxX: Math.max(bbox.maxX, n.x + n.w / 2),
      maxY: Math.max(bbox.maxY, n.y + n.h / 2),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

/**
 * Signed gap between two axis-aligned bboxes.
 * Negative = overlap. Zero = touching. Positive = separated.
 */
export function bboxGap(a: ComponentBbox, b: ComponentBbox): number {
  const xOverlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const yOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (xOverlap >= 0 && yOverlap >= 0) return -Math.min(xOverlap, yOverlap);
  if (xOverlap < 0 && yOverlap < 0) return Math.sqrt(xOverlap * xOverlap + yOverlap * yOverlap);
  if (xOverlap < 0) return -xOverlap;
  return -yOverlap;
}

/**
 * Wait for layout to stabilize: positions must have changed from `initialSnapshot`
 * AND must stop changing for two consecutive polls.
 *
 * `initialSnapshot` prevents a false-positive return before the 300ms debounce fires.
 */
export async function waitForLayoutStable(
  appWindow: Page,
  initialSnapshot: string,
  message = 'Waiting for layout to run and stabilize',
): Promise<void> {
  let lastSnapshot = '';

  await expect
    .poll(
      async () => {
        const bounds = await captureNodeBounds(appWindow);
        const snap = JSON.stringify(bounds.map((b) => [Math.round(b.x), Math.round(b.y)]));
        const changedFromInitial = snap !== initialSnapshot;
        const stoppedMoving = snap === lastSnapshot && lastSnapshot !== '';
        lastSnapshot = snap;
        return changedFromInitial && stoppedMoving;
      },
      {
        message,
        timeout: 20000,
        intervals: [500, 500, 500, 1000, 1000, 1000, 1000, 1000],
      }
    )
    .toBe(true);
}
