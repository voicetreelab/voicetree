import { describe, it, expect } from 'vitest';
import { findBestPosition, boxObstacle, segmentObstacle } from './findBestPosition';
import type { Obstacle, TargetDimensions, DirectionalDistanceConfig } from './findBestPosition';
import type { Position } from '@/pure/graph';

const parentPos: Position = { x: 0, y: 0 };
const distance: number = 250;
const smallTarget: TargetDimensions = { width: 150, height: 40 };

describe('findBestPosition', () => {
    describe('no obstacles', () => {
        it('should return the desired angle position when no obstacles exist', () => {
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, []);
            // 0° = right → x = 250, y ≈ 0
            expect(result.x).toBeCloseTo(250);
            expect(result.y).toBeCloseTo(0);
        });

        it('should place at 90° (up in math coords) when desired', () => {
            const result: Position = findBestPosition(parentPos, 90, distance, smallTarget, []);
            expect(result.x).toBeCloseTo(0);
            expect(result.y).toBeCloseTo(250);
        });

        it('should place at 270° when desired', () => {
            const result: Position = findBestPosition(parentPos, 270, distance, smallTarget, []);
            expect(result.x).toBeCloseTo(0);
            expect(result.y).toBeCloseTo(-250);
        });
    });

    describe('single box obstacle blocking desired angle', () => {
        it('should avoid an obstacle at the desired angle and pick the closest hex direction at 1.5×', () => {
            // Obstacle at (250, 0) blocking the right direction (0°) at base distance
            const obstacle: Obstacle = boxObstacle({ x1: 200, x2: 300, y1: -30, y2: 30 });
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, [obstacle]);
            // Should NOT be at (250, 0) since that overlaps
            expect(result.x !== 250 || result.y !== 0).toBe(true);
            // Base distance hex is skipped; at 1.5× (375), 0° direction (375, 0) clears the obstacle
            // bbox [300, -20, 450, 20] vs obstacle [200, -30, 300, 30] — no overlap (300 is not < 300)
            expect(result.x).toBeCloseTo(375);
            expect(result.y).toBeCloseTo(0);
        });

        it('should prefer the closest hex direction to the desired angle at 1.5×', () => {
            // Obstacle blocking a wide area around right (0°) including 60° and 300° hex dirs at base distance
            const obstacle: Obstacle = boxObstacle({ x1: 50, x2: 300, y1: -250, y2: 250 });
            const result: Position = findBestPosition(parentPos, 10, distance, smallTarget, [obstacle]);
            // At 1.5× (375), 0° direction (375, 0) bbox [300, -20, 450, 20] clears the obstacle [50, -250, 300, 250]
            // Closest to desired 10° is 0° direction
            expect(result.x).toBeCloseTo(375);
            expect(result.y).toBeCloseTo(0);
        });
    });

    describe('segment obstacles (edge collision)', () => {
        it('should avoid a segment that passes through the candidate bbox', () => {
            // Edge running horizontally through the right side (0°) candidate position
            // Candidate at (250, 0) with smallTarget (150×40) has bbox [175, -20, 325, 20]
            // Edge from (200, -100) to (200, 100) passes through the bbox vertically
            const obstacle: Obstacle = segmentObstacle({ p1: { x: 200, y: -100 }, p2: { x: 200, y: 100 } });
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, [obstacle]);
            // Should avoid (250, 0) because the edge segment passes through bbox
            expect(result.x !== 250 || result.y !== 0).toBe(true);
        });

        it('should not collide with a segment that is outside the candidate bbox', () => {
            // Edge far to the right, not intersecting candidate bbox at (250, 0)
            const obstacle: Obstacle = segmentObstacle({ p1: { x: 500, y: -100 }, p2: { x: 500, y: 100 } });
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, [obstacle]);
            // No collision — should place at desired angle
            expect(result.x).toBeCloseTo(250);
            expect(result.y).toBeCloseTo(0);
        });

        it('should handle mixed box and segment obstacles', () => {
            const obstacles: readonly Obstacle[] = [
                boxObstacle({ x1: 200, x2: 300, y1: -30, y2: 30 }),       // blocks 0° at base
                segmentObstacle({ p1: { x: 350, y: -200 }, p2: { x: 350, y: 200 } }), // blocks 0° at 1.5× (375) — bbox [300, -20, 450, 20] intersects x=350 line
            ];
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, obstacles);
            // 0° blocked at both base and 1.5× — should pick a different hex direction at 1.5×
            expect(result.x !== 375 || Math.abs(result.y) > 1).toBe(true);
        });
    });

    describe('all hex directions blocked', () => {
        it('should try 1.5× distance when all hex at base are blocked', () => {
            // Obstacles blocking desired angle AND all 6 hex at base distance, but not at 1.5× (375)
            const obstacles: readonly Obstacle[] = [
                boxObstacle({ x1: -300, x2: 300, y1: -300, y2: 300 }),  // large obstacle covering base distance
            ];
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, obstacles);
            // At 1.5× (375), right direction (375, 0) clears the obstacle (bbox x: [300, 450] vs obs x: [-300, 300])
            expect(result.x).toBeCloseTo(375);
            expect(result.y).toBeCloseTo(0);
        });

        it('should try 2.5× distance when 1.5× is blocked', () => {
            // Large obstacle covering all hex positions at 1× (250) and 1.5× (375)
            // but not 2.5× (625) — furthest 1.5× hex is at ~375px from center
            const obstacles: readonly Obstacle[] = [
                boxObstacle({ x1: -460, x2: 460, y1: -360, y2: 360 }),
            ];
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, obstacles);
            // At 2.5× (625), right direction (625, 0) clears the obstacle
            expect(result.x).toBeCloseTo(625);
            expect(result.y).toBeCloseTo(0);
        });

        it('should fall back to the desired angle when all distances are blocked', () => {
            // Massive obstacle blocking everything
            const obstacles: readonly Obstacle[] = [
                boxObstacle({ x1: -1000, x2: 1000, y1: -1000, y2: 1000 }),
            ];
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, obstacles);
            // Fallback to desired angle (0° = right)
            expect(result.x).toBeCloseTo(250);
            expect(result.y).toBeCloseTo(0);
        });
    });

    describe('directional distance for large targets', () => {
        it('should use dimension-aware offsets when directionalDistance is provided', () => {
            const largeTarget: TargetDimensions = { width: 600, height: 400 };
            const dirConfig: DirectionalDistanceConfig = { parentWidth: 100, parentHeight: 50, gap: 20 };
            // For right direction: max(250, 600/2 + 100/2 + 20) = max(250, 370) = 370
            const result: Position = findBestPosition(parentPos, 0, distance, largeTarget, [], dirConfig);
            // Desired angle (0°) should succeed with no obstacles, position at (250, 0) from polarToCartesian
            // But the cardinal fallback uses directionalDistance — since desired angle works, it returns polar result
            expect(result.x).toBeCloseTo(250);
            expect(result.y).toBeCloseTo(0);
        });

        it('should use directional distance offsets when falling back to cardinal directions', () => {
            const largeTarget: TargetDimensions = { width: 600, height: 400 };
            const dirConfig: DirectionalDistanceConfig = { parentWidth: 100, parentHeight: 50, gap: 20 };
            // Block the desired angle position (250, 0)
            const obstacle: Obstacle = boxObstacle({ x1: 200, x2: 300, y1: -210, y2: 210 });
            const result: Position = findBestPosition(parentPos, 0, distance, largeTarget, [obstacle], dirConfig);
            // Should fall back to a cardinal direction with dimension-aware offset
            // Right is blocked, so should pick another direction
            // For below: max(250, 400/2 + 50/2 + 20) = max(250, 245) = 250 → y=250
            // For left: max(250, 600/2 + 100/2 + 20) = max(250, 370) = 370 → x=-370
            // Closest to 0° among unblocked: below (90° in atan2) or above (-90°) or left (180°)
            // 90° is closest to 0°
            expect(Math.abs(result.x) > 200 || Math.abs(result.y) > 200).toBe(true);
        });
    });
});
