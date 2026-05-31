import { describe, expect, it } from 'vitest';
import { computeForestLayout, type ForestEdge, type ForestNode } from './mindmapForest';

// Counts pairs of nodes whose axis-aligned boxes (centred at the returned x/y,
// sized by the node's size) overlap on BOTH axes by more than epsilon.
const countOverlaps = (
  nodes: readonly ForestNode[],
  positions: readonly { readonly id: string; readonly x: number; readonly y: number }[],
  epsilon: number,
): number => {
  const sizeById = new Map(nodes.map((node) => [node.id, node.size]));
  const boxes = positions.map((position) => {
    const [width, height] = sizeById.get(position.id) ?? [0, 0];
    return { x1: position.x - width / 2, x2: position.x + width / 2, y1: position.y - height / 2, y2: position.y + height / 2 };
  });
  let overlaps = 0;
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const overlapX = Math.min(boxes[left].x2, boxes[right].x2) - Math.max(boxes[left].x1, boxes[right].x1);
      const overlapY = Math.min(boxes[left].y2, boxes[right].y2) - Math.max(boxes[left].y1, boxes[right].y1);
      if (overlapX > epsilon && overlapY > epsilon) overlaps += 1;
    }
  }
  return overlaps;
};

const uniformNodes = (ids: readonly string[], size: readonly [number, number]): readonly ForestNode[] =>
  ids.map((id) => ({ id, size }));

describe('computeForestLayout', () => {
  it('places every node exactly once with finite coordinates', () => {
    const nodes = uniformNodes(['a', 'b', 'c', 'd'], [40, 40]);
    const edges: ForestEdge[] = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
    const positions = computeForestLayout(nodes, edges, 60);
    expect(new Set(positions.map((p) => p.id))).toEqual(new Set(['a', 'b', 'c', 'd']));
    positions.forEach((p) => {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    });
  });

  it('leaves zero overlapping boxes across a multi-component forest of mixed sizes', () => {
    const nodes: readonly ForestNode[] = [
      // a star with one big card and small leaves
      { id: 'root', size: [600, 250] },
      { id: 'l1', size: [40, 40] }, { id: 'l2', size: [40, 40] }, { id: 'l3', size: [40, 40] },
      // a separate chain
      { id: 'c1', size: [80, 60] }, { id: 'c2', size: [80, 60] }, { id: 'c3', size: [80, 60] },
      // two lone orphans
      { id: 'o1', size: [50, 50] }, { id: 'o2', size: [120, 30] },
    ];
    const edges: ForestEdge[] = [
      { source: 'root', target: 'l1' }, { source: 'root', target: 'l2' }, { source: 'root', target: 'l3' },
      { source: 'c1', target: 'c2' }, { source: 'c2', target: 'c3' },
    ];
    const positions = computeForestLayout(nodes, edges, 50);
    expect(countOverlaps(nodes, positions, 1)).toBe(0);
  });

  it('is deterministic — identical inputs yield identical positions regardless of input order', () => {
    const nodes = uniformNodes(['a', 'b', 'c', 'd', 'e'], [40, 40]);
    const edges: ForestEdge[] = [
      { source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'd', target: 'e' },
    ];
    const first = computeForestLayout(nodes, edges, 50);
    const shuffledNodes = [...nodes].reverse();
    const shuffledEdges = [...edges].reverse();
    const second = computeForestLayout(shuffledNodes, shuffledEdges, 50);
    const byId = (positions: readonly { readonly id: string; readonly x: number; readonly y: number }[]) =>
      Object.fromEntries(positions.map((p) => [p.id, [p.x, p.y]]));
    expect(byId(first)).toEqual(byId(second));
  });

  it('handles a cyclic component without overlaps by spanning-tree fallback', () => {
    // triangle (cycle) + a pendant — has more edges than a tree, so the cycle
    // edge is dropped from the hierarchy but the layout must still be valid.
    const nodes = uniformNodes(['a', 'b', 'c', 'd'], [60, 60]);
    const edges: ForestEdge[] = [
      { source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' },
      { source: 'c', target: 'd' },
    ];
    const positions = computeForestLayout(nodes, edges, 40);
    expect(positions).toHaveLength(4);
    expect(countOverlaps(nodes, positions, 1)).toBe(0);
  });
});
