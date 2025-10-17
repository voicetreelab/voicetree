/**
 * Angular Position Seeding
 *
 * Provides initial positions for graph nodes using angular subdivision.
 * Nodes spawn from their parent at calculated angles: 0°, 90°, 180°, 270°,
 * then midpoints (45°, 135°, etc.), recursively subdividing as needed.
 */

export const SPAWN_RADIUS = 200; // pixels from parent
export const CHILD_ANGLE_CONE = 90; // degrees (± 45° from parent)

/**
 * Build an array of normalized positions [0, 1] using recursive subdivision
 * Returns positions level-by-level: quarters, then midpoints, then their midpoints, etc.
 */
function buildSubdividedPositions(count: number): number[] {
  if (count === 0) return [];

  // Build positions level by level
  const result: number[] = [];
  const levels: number[][] = [];

  // Level 0: quarters
  levels.push([0, 0.25, 0.5, 0.75]);

  // Keep adding levels until we have enough positions
  let totalPositions = 4;
  while (totalPositions < count) {
    const prevLevel = levels[levels.length - 1];
    const newLevel: number[] = [];

    // Add midpoints between adjacent positions in previous level
    for (let i = 0; i < prevLevel.length; i++) {
      const current = prevLevel[i];
      const next = prevLevel[(i + 1) % prevLevel.length];

      // Calculate midpoint (handle wrapping around 1.0)
      let midpoint: number;
      if (next > current) {
        midpoint = (current + next) / 2;
      } else {
        // Wrapping case: 0.75 -> 0 becomes 0.75 -> 1.0 -> 0
        midpoint = (current + next + 1) / 2;
        if (midpoint >= 1) {
          midpoint -= 1;
        }
      }

      newLevel.push(midpoint);
    }

    levels.push(newLevel);
    totalPositions += newLevel.length;
  }

  // Flatten levels into result array
  for (const level of levels) {
    for (const pos of level) {
      result.push(pos);
      if (result.length >= count) {
        return result;
      }
    }
  }

  return result;
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
  let rangeMin: number;
  let rangeSize: number;

  if (parentAngle !== undefined) {
    // Children constrained to parent angle ± 45° (90° cone)
    rangeMin = parentAngle - 45;
    rangeSize = CHILD_ANGLE_CONE;
  } else {
    // Root nodes: full 360° range
    rangeMin = 0;
    rangeSize = 360;
  }

  // Get normalized position [0, 1] for this child index
  const positions = buildSubdividedPositions(childIndex + 1);
  const normalizedPos = positions[childIndex];

  // Map to angle range and normalize to [0, 360)
  let angle = rangeMin + (normalizedPos * rangeSize);

  // Normalize to [0, 360)
  angle = angle % 360;
  if (angle < 0) {
    angle += 360;
  }

  return angle;
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
): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
}
