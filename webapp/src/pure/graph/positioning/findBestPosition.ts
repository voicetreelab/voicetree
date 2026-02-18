/**
 * Pure collision-aware positioning for graph nodes.
 *
 * Used by both child node creation and shadow node (floating window) anchoring.
 * No cytoscape dependency — obstacles are passed in as plain bounding boxes.
 */

import type { Position } from '@/pure/graph';
import { polarToCartesian } from '@/pure/graph/positioning/angularPositionSeeding';

export interface ObstacleBBox {
    readonly x1: number;
    readonly x2: number;
    readonly y1: number;
    readonly y2: number;
}

export interface TargetDimensions {
    readonly width: number;
    readonly height: number;
}

/**
 * For large floating windows (terminals/editors), the offset from the parent
 * needs to account for the window's own dimensions so it doesn't overlap the parent.
 * When provided, the actual offset in each cardinal direction is:
 *   max(distance, targetDim/2 + parentDim/2 + gap)
 */
export interface DirectionalDistanceConfig {
    readonly parentWidth: number;
    readonly parentHeight: number;
    readonly gap: number;
}

/**
 * AABB overlap check between two bounding boxes.
 */
function rectsOverlap(a: ObstacleBBox, b: ObstacleBBox): boolean {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/**
 * Check if a candidate bounding box overlaps with any obstacle.
 */
function hasAnyOverlap(
    candidateBBox: ObstacleBBox,
    obstacles: readonly ObstacleBBox[]
): boolean {
    return obstacles.some(obs => rectsOverlap(candidateBBox, obs));
}

/**
 * Build a bounding box centered at a position with given dimensions.
 */
function buildBBox(center: Position, dims: TargetDimensions): ObstacleBBox {
    return {
        x1: center.x - dims.width / 2,
        x2: center.x + dims.width / 2,
        y1: center.y - dims.height / 2,
        y2: center.y + dims.height / 2,
    };
}

// 6 evenly-spaced directions (hexagonal, 60° apart) — better coverage around large editors
const HEX_DIRECTIONS: readonly { readonly dx: number; readonly dy: number }[] = [
    { dx: 1, dy: 0 },                        // 0°   right
    { dx: 0.5, dy: Math.sqrt(3) / 2 },       // 60°  lower-right
    { dx: -0.5, dy: Math.sqrt(3) / 2 },      // 120° lower-left
    { dx: -1, dy: 0 },                        // 180° left
    { dx: -0.5, dy: -(Math.sqrt(3) / 2) },   // 240° upper-left
    { dx: 0.5, dy: -(Math.sqrt(3) / 2) },    // 300° upper-right
];

/**
 * Calculate the position offset for a unit direction vector, accounting for
 * directional distance when the target is large (e.g. a terminal window).
 */
function directionOffset(
    dir: { readonly dx: number; readonly dy: number },
    distance: number,
    targetDims: TargetDimensions,
    directionalDistance?: DirectionalDistanceConfig
): Position {
    if (directionalDistance) {
        const dimOffsetX: number = (targetDims.width / 2) + (directionalDistance.parentWidth / 2) + directionalDistance.gap;
        const dimOffsetY: number = (targetDims.height / 2) + (directionalDistance.parentHeight / 2) + directionalDistance.gap;
        return {
            x: dir.dx * Math.max(distance, dimOffsetX),
            y: dir.dy * Math.max(distance, dimOffsetY),
        };
    }
    return {
        x: dir.dx * distance,
        y: dir.dy * distance,
    };
}

/**
 * Try candidate directions at a given distance, return overlap-free candidates
 * sorted by angular proximity to the desired angle.
 */
function tryCandidateDirections(
    parentPos: Position,
    directions: readonly { readonly dx: number; readonly dy: number }[],
    distance: number,
    targetDimensions: TargetDimensions,
    obstacles: readonly ObstacleBBox[],
    desiredRad: number,
    directionalDistance?: DirectionalDistanceConfig
): readonly { readonly pos: Position; readonly angleDiff: number }[] {
    const normalizeAngleDiff: (raw: number) => number = (raw: number) =>
        raw > Math.PI ? 2 * Math.PI - raw : raw;

    return directions
        .map(dir => {
            const off: Position = directionOffset(dir, distance, targetDimensions, directionalDistance);
            return { x: parentPos.x + off.x, y: parentPos.y + off.y };
        })
        .filter(candidatePos => !hasAnyOverlap(buildBBox(candidatePos, targetDimensions), obstacles))
        .map(candidatePos => {
            const candidateRad: number = Math.atan2(candidatePos.y - parentPos.y, candidatePos.x - parentPos.x);
            const angleDiff: number = normalizeAngleDiff(Math.abs(candidateRad - desiredRad));
            return { pos: candidatePos, angleDiff };
        });
}

/**
 * Find the best collision-free position near a parent node.
 *
 * Algorithm:
 * 1. Try the desired angle at the given distance — if no AABB overlap, use it.
 * 2. If collision, try 6 hex directions (60° apart) at 1.5× distance, pick closest to desired angle.
 * 3. If all blocked, retry 6 hex directions at 3.5× distance (clears large floating editors).
 * 4. Fallback: return the desired angle position anyway (better than nothing).
 *
 * @param parentPos - Center of the parent node
 * @param desiredAngleDeg - Preferred angle in degrees (0° = right, counter-clockwise)
 * @param distance - Distance from parent center to candidate center
 * @param targetDimensions - Width/height of the element being placed
 * @param obstacles - Bounding boxes of nearby nodes to avoid
 * @param directionalDistance - Optional config for large targets that need dimension-aware offsets
 */
export function findBestPosition(
    parentPos: Position,
    desiredAngleDeg: number,
    distance: number,
    targetDimensions: TargetDimensions,
    obstacles: readonly ObstacleBBox[],
    directionalDistance?: DirectionalDistanceConfig
): Position {
    // 1. Try desired angle first
    const offset: { readonly x: number; readonly y: number } = polarToCartesian(desiredAngleDeg, distance);
    const desiredPos: Position = {
        x: parentPos.x + offset.x,
        y: parentPos.y + offset.y,
    };

    if (!hasAnyOverlap(buildBBox(desiredPos, targetDimensions), obstacles)) {
        return desiredPos;
    }

    const desiredRad: number = (desiredAngleDeg * Math.PI) / 180;

    // 2. Try 6 hex directions at 1.5× distance — clears most single-editor overlaps
    const nearDistance: number = distance * 1.5;
    const candidates: readonly { readonly pos: Position; readonly angleDiff: number }[] =
        tryCandidateDirections(parentPos, HEX_DIRECTIONS, nearDistance, targetDimensions, obstacles, desiredRad, directionalDistance);

    if (candidates.length > 0) {
        return [...candidates].sort((a, b) => a.angleDiff - b.angleDiff)[0].pos;
    }

    // 3. All directions blocked at 1.5× — retry at 3.5× distance.
    // Large floating windows (editors ~380×400) centered at ~285px from parent can have
    // bboxes extending to ~475px, requiring a larger jump to clear.
    const farDistance: number = distance * 3.5;
    const farCandidates: readonly { readonly pos: Position; readonly angleDiff: number }[] =
        tryCandidateDirections(parentPos, HEX_DIRECTIONS, farDistance, targetDimensions, obstacles, desiredRad, directionalDistance);

    if (farCandidates.length > 0) {
        return [...farCandidates].sort((a, b) => a.angleDiff - b.angleDiff)[0].pos;
    }

    // 4. Fallback: desired angle position (all directions blocked)
    return desiredPos;
}
