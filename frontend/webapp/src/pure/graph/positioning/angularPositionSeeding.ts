/**
 * Angular Position Seeding (Pure Functional Version)
 *
 * Provides initial positions for graph nodes using angular subdivision.
 * Nodes spawn from their parent at calculated angles: 0°, 90°, 180°, 270°,
 * then midpoints (45°, 135°, etc.), recursively subdividing as needed.
 *
 * Pure functions that operate on the functional GraphNode type without cytoscape dependencies.
 */

import type { GraphNode, Position } from '@/pure/graph';
import * as O from 'fp-ts/lib/Option.js';

export const SPAWN_RADIUS: 500 = 500 as const; // pixels from parent
export const CHILD_ANGLE_CONE: 180 = 180 as const; // degrees (± 45° from parent)

/**
 * Calculate midpoint between two positions on a circular scale [0, 1)
 */
function calculateMidpoint(current: number, next: number): number {
  if (next > current) {
    return (current + next) / 2;
  } else {
    // Wrapping case: 0.75 -> 0 becomes 0.75 -> 1.0 -> 0
    const midpoint: number = (current + next + 1) / 2;
    return midpoint >= 1 ? midpoint - 1 : midpoint;
  }
}

/**
 * Generate midpoints for a level of positions
 */
function generateMidpointsLevel(prevLevel: readonly number[]): readonly number[] {
  return prevLevel.map((current, i) => {
    const next: number = prevLevel[(i + 1) % prevLevel.length];
    return calculateMidpoint(current, next);
  });
}

/**
 * Build levels recursively until we have enough positions
 */
function buildLevelsUntilCount(
  levels: readonly (readonly number[])[],
  totalPositions: number,
  count: number
): readonly (readonly number[])[] {
  if (totalPositions >= count) {
    return levels;
  }

  const prevLevel: readonly number[] = levels[levels.length - 1];
  const newLevel: readonly number[] = generateMidpointsLevel(prevLevel);

  return buildLevelsUntilCount(
    [...levels, newLevel],
    totalPositions + newLevel.length,
    count
  );
}

/**
 * Flatten levels into a single array up to the count limit
 */
function flattenLevels(
  levels: readonly (readonly number[])[],
  count: number
): readonly number[] {
  return levels.flatMap(level => level).slice(0, count);
}

/**
 * Build an array of normalized positions [0, 1] using recursive subdivision
 * Returns positions level-by-level: quarters, then midpoints, then their midpoints, etc.
 */
function buildSubdividedPositions(count: number): readonly number[] {
  if (count === 0) return [];

  // Level 0: quarters
  const initialLevels: readonly (readonly number[])[] = [[0, 0.25, 0.5, 0.75]];
  const initialCount: number = 4;

  // Build levels recursively until we have enough positions
  const allLevels: readonly (readonly number[])[] = buildLevelsUntilCount(initialLevels, initialCount, count);

  // Flatten levels into result array, taking only what we need
  return flattenLevels(allLevels, count);
}

/**
 * Normalize an angle to [0, 360) range
 */
function normalizeAngle(angle: number): number {
  const normalized: number = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/**
 * Calculate spawn angle for the Nth child of a parent
 *
 * Uses recursive subdivision: first 4 children at 0°, 90°, 180°, 270°,
 * next 4 at midpoints (45°, 135°, 225°, 315°), then continue subdividing.
 *
 * @param childIndex - Zero-based index of the child (0 = first child)
 * @param parentAngle - Parent's spawn angle (undefined for root nodes)
 * @returns Angle in degrees (0-360)
 */
export function calculateChildAngle(
  childIndex: number,
  parentAngle?: number
): number {
  // Determine angle range
  const rangeMin: number = parentAngle !== undefined ? parentAngle - 45 : 0;
  const rangeSize: 180 | 360 = parentAngle !== undefined ? CHILD_ANGLE_CONE : 360;

  // Get normalized position [0, 1] for this child index
  const positions: readonly number[] = buildSubdividedPositions(childIndex + 1);
  const normalizedPos: number = positions[childIndex];

  // Map to angle range and normalize to [0, 360)
  const angle: number = rangeMin + (normalizedPos * rangeSize);

  return normalizeAngle(angle);
}

/**
 * Convert polar coordinates to cartesian offset
 *
 * @param angle - Angle in degrees (0° = east/right, 90° = north/up)
 * @param radius - Distance from origin
 * @returns Cartesian offset {x, y}
 */
export function polarToCartesian(
  angle: number,
  radius: number
): { readonly x: number; readonly y: number } {
  const radians: number = (angle * Math.PI) / 180;
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
}

/**
 * Calculate the angle from grandparent to parent node (pure functional version)
 *
 * Used to determine the angular constraint for spawning children.
 * If no grandparent exists, returns undefined (root node - no constraint).
 *
 * @param parentNode - The parent node
 * @param grandparentNode - The grandparent node (undefined for root nodes)
 * @returns Angle in degrees [0, 360), or undefined if parent is a root node or positions are not available
 */
export function calculateParentAngle(
  parentNode: GraphNode,
  grandparentNode: GraphNode | undefined
): number | undefined {
  // If no grandparent, parent is a root node with no angle constraint
  if (!grandparentNode) {
    return undefined;
  }

  // Get positions from nodeUIMetadata - return undefined if either position is None
  const grandparentPosOption: O.Option<Position> = grandparentNode.nodeUIMetadata.position;
  const parentPosOption: O.Option<Position> = parentNode.nodeUIMetadata.position;

  if (!O.isSome(grandparentPosOption) || !O.isSome(parentPosOption)) {
    return undefined;
  }

  // Extract values from Some<Position>
  const grandparentPos: Position = grandparentPosOption.value;
  const parentPos: Position = parentPosOption.value;

  // Calculate vector from grandparent to parent
  const dx: number = parentPos.x - grandparentPos.x;
  const dy: number = parentPos.y - grandparentPos.y;

  // Convert to angle in degrees (atan2 returns radians)
  const radians: number = Math.atan2(dy, dx);
  const degrees: number = (radians * 180) / Math.PI;

  // Normalize to [0, 360)
  return degrees < 0 ? degrees + 360 : degrees;
}
