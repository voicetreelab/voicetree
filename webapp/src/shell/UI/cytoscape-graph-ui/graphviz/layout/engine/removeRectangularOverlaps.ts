import { Rectangle, Solver, Variable, generateXConstraints, generateYConstraints } from 'webcola';

/**
 * A node to be de-overlapped, described as an axis-aligned rectangle centred at
 * (x, y) with the given label-inclusive width/height. `movable` nodes minimise
 * their displacement; non-movable nodes are pinned in place and act purely as
 * obstacles that movable nodes separate away from.
 */
export type OverlapRect = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly movable: boolean;
};

export type ResolvedPosition = { readonly id: string; readonly x: number; readonly y: number };

// VPSC minimises sum(weight * (position - desired)^2) subject to hard
// non-overlap constraints. A movable node has weight 1; a pinned node is given
// an overwhelming weight so the solver moves its movable neighbours instead of
// it. (Two pinned nodes that already overlap have no separable solution that
// keeps both fixed — the solver still returns a feasible layout, moving them
// minimally; that pathological input has no correct fixed answer.)
const MOVABLE_WEIGHT = 1;
const PINNED_WEIGHT = 1e6;

// Golden angle — the same low-discrepancy spiral the adapter uses to spread
// duplicate seed positions. Used here only to break exact coincidences.
const GOLDEN_ANGLE = 2.399963229728653;

// VPSC's scanline constraint generator cannot order rectangles whose centres
// coincide exactly, so a group sharing one point is left fully overlapping.
// Fan exact duplicates onto a sub-pixel golden-angle spiral so the solver has a
// stable ordering; this is a no-op for the distinct centres a force engine
// normally emits, and the tiny offset is dwarfed by the separation VPSC then
// applies.
const disambiguateCoincident = (rects: readonly OverlapRect[]): readonly OverlapRect[] => {
  const seenCount = new Map<string, number>();
  return rects.map((rect): OverlapRect => {
    const key = `${rect.x}:${rect.y}`;
    const duplicateIndex = seenCount.get(key) ?? 0;
    seenCount.set(key, duplicateIndex + 1);
    if (duplicateIndex === 0) return rect;
    const angle = duplicateIndex * GOLDEN_ANGLE;
    const radius = 0.01 * Math.sqrt(duplicateIndex);
    return { ...rect, x: rect.x + Math.cos(angle) * radius, y: rect.y + Math.sin(angle) * radius };
  });
};

const inflatedRectangle = (rect: OverlapRect, spacing: number): Rectangle => {
  const halfWidth = rect.width / 2 + spacing / 2;
  const halfHeight = rect.height / 2 + spacing / 2;
  return new Rectangle(
    rect.x - halfWidth,
    rect.x + halfWidth,
    rect.y - halfHeight,
    rect.y + halfHeight,
  );
};

/**
 * Resolve rectangular node overlaps to convergence with minimal displacement,
 * using WebCola's variable-placement-with-separation-constraints (VPSC) solver.
 *
 * Unlike a circular forceCollide pass, this treats each node as its true
 * [width, height] box and enforces HARD separation constraints, so dense
 * clusters of wide cards end up with zero overlapping bounding boxes (separated
 * by at least `spacing`). Constraint generation is scanline-based (O(n log n)),
 * preserving sub-quadratic scaling — there is no all-pairs loop.
 *
 * Pure: it neither reads nor writes Cytoscape; positions in, positions out.
 */
export const removeRectangularOverlaps = (
  rects: readonly OverlapRect[],
  spacing: number,
): readonly ResolvedPosition[] => {
  if (rects.length < 2) return rects.map((rect) => ({ id: rect.id, x: rect.x, y: rect.y }));

  const seeded = disambiguateCoincident(rects);
  const rectangles = seeded.map((rect) => inflatedRectangle(rect, spacing));
  const weights = seeded.map((rect) => (rect.movable ? MOVABLE_WEIGHT : PINNED_WEIGHT));

  const xVars = rectangles.map((rectangle, index) => new Variable(rectangle.cx(), weights[index]));
  new Solver(xVars, generateXConstraints(rectangles, xVars)).solve();
  xVars.forEach((variable, index) => rectangles[index].setXCentre(variable.position()));

  const yVars = rectangles.map((rectangle, index) => new Variable(rectangle.cy(), weights[index]));
  new Solver(yVars, generateYConstraints(rectangles, yVars)).solve();
  yVars.forEach((variable, index) => rectangles[index].setYCentre(variable.position()));

  return rects.map((rect, index) => ({
    id: rect.id,
    x: rectangles[index].cx(),
    y: rectangles[index].cy(),
  }));
};
