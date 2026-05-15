/**
 * Compute Cola layout synchronously, then smoothly animate nodes to final positions.
 * Avoids Cola's frame-1 teleport caused by synchronous initial constraint iterations.
 *
 * Uses a single requestAnimationFrame loop with batched position updates instead of
 * N individual node.animate() calls. This avoids WebGL texture atlas thrashing where
 * each per-node position update would trigger a separate GPU buffer + atlas rebuild.
 * Completion is frame-based (fires when animation actually finishes), not setTimeout-based.
 */

import type { Core, NodeSingular, CollectionReturnValue } from 'cytoscape';
import ColaLayout from './cola';

/** Cubic ease-in-out: smooth acceleration and deceleration */
const easeInOutCubic: (t: number) => number = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const computeColaAndAnimate: (
  colaLayoutOpts: Record<string, unknown>,
  nodes: CollectionReturnValue,
  duration: number,
  onComplete: () => void
) => void = (colaLayoutOpts, nodes, duration, onComplete) => {
  // Guard against double-completion from rAF + safety timer race
  let completed: boolean = false;
  const safeComplete: () => void = () => {
    if (completed) return;
    completed = true;
    if (safetyTimer !== null) clearTimeout(safetyTimer);
    onComplete();
  };

  // Safety timer: if rAF loop doesn't complete (WebGL context loss, error, background tab),
  // force completion so the layout system doesn't permanently stall.
  let safetyTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    safetyTimer = null;
    safeComplete();
  }, duration + 1000);

  const startPos: Map<string, { x: number; y: number }> = new Map();
  nodes.forEach((n: NodeSingular) => { startPos.set(n.id(), { ...n.position() }); });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layout: any = new (ColaLayout as any)({ ...colaLayoutOpts, animate: false });

  layout.one('layoutstop', () => {
    const endPos: Map<string, { x: number; y: number }> = new Map();
    nodes.forEach((n: NodeSingular) => { endPos.set(n.id(), { ...n.position() }); });

    // Reset to original positions
    nodes.forEach((n: NodeSingular) => {
      const s: { x: number; y: number } | undefined = startPos.get(n.id());
      if (s) n.position(s);
    });

    // Single rAF loop with batched position updates — all nodes interpolated per frame
    // inside cy.startBatch()/endBatch() so the WebGL renderer gets one draw call per frame
    const cy: Core = colaLayoutOpts.cy as Core;
    const startTime: number = performance.now();

    const animateFrame: () => void = () => {
      try {
        const elapsed: number = performance.now() - startTime;
        const rawProgress: number = Math.min(elapsed / duration, 1);
        const progress: number = easeInOutCubic(rawProgress);

        cy.startBatch();
        nodes.forEach((n: NodeSingular) => {
          const s: { x: number; y: number } | undefined = startPos.get(n.id());
          const e: { x: number; y: number } | undefined = endPos.get(n.id());
          if (s && e) {
            n.position({
              x: s.x + (e.x - s.x) * progress,
              y: s.y + (e.y - s.y) * progress
            });
          }
        });
        cy.endBatch();

        if (rawProgress < 1) {
          requestAnimationFrame(animateFrame);
        } else {
          safeComplete();
        }
      } catch (err: unknown) {
        console.error('[computeColaAndAnimate] rAF animation error, forcing completion:', err);
        safeComplete();
      }
    };

    requestAnimationFrame(animateFrame);
  });
  layout.run();
};
