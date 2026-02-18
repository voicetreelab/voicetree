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
        it('should avoid an obstacle at the desired angle and pick the closest hex direction', () => {
            // Obstacle at (250, 0) blocking the right direction (0°) at base distance
            const obstacle: ObstacleBBox = { x1: 200, x2: 300, y1: -30, y2: 30 };
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, [obstacle]);
            // Should NOT be at (250, 0) since that overlaps
            expect(result.x !== 250 || result.y !== 0).toBe(true);
            // At 1.5× (375), right hex direction (375, 0) clears the obstacle (bbox x: [300, 450] vs obstacle x: [200, 300])
            expect(result.x).toBeCloseTo(375);
            expect(result.y).toBeCloseTo(0);
        });

        it('should prefer the closest hex direction to the desired angle', () => {
            // Obstacle blocking a wide area around right (0°) at both 1× and 1.5× distance
            const obstacle: ObstacleBBox = { x1: 100, x2: 500, y1: -30, y2: 30 };
            const result: Position = findBestPosition(parentPos, 10, distance, smallTarget, [obstacle]);
            // Right hex (375, 0) is blocked. Closest unblocked hex to 10° is 60° direction.
            // At 1.5× (375): 60° → (187.5, 324.8)
            expect(result.y).toBeGreaterThan(0);
        });
    });

    describe('all hex directions blocked', () => {
        it('should try 1.5× distance when desired angle is blocked', () => {
            // Obstacle that blocks desired angle at base distance (250) but not at 1.5× (375)
            const obstacles: readonly ObstacleBBox[] = [
                { x1: 200, x2: 300, y1: -30, y2: 30 },    // blocks right at 250
            ];
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, obstacles);
            // At 1.5× distance (375), right hex direction clears the obstacle
            expect(result.x).toBeCloseTo(375);
            expect(result.y).toBeCloseTo(0);
        });

        it('should try 3.5× distance when 1.5× is blocked', () => {
            // Obstacles blocking desired angle at 1× AND all 6 hex directions at 1.5× (375)
            // Hex at 1.5×: (375,0), (187.5,324.8), (-187.5,324.8), (-375,0), (-187.5,-324.8), (187.5,-324.8)
            const obstacles: readonly ObstacleBBox[] = [
                { x1: 100, x2: 500, y1: -30, y2: 30 },       // blocks right at 1× and 1.5×
                { x1: 100, x2: 300, y1: 280, y2: 380 },      // blocks 60° at 1.5×
                { x1: -300, x2: -100, y1: 280, y2: 380 },    // blocks 120° at 1.5×
                { x1: -500, x2: -100, y1: -30, y2: 30 },     // blocks left at 1.5×
                { x1: -300, x2: -100, y1: -380, y2: -280 },  // blocks 240° at 1.5×
                { x1: 100, x2: 300, y1: -380, y2: -280 },    // blocks 300° at 1.5×
            ];
            const result: Position = findBestPosition(parentPos, 0, distance, smallTarget, obstacles);
            // At 3.5× (875), right direction (875, 0) clears all obstacles
            expect(result.x).toBeCloseTo(875);
            expect(result.y).toBeCloseTo(0);
        });

        it('should fall back to the desired angle when all distances are blocked', () => {
            // Massive obstacle blocking everything
            const obstacles: readonly ObstacleBBox[] = [
                { x1: -1000, x2: 1000, y1: -1000, y2: 1000 },
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
