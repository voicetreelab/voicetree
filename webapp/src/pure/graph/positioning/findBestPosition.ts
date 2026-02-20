/**
 * Pure collision-aware positioning for graph nodes.
 *
 * Used by both child node creation and shadow node (floating window) anchoring.
 * No cytoscape dependency — obstacles are passed in as a unified array of
 * boxes (nodes) and segments (edges), checked with a single predicate.
 */

import type { Position } from '@/pure/graph';
import { polarToCartesian } from '@/pure/graph/positioning/angularPositionSeeding';
import { rectIntersectsSegment } from '@/pure/graph/geometry';
import type { EdgeSegment } from '@/pure/graph/geometry';

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

// ============================================================================
// Unified Obstacle type — nodes (boxes) and edges (segments) in one array
// ============================================================================

export type Obstacle =
    | ({ readonly kind: 'box' } & ObstacleBBox)
    | ({ readonly kind: 'segment' } & EdgeSegment);

/** Wrap a node bounding box as an Obstacle. */
export function boxObstacle(bbox: ObstacleBBox): Obstacle {
    return { kind: 'box', ...bbox };
}

/** Wrap an edge segment as an Obstacle. */
export function segmentObstacle(seg: EdgeSegment): Obstacle {
    return { kind: 'segment', ...seg };
}

// ============================================================================
// Collision primitives
// ============================================================================

