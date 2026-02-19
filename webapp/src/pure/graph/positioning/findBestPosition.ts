/**
 * Pure collision-aware positioning for graph nodes.
 *
 * Used by both child node creation and shadow node (floating window) anchoring.
 * No cytoscape dependency — obstacles are passed in as plain bounding boxes.
 */

import type { Position } from '@/pure/graph';
import { polarToCartesian } from '@/pure/graph/positioning/angularPositionSeeding';
import { segmentsIntersect } from '@/pure/graph/geometry';
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
 * Check if a candidate edge (parent → candidate) crosses any existing edge.
 */
function hasEdgeCrossing(
    parentPos: Position,
    candidatePos: Position,
    edges: readonly EdgeSegment[]
): boolean {
    const candidateEdge: EdgeSegment = { p1: parentPos, p2: candidatePos };
    return edges.some(edge => segmentsIntersect(candidateEdge, edge));
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
    directionalDistance?: DirectionalDistanceConfig,
    label?: string,
    edgeSegments?: readonly EdgeSegment[]
): readonly { readonly pos: Position; readonly angleDiff: number }[] {
    const normalizeAngleDiff: (raw: number) => number = (raw: number) =>
        raw > Math.PI ? 2 * Math.PI - raw : raw;

    const allCandidates: readonly { readonly pos: Position; readonly bbox: ObstacleBBox; readonly blocked: boolean; readonly overlappingObstacles: readonly ObstacleBBox[]; readonly crossesEdge: boolean }[] = directions
        .map(dir => {
            const off: Position = directionOffset(dir, distance, targetDimensions, directionalDistance);
            const pos: Position = { x: parentPos.x + off.x, y: parentPos.y + off.y };
            const bbox: ObstacleBBox = buildBBox(pos, targetDimensions);
            const overlappingObstacles: readonly ObstacleBBox[] = obstacles.filter(obs => rectsOverlap(bbox, obs));
            const crossesEdge: boolean = (edgeSegments?.length ?? 0) > 0 && hasEdgeCrossing(parentPos, pos, edgeSegments!);
            return { pos, bbox, blocked: overlappingObstacles.length > 0 || crossesEdge, overlappingObstacles, crossesEdge };
        });

    const free: number = allCandidates.filter(c => !c.blocked).length;
    const blocked: number = allCandidates.filter(c => c.blocked).length;
    console.log(`[findBestPosition] ${label ?? 'candidates'} (dist=${distance.toFixed(0)}): ${free} free, ${blocked} blocked out of ${allCandidates.length}`);
    allCandidates.forEach(c => {
        const reasons: readonly string[] = [
            ...(c.overlappingObstacles.length > 0 ? [`${c.overlappingObstacles.length} obstacle(s)`] : []),
            ...(c.crossesEdge ? ['edge crossing'] : []),
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
 * 1. Try the desired angle at the given distance — if no AABB overlap, use it.
 * 2. If collision, try 6 hex directions (60° apart) at base distance, pick closest to desired angle.
 * 3. If all blocked, retry at 1.5× distance.
 * 4. If still blocked, retry at 3.5× distance (clears large floating editors).
 * 5. Fallback: return the desired angle position anyway (better than nothing).
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
    directionalDistance?: DirectionalDistanceConfig,
    edgeSegments?: readonly EdgeSegment[]
): Position {
    console.log(`[findBestPosition] parentPos=(${parentPos.x.toFixed(0)}, ${parentPos.y.toFixed(0)}), angle=${desiredAngleDeg.toFixed(1)}°, dist=${distance}, target=${targetDimensions.width}×${targetDimensions.height}, obstacles=${obstacles.length}, edges=${edgeSegments?.length ?? 0}`);
    obstacles.forEach((obs, i) => {
        console.log(`  obstacle[${i}]: [${obs.x1.toFixed(0)},${obs.y1.toFixed(0)} → ${obs.x2.toFixed(0)},${obs.y2.toFixed(0)}]`);
    });

    // 1. Try desired angle first
    const offset: { readonly x: number; readonly y: number } = polarToCartesian(desiredAngleDeg, distance);
    const desiredPos: Position = {
        x: parentPos.x + offset.x,
        y: parentPos.y + offset.y,
    };

    const desiredBBox: ObstacleBBox = buildBBox(desiredPos, targetDimensions);
    const desiredOverlap: boolean = hasAnyOverlap(desiredBBox, obstacles);
    const desiredCrossesEdge: boolean = (edgeSegments?.length ?? 0) > 0 && hasEdgeCrossing(parentPos, desiredPos, edgeSegments!);
    const desiredBlocked: boolean = desiredOverlap || desiredCrossesEdge;
    const desiredBlockReason: string = desiredBlocked ? (desiredOverlap && desiredCrossesEdge ? 'BLOCKED (overlap + edge crossing)' : desiredOverlap ? 'BLOCKED (overlap)' : 'BLOCKED (edge crossing)') : 'FREE → using it';
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
        tryCandidateDirections(parentPos, HEX_DIRECTIONS, nearDistance, targetDimensions, obstacles, desiredRad, directionalDistance, '1.5× hex', edgeSegments);

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
        tryCandidateDirections(parentPos, HEX_DIRECTIONS, farDistance, targetDimensions, obstacles, desiredRad, directionalDistance, '2.5× hex', edgeSegments);

    if (farCandidates.length > 0) {
        const best: { readonly pos: Position; readonly angleDiff: number } = [...farCandidates].sort((a, b) => a.angleDiff - b.angleDiff)[0];
        console.log(`[findBestPosition] → picked (${best.pos.x.toFixed(0)}, ${best.pos.y.toFixed(0)}) from 2.5× candidates`);
        return best.pos;
    }

    // 5. Fallback: desired angle position (all directions blocked)
    console.log(`[findBestPosition] ⚠ FALLBACK — all directions blocked at all distances, returning desired pos (${desiredPos.x.toFixed(0)}, ${desiredPos.y.toFixed(0)}) WITH collisions`);
    return desiredPos;
}
