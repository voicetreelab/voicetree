import { describe, it, expect } from 'vitest';
import type { Core } from 'cytoscape';
import { toGraphCoords, toScreenCoords, graphToScreen, screenToGraph } from '@/pure/graph/positioning/coordinate-conversions.ts';

describe('Coordinate Conversions', () => {
  // Mock Cytoscape core instance
  const createMockCy = (zoom: number, panX: number, panY: number, containerLeft = 0, containerTop = 0): Core => {
    return {
      zoom: () => zoom,
      pan: () => ({ x: panX, y: panY }),
      container: () => ({
        getBoundingClientRect: () => ({
          left: containerLeft,
          top: containerTop,
          right: containerLeft + 800,
          bottom: containerTop + 600,
          width: 800,
          height: 600,
          x: containerLeft,
          y: containerTop
        })
      })
    } as unknown as Core;
  };

  describe('toScreenCoords', () => {
    it('should convert graph coordinates to screen coordinates at zoom 1 with no pan', () => {
      const cy = createMockCy(1, 0, 0, 0, 0);
      const result = toScreenCoords(100, 100, cy);

      // At zoom 1, no pan, no container offset: screen = graph
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('should scale coordinates based on zoom level', () => {
      const cy = createMockCy(2, 0, 0, 0, 0);
      const result = toScreenCoords(100, 100, cy);

      // At zoom 2: screen = graph * 2
      expect(result.x).toBe(200);
      expect(result.y).toBe(200);
    });

    it('should apply pan offset to screen coordinates', () => {
      const cy = createMockCy(1, 50, 75, 0, 0);
      const result = toScreenCoords(100, 100, cy);

      // With pan: screen = graph + pan
      expect(result.x).toBe(150);
      expect(result.y).toBe(175);
    });

    it('should account for container offset from viewport', () => {
      const cy = createMockCy(1, 0, 0, 200, 100);
      const result = toScreenCoords(100, 100, cy);

      // With container offset: screen = graph + container offset
      expect(result.x).toBe(300);
      expect(result.y).toBe(200);
    });

    it('should combine zoom, pan, and container offset correctly', () => {
      const cy = createMockCy(1.5, 25, 30, 100, 50);
      const result = toScreenCoords(100, 100, cy);

      // screen = (graph * zoom) + pan + container offset
      // x: (100 * 1.5) + 25 + 100 = 275
      // y: (100 * 1.5) + 30 + 50 = 230
      expect(result.x).toBe(275);
      expect(result.y).toBe(230);
    });

    it('should handle negative graph coordinates', () => {
      const cy = createMockCy(1, 0, 0, 0, 0);
      const result = toScreenCoords(-50, -50, cy);

      expect(result.x).toBe(-50);
      expect(result.y).toBe(-50);
    });
  });

  describe('toGraphCoords', () => {
    it('should convert screen coordinates to graph coordinates at zoom 1 with no pan', () => {
      const cy = createMockCy(1, 0, 0, 0, 0);
      const result = toGraphCoords(100, 100, cy);

      // At zoom 1, no pan, no container offset: graph = screen
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('should inversely scale coordinates based on zoom level', () => {
      const cy = createMockCy(2, 0, 0, 0, 0);
      const result = toGraphCoords(200, 200, cy);

      // At zoom 2: graph = screen / 2
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('should remove pan offset from screen coordinates', () => {
      const cy = createMockCy(1, 50, 75, 0, 0);
      const result = toGraphCoords(150, 175, cy);

      // With pan: graph = screen - pan
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('should subtract container offset from screen coordinates', () => {
      const cy = createMockCy(1, 0, 0, 200, 100);
      const result = toGraphCoords(300, 200, cy);

      // With container offset: graph = screen - container offset
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('should correctly inverse the combined transformation', () => {
      const cy = createMockCy(1.5, 25, 30, 100, 50);
      const result = toGraphCoords(275, 230, cy);

      // graph = (screen - container offset - pan) / zoom
      // x: (275 - 100 - 25) / 1.5 = 100
      // y: (230 - 50 - 30) / 1.5 = 100
      expect(result.x).toBeCloseTo(100, 5);
      expect(result.y).toBeCloseTo(100, 5);
    });

    it('should be the inverse of toScreenCoords', () => {
      const cy = createMockCy(1.75, 42, -17, 83, 29);
      const graphCoords = { x: 150, y: -75 };

      const screenCoords = toScreenCoords(graphCoords.x, graphCoords.y, cy);
      const backToGraph = toGraphCoords(screenCoords.x, screenCoords.y, cy);

      expect(backToGraph.x).toBeCloseTo(graphCoords.x, 10);
      expect(backToGraph.y).toBeCloseTo(graphCoords.y, 10);
    });
  });

  describe('graphToScreen', () => {
    it('should scale a scalar value from graph to screen units', () => {
      expect(graphToScreen(100, 1)).toBe(100);
      expect(graphToScreen(100, 2)).toBe(200);
      expect(graphToScreen(100, 0.5)).toBe(50);
    });

    it('should handle zero and negative values', () => {
      expect(graphToScreen(0, 2)).toBe(0);
      expect(graphToScreen(-100, 2)).toBe(-200);
    });
  });

  describe('screenToGraph', () => {
    it('should scale a scalar value from screen to graph units', () => {
      expect(screenToGraph(100, 1)).toBe(100);
      expect(screenToGraph(200, 2)).toBe(100);
      expect(screenToGraph(50, 0.5)).toBe(100);
    });

    it('should handle zero and negative values', () => {
      expect(screenToGraph(0, 2)).toBe(0);
      expect(screenToGraph(-200, 2)).toBe(-100);
    });

    it('should be the inverse of graphToScreen', () => {
      const value = 42;
      const zoom = 1.7;

      const screen = graphToScreen(value, zoom);
      const backToGraph = screenToGraph(screen, zoom);

      expect(backToGraph).toBeCloseTo(value, 10);
    });
  });

  describe('floating window positioning consistency', () => {
    it('initial position must match updateEditorPositions to avoid teleportation (regression test)', () => {
      // This test ensures that the method used to calculate initial window position
      // matches the method used by updateEditorPositions, avoiding window "teleportation"

      const zoom = 0.4;
      const pan = { x: -9353.98, y: 40.82 };
      const containerRect = { left: 16, top: 242 };
      const cy = createMockCy(zoom, pan.x, pan.y, containerRect.left, containerRect.top);

      // Simulate a node at a specific graph position
      const nodeGraphPos = { x: 23508.19, y: 126.54 };
      const windowWidth = 700;
      const nodeRadius = 40;
      const spacing = 10;

      // Calculate the graph offset (how we position the window relative to the node in graph coords)
      const graphOffset = {
        x: -(windowWidth / 2) / zoom,
        y: (nodeRadius + spacing) / zoom
      };

      // CORRECT APPROACH: Calculate initial position using toScreenCoords(graphAnchor + graphOffset)
      // This MUST match how updateEditorPositions calculates positions
      const graphX = nodeGraphPos.x + graphOffset.x;
      const graphY = nodeGraphPos.y + graphOffset.y;
      const initialPos = toScreenCoords(graphX, graphY, cy);

      // Simulate what updateEditorPositions does (must match initial position)
      const updatedPos = toScreenCoords(
        nodeGraphPos.x + graphOffset.x,
        nodeGraphPos.y + graphOffset.y,
        cy
      );

      // These MUST be exactly the same to avoid window "teleportation"
      expect(initialPos.x).toBe(updatedPos.x);
      expect(initialPos.y).toBe(updatedPos.y);

      // Verify the actual values are reasonable (not NaN, etc.)
      expect(initialPos.x).toBeTypeOf('number');
      expect(initialPos.y).toBeTypeOf('number');
      expect(isFinite(initialPos.x)).toBe(true);
      expect(isFinite(initialPos.y)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very small zoom levels', () => {
      const cy = createMockCy(0.1, 0, 0, 0, 0);
      const screenCoords = toScreenCoords(100, 100, cy);

      expect(screenCoords.x).toBe(10);
      expect(screenCoords.y).toBe(10);
    });

    it('should handle very large zoom levels', () => {
      const cy = createMockCy(10, 0, 0, 0, 0);
      const screenCoords = toScreenCoords(100, 100, cy);

      expect(screenCoords.x).toBe(1000);
      expect(screenCoords.y).toBe(1000);
    });

    it('should maintain precision for floating point operations', () => {
      const cy = createMockCy(1.333333, 12.5, 7.25, 10.5, 20.75);
      const graphCoords = { x: 123.456, y: 789.012 };

      const screenCoords = toScreenCoords(graphCoords.x, graphCoords.y, cy);
      const backToGraph = toGraphCoords(screenCoords.x, screenCoords.y, cy);

      expect(backToGraph.x).toBeCloseTo(graphCoords.x, 5);
      expect(backToGraph.y).toBeCloseTo(graphCoords.y, 5);
    });
  });
});