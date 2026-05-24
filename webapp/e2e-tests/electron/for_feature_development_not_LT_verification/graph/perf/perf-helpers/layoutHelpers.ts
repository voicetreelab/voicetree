import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function waitForLayoutStable(appWindow: Page, timeoutMs: number = 60000): Promise<void> {
  let lastSnapshot = '';

  await expect
    .poll(
      async () => {
        const snap = await appWindow.evaluate((): string => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cy = (window as any).cytoscapeInstance;
          if (!cy) return '';
          const positions: Array<[number, number]> = [];
          cy.nodes().forEach((n: { data(k: string): boolean; position(axis: string): number }) => {
            if (!n.data('isContextNode')) {
              positions.push([Math.round(n.position('x')), Math.round(n.position('y'))]);
            }
          });
          return JSON.stringify(positions);
        });
        const stoppedMoving = snap === lastSnapshot && lastSnapshot !== '';
        lastSnapshot = snap;
        return stoppedMoving;
      },
      {
        message: 'Waiting for layout to stabilize',
        timeout: timeoutMs,
        intervals: [1000, 1000, 2000, 2000, 2000, 3000, 3000, 3000, 5000, 5000],
      }
    )
    .toBe(true);
}
