/**
 * Compute Cola layout synchronously, then smoothly animate nodes to final positions.
 * Avoids Cola's frame-1 teleport caused by synchronous initial constraint iterations.
 */

import type { NodeSingular, CollectionReturnValue } from 'cytoscape';
import ColaLayout from './cola';

export const computeColaAndAnimate: (
  colaLayoutOpts: Record<string, unknown>,
  nodes: CollectionReturnValue,
  duration: number,
  onComplete: () => void
) => void = (colaLayoutOpts, nodes, duration, onComplete) => {
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

    // Animate to computed final positions
    nodes.forEach((n: NodeSingular) => {
      const e: { x: number; y: number } | undefined = endPos.get(n.id());
      if (e) n.animate({ position: e }, { duration, easing: 'ease-in-out-cubic' });
    });

    setTimeout(() => {
      // panToTrackedNode(colaLayoutOpts.cy as Core);
      onComplete();
    }, duration + 16);
  });
  layout.run();
};
