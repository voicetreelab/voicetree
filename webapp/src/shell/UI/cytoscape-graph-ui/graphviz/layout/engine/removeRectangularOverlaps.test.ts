import { describe, expect, it } from 'vitest';
import {
  removeRectangularOverlaps,
  type OverlapRect,
  type ResolvedPosition,
} from './removeRectangularOverlaps';

type Box = { readonly x1: number; readonly x2: number; readonly y1: number; readonly y2: number };

const boxOf = (rect: OverlapRect, resolved: ResolvedPosition): Box => ({
  x1: resolved.x - rect.width / 2,
  x2: resolved.x + rect.width / 2,
  y1: resolved.y - rect.height / 2,
  y2: resolved.y + rect.height / 2,
});

const countOverlaps = (rects: readonly OverlapRect[], resolved: readonly ResolvedPosition[], epsilon: number): number => {
  const boxes = rects.map((rect, index) => boxOf(rect, resolved[index]));
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

const stackedWideCards = (count: number): readonly OverlapRect[] =>
  // Wide rectangular cards (w >> h) all piled at the origin — the exact shape a
  // point-mass FA2 pass leaves behind, and where a circular finisher fails.
  Array.from({ length: count }, (_, index): OverlapRect => ({
    id: `n${index}`,
    x: 0,
    y: 0,
    width: 300,
    height: 80,
    movable: true,
  }));

describe('removeRectangularOverlaps', () => {
  it('returns inputs unchanged when fewer than two rectangles', () => {
    const rects = stackedWideCards(1);
    expect(removeRectangularOverlaps(rects, 20)).toEqual([{ id: 'n0', x: 0, y: 0 }]);
  });

  it('separates a dense pile of wide cards to zero overlapping bounding boxes', () => {
    const rects = stackedWideCards(40);
    const resolved = removeRectangularOverlaps(rects, 20);
    expect(countOverlaps(rects, resolved, 0.5)).toBe(0);
  });

  it('honours the requested spacing gap between separated cards', () => {
    const rects: readonly OverlapRect[] = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100, movable: true },
      { id: 'b', x: 10, y: 0, width: 100, height: 100, movable: true },
    ];
    const spacing = 30;
    const resolved = removeRectangularOverlaps(rects, spacing);
    const gap = Math.abs(resolved[0].x - resolved[1].x) - 100;
    expect(gap).toBeGreaterThanOrEqual(spacing - 0.5);
  });

  it('keeps a pinned node fixed and moves its movable neighbour away', () => {
    const rects: readonly OverlapRect[] = [
      { id: 'pinned', x: 0, y: 0, width: 100, height: 100, movable: false },
      { id: 'free', x: 5, y: 0, width: 100, height: 100, movable: true },
    ];
    const resolved = removeRectangularOverlaps(rects, 20);
    const pinned = resolved.find((position) => position.id === 'pinned');
    const free = resolved.find((position) => position.id === 'free');
    // The pinned node is held by an overwhelming VPSC weight: it shifts by far
    // less than a pixel while the movable neighbour absorbs the full separation.
    expect(Math.hypot(pinned!.x, pinned!.y)).toBeLessThan(0.01);
    expect(Math.abs(free!.x)).toBeGreaterThan(100);
    expect(countOverlaps(rects, resolved, 0.5)).toBe(0);
  });
});
