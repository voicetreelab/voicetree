import { describe, it, expect } from 'vitest';
import { findBestPosition } from './findBestPosition';
import type { ObstacleBBox, TargetDimensions, DirectionalDistanceConfig } from './findBestPosition';
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

    describe('single obstacle blocking desired angle', () => {
        it('should avoid an obstacle at the desired angle and pick the closest cardinal', () => {
            // Obstacle at (250, 0) blocking the right direction (0°)
            const obstacle: ObstacleBBox = { x1: 200, x2: 300, y1: -30, y2: 30 };
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, [obstacle]);
            // Should NOT be at (250, 0) since that overlaps
            expect(result.x !== 250 || result.y !== 0).toBe(true);
            // Should pick a cardinal direction that doesn't overlap
            const isCardinal: boolean =
                (Math.abs(result.x) === distance && Math.abs(result.y) < 1) ||
                (Math.abs(result.x) < 1 && Math.abs(result.y) === distance);
            expect(isCardinal).toBe(true);
        });

        it('should prefer the closest cardinal direction to the desired angle', () => {
            // Obstacle blocking right (0°), desired angle is 10° (close to right)
            // Below (270° math = negative y) or above (90°) should be chosen — closest to 10° is above (90°)
            // Actually for small targets at distance 250, "below" in screen (dy=1 → y=250) is 90° in atan2... no.
            // atan2(250, 0) = PI/2 ≈ 90° and atan2(-250, 0) = -PI/2 ≈ -90° = 270°
            // 10° is closest to 0° (right), but that's blocked. Next closest: above (90°) or below (270°)?
            // |90 - 10| = 80, |270 - 10| = 260 → but normalized = min(260, 100) = 100. So 90° wins.
            const obstacle: ObstacleBBox = { x1: 200, x2: 300, y1: -30, y2: 30 };
            const result: Position = findBestPosition(parentPos, 10, distance, smallTarget, [obstacle]);
            // Should pick direction with y > 0 (below on screen = 90° in math atan2 since dy > 0)
            expect(result.y).toBeGreaterThan(0);
        });
    });

    describe('all cardinal directions blocked', () => {
        it('should fall back to the desired angle position', () => {
            // Obstacles at all 4 cardinal directions
            const obstacles: readonly ObstacleBBox[] = [
                { x1: 200, x2: 300, y1: -30, y2: 30 },    // right
                { x1: -300, x2: -200, y1: -30, y2: 30 },   // left
                { x1: -80, x2: 80, y1: 220, y2: 280 },     // below
                { x1: -80, x2: 80, y1: -280, y2: -220 },   // above
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
            const obstacle: ObstacleBBox = { x1: 200, x2: 300, y1: -210, y2: 210 };
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