/** AABB overlap check between two bounding boxes. */
function rectsOverlap(a: ObstacleBBox, b: ObstacleBBox): boolean {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/** Check if a candidate bbox collides with a single obstacle (box or segment). */
function collidesWithObstacle(candidateBBox: ObstacleBBox, obstacle: Obstacle): boolean {
    switch (obstacle.kind) {
        case 'box': return rectsOverlap(candidateBBox, obstacle);
        case 'segment': return rectIntersectsSegment(candidateBBox, obstacle);
    }
}

/** Build a bounding box centered at a position with given dimensions. */
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
 * Try candidate directions at a given distance, return collision-free candidates
 * sorted by angular proximity to the desired angle.
 */
function tryCandidateDirections(
    parentPos: Position,
    directions: readonly { readonly dx: number; readonly dy: number }[],
    distance: number,
    targetDimensions: TargetDimensions,
    obstacles: readonly Obstacle[],
    desiredRad: number,
    directionalDistance?: DirectionalDistanceConfig,
    label?: string,
): readonly { readonly pos: Position; readonly angleDiff: number }[] {
    const normalizeAngleDiff: (raw: number) => number = (raw: number) =>
        raw > Math.PI ? 2 * Math.PI - raw : raw;

    const allCandidates: readonly { readonly pos: Position; readonly bbox: ObstacleBBox; readonly blocked: boolean; readonly collisions: readonly Obstacle[] }[] = directions
        .map(dir => {
            const off: Position = directionOffset(dir, distance, targetDimensions, directionalDistance);
            const pos: Position = { x: parentPos.x + off.x, y: parentPos.y + off.y };
            const bbox: ObstacleBBox = buildBBox(pos, targetDimensions);
            const collisions: readonly Obstacle[] = obstacles.filter(obs => collidesWithObstacle(bbox, obs));
            return { pos, bbox, blocked: collisions.length > 0, collisions };
        });

    const free: number = allCandidates.filter(c => !c.blocked).length;
    const blocked: number = allCandidates.filter(c => c.blocked).length;
    console.log(`[findBestPosition] ${label ?? 'candidates'} (dist=${distance.toFixed(0)}): ${free} free, ${blocked} blocked out of ${allCandidates.length}`);
    allCandidates.forEach(c => {
        const boxCount: number = c.collisions.filter(o => o.kind === 'box').length;
        const segCount: number = c.collisions.filter(o => o.kind === 'segment').length;
        const reasons: readonly string[] = [
            ...(boxCount > 0 ? [`${boxCount} node(s)`] : []),
            ...(segCount > 0 ? [`${segCount} edge(s)`] : []),
        ];
        const status: string = c.blocked ? `BLOCKED by ${reasons.join(' + ')}` : 'FREE';
        console.log(`  candidate (${c.pos.x.toFixed(0)}, ${c.pos.y.toFixed(0)}) bbox [${c.bbox.x1.toFixed(0)},${c.bbox.y1.toFixed(0)} → ${c.bbox.x2.toFixed(0)},${c.bbox.y2.toFixed(0)}]: ${status}`);
    });

    return allCandidates
        .filter(c => !c.blocked)
        .map(c => {
            const candidateRad: number = Math.atan2(c.pos.y - parentPos.y, c.pos.x - parentPos.x);
            const angleDiff: number = normalizeAngleDiff(Math.abs(candidateRad - desiredRad));
            return { pos: c.pos, angleDiff };
        });
}

/**
 * Find the best collision-free position near a parent node.
 *
 * Algorithm:
 * 1. Try the desired angle at the given distance — if no collision, use it.
 * 2. If collision, try 6 hex directions (60° apart) at 1.5× distance, pick closest to desired angle.
 * 3. If all blocked, retry at 2.5× distance (clears large floating editors).
 * 4. Fallback: return the desired angle position anyway (better than nothing).
 *
 * Obstacles is a unified array of boxes (nodes) and segments (edges).
 * Each candidate's bounding box is checked against all obstacles with a single predicate.
 *
 * @param parentPos - Center of the parent node
 * @param desiredAngleDeg - Preferred angle in degrees (0° = right, counter-clockwise)
 * @param distance - Distance from parent center to candidate center
 * @param targetDimensions - Width/height of the element being placed
 * @param obstacles - Unified array of node bboxes and edge segments to avoid
 * @param directionalDistance - Optional config for large targets that need dimension-aware offsets
 */
export function findBestPosition(
    parentPos: Position,
    desiredAngleDeg: number,
    distance: number,
    targetDimensions: TargetDimensions,
    obstacles: readonly Obstacle[],
    directionalDistance?: DirectionalDistanceConfig,
): Position {
    console.log(`[findBestPosition] parentPos=(${parentPos.x.toFixed(0)}, ${parentPos.y.toFixed(0)}), angle=${desiredAngleDeg.toFixed(1)}°, dist=${distance}, target=${targetDimensions.width}×${targetDimensions.height}, obstacles=${obstacles.length}`);

    // 1. Try desired angle first
    const offset: { readonly x: number; readonly y: number } = polarToCartesian(desiredAngleDeg, distance);
    const desiredPos: Position = {
        x: parentPos.x + offset.x,
        y: parentPos.y + offset.y,
    };

    const desiredBBox: ObstacleBBox = buildBBox(desiredPos, targetDimensions);
    const desiredCollisions: readonly Obstacle[] = obstacles.filter(obs => collidesWithObstacle(desiredBBox, obs));
    const desiredBlocked: boolean = desiredCollisions.length > 0;
    const boxCount: number = desiredCollisions.filter(o => o.kind === 'box').length;
    const segCount: number = desiredCollisions.filter(o => o.kind === 'segment').length;
    const desiredBlockReason: string = desiredBlocked
        ? `BLOCKED (${[...(boxCount > 0 ? [`${boxCount} node(s)`] : []), ...(segCount > 0 ? [`${segCount} edge(s)`] : [])].join(' + ')})`
        : 'FREE → using it';
    console.log(`[findBestPosition] step 1 — desired angle (${desiredPos.x.toFixed(0)}, ${desiredPos.y.toFixed(0)}) bbox [${desiredBBox.x1.toFixed(0)},${desiredBBox.y1.toFixed(0)} → ${desiredBBox.x2.toFixed(0)},${desiredBBox.y2.toFixed(0)}]: ${desiredBlockReason}`);

    if (!desiredBlocked) {
        return desiredPos;
    }

    const desiredRad: number = (desiredAngleDeg * Math.PI) / 180;
        //no base dist
    // // 2. Try 6 hex directions at base distance
    // const baseCandidates: readonly { readonly pos: Position; readonly angleDiff: number }[] =
    //     tryCandidateDirections(parentPos, HEX_DIRECTIONS, distance, targetDimensions, obstacles, desiredRad, directionalDistance);
    //
    // if (baseCandidates.length > 0) {
    //     return [...baseCandidates].sort((a, b) => a.angleDiff - b.angleDiff)[0].pos;
    // }

    // 3. All blocked at base — retry at 1.5× distance
    console.log(`[findBestPosition] step 3 — trying 1.5× distance hex directions`);
    const nearDistance: number = distance * 1.5;
    const nearCandidates: readonly { readonly pos: Position; readonly angleDiff: number }[] =
        tryCandidateDirections(parentPos, HEX_DIRECTIONS, nearDistance, targetDimensions, obstacles, desiredRad, directionalDistance, '1.5× hex');

    if (nearCandidates.length > 0) {
        const best: { readonly pos: Position; readonly angleDiff: number } = [...nearCandidates].sort((a, b) => a.angleDiff - b.angleDiff)[0];
        console.log(`[findBestPosition] → picked (${best.pos.x.toFixed(0)}, ${best.pos.y.toFixed(0)}) from 1.5× candidates`);
        return best.pos;
    }

    // 4. All blocked at 1.5× — retry at 2.5× distance.
    // Large floating windows (editors ~380×400) centered at ~285px from parent can have
    // bboxes extending to ~475px, requiring a larger jump to clear.
    console.log(`[findBestPosition] step 4 — trying 2.5× distance hex directions`);
    const farDistance: number = distance * 2.5;
    const farCandidates: readonly { readonly pos: Position; readonly angleDiff: number }[] =
        tryCandidateDirections(parentPos, HEX_DIRECTIONS, farDistance, targetDimensions, obstacles, desiredRad, directionalDistance, '2.5× hex');

    if (farCandidates.length > 0) {
        const best: { readonly pos: Position; readonly angleDiff: number } = [...farCandidates].sort((a, b) => a.angleDiff - b.angleDiff)[0];
        console.log(`[findBestPosition] → picked (${best.pos.x.toFixed(0)}, ${best.pos.y.toFixed(0)}) from 2.5× candidates`);
        return best.pos;
    }

    // 5. Fallback: desired angle position (all directions blocked)
    console.log(`[findBestPosition] ⚠ FALLBACK — all directions blocked at all distances, returning desired pos (${desiredPos.x.toFixed(0)}, ${desiredPos.y.toFixed(0)}) WITH collisions`);
    return desiredPos;
}
