import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LayoutManager } from '@/graph-core/graphviz/layout/LayoutManager';
import type { PositioningStrategy, Position } from '@/graph-core/graphviz/layout/types';
import type cytoscape from 'cytoscape';

describe('LayoutManager', () => {
  let layoutManager: LayoutManager;
  let mockStrategy: PositioningStrategy;
  let mockCy: cytoscape.Core;

  beforeEach(() => {
    // Create mock strategy
    mockStrategy = {
      position: vi.fn(async () => ({
        positions: new Map<string, Position>([
          ['node1', { x: 100, y: 100 }],
          ['node2', { x: 200, y: 200 }]
        ])
      }))
    };

    // Create mock Cytoscape instance
    const mockNodes = [
      {
        id: () => 'node1',
        position: vi.fn(() => ({ x: 0, y: 0 })),
        data: vi.fn(),
        boundingBox: vi.fn(() => ({ w: 100, h: 50 })),
        connectedEdges: vi.fn(() => ({ toArray: () => [] })),
        animate: vi.fn(),
        length: 1
      },
      {
        id: () => 'node2',
        position: vi.fn(() => ({ x: 0, y: 0 })),
        data: vi.fn(),
        boundingBox: vi.fn(() => ({ w: 80, h: 40 })),
        connectedEdges: vi.fn(() => ({ toArray: () => [] })),
        animate: vi.fn(),
        length: 1
      }
    ];

    mockCy = {
      nodes: vi.fn(() => ({
        forEach: (callback: (node: unknown) => void) => mockNodes.forEach(callback),
        length: mockNodes.length,
        toArray: () => mockNodes
      })),
      $id: vi.fn((id: string) => {
        const node = mockNodes.find(n => n.id() === id);
        return node || { length: 0 };
      }),
      width: vi.fn(() => 800),
      height: vi.fn(() => 600),
      startBatch: vi.fn(),
      endBatch: vi.fn()
    } as unknown as cytoscape.Core;

    layoutManager = new LayoutManager(mockStrategy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateNodeDimensions', () => {
    it('should call strategy.updateNodeDimensions when strategy supports it', async () => {
      // Add updateNodeDimensions to strategy
      const updateNodeDimensionsSpy = vi.fn(async () =>
        new Map<string, Position>([
          ['node1', { x: 150, y: 150 }],
          ['node2', { x: 250, y: 250 }]
        ])
      );

      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: updateNodeDimensionsSpy
      };

      layoutManager.setStrategy(strategyWithUpdate);

      await layoutManager.updateNodeDimensions(mockCy, ['node1']);

      // Should have called strategy's updateNodeDimensions
      expect(updateNodeDimensionsSpy).toHaveBeenCalledWith(mockCy, ['node1']);
    });

    it('should call applyPositions with positions returned from strategy', async () => {
      const expectedPositions = new Map<string, Position>([
        ['node1', { x: 150, y: 150 }],
        ['node2', { x: 250, y: 250 }]
      ]);

      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: vi.fn(async () => expectedPositions)
      };

      layoutManager.setStrategy(strategyWithUpdate);

      await layoutManager.updateNodeDimensions(mockCy, ['node1', 'node2']);

      // Check that positions were applied (nodes were animated)
      const node1 = mockCy.$id('node1') as unknown as { animate: ReturnType<typeof vi.fn> };
      const node2 = mockCy.$id('node2') as unknown as { animate: ReturnType<typeof vi.fn> };

      // In test environment, animation duration is 0, so position is set directly
      expect(node1.animate || node1.position).toHaveBeenCalled();
      expect(node2.animate || node2.position).toHaveBeenCalled();
    });

    it('should fallback to applyLayout when strategy does not support updateNodeDimensions', async () => {
      // Use strategy without updateNodeDimensions
      const layoutSpy = vi.spyOn(layoutManager, 'applyLayout');

      await layoutManager.updateNodeDimensions(mockCy, ['node1']);

      // Should fallback to applyLayout
      expect(layoutSpy).toHaveBeenCalledWith(mockCy, ['node1']);
    });

    it('should handle empty nodeIds array', async () => {
      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: vi.fn(async () => new Map<string, Position>())
      };

      layoutManager.setStrategy(strategyWithUpdate);

      await layoutManager.updateNodeDimensions(mockCy, []);

      // Should still call the strategy
      expect(strategyWithUpdate.updateNodeDimensions).toHaveBeenCalledWith(mockCy, []);
    });

    it('should batch position updates using startBatch/endBatch', async () => {
      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: vi.fn(async () =>
          new Map<string, Position>([
            ['node1', { x: 100, y: 100 }],
            ['node2', { x: 200, y: 200 }]
          ])
        )
      };

      layoutManager.setStrategy(strategyWithUpdate);

      await layoutManager.updateNodeDimensions(mockCy, ['node1', 'node2']);

      // Should have batched the updates
      expect(mockCy.startBatch).toHaveBeenCalled();
      expect(mockCy.endBatch).toHaveBeenCalled();

      // startBatch should be called before endBatch
      const startBatchOrder = (mockCy.startBatch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const endBatchOrder = (mockCy.endBatch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      expect(startBatchOrder).toBeLessThan(endBatchOrder);
    });

    it('should handle multiple nodes updating simultaneously', async () => {
      const expectedPositions = new Map<string, Position>([
        ['node1', { x: 150, y: 150 }],
        ['node2', { x: 250, y: 250 }]
      ]);

      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: vi.fn(async () => expectedPositions)
      };

      layoutManager.setStrategy(strategyWithUpdate);

      await layoutManager.updateNodeDimensions(mockCy, ['node1', 'node2']);

      // Both nodes should be passed to strategy
      expect(strategyWithUpdate.updateNodeDimensions).toHaveBeenCalledWith(mockCy, ['node1', 'node2']);
    });

    it('should apply positions only to nodes that exist in Cytoscape', async () => {
      const positions = new Map<string, Position>([
        ['node1', { x: 100, y: 100 }],
        ['non-existent', { x: 200, y: 200 }] // This node doesn't exist
      ]);

      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: vi.fn(async () => positions)
      };

      layoutManager.setStrategy(strategyWithUpdate);

      // Should not throw even though 'non-existent' node doesn't exist
      await expect(layoutManager.updateNodeDimensions(mockCy, ['node1', 'non-existent'])).resolves.not.toThrow();

      // node1 should be updated
      const node1 = mockCy.$id('node1') as unknown as { animate: ReturnType<typeof vi.fn>, position: ReturnType<typeof vi.fn> };
      expect(node1.animate || node1.position).toHaveBeenCalled();
    });
  });

  describe('setStrategy', () => {
    it('should allow changing the positioning strategy', async () => {
      const newStrategy: PositioningStrategy = {
        position: vi.fn(async () => ({
          positions: new Map<string, Position>([['node1', { x: 300, y: 300 }]])
        }))
      };

      layoutManager.setStrategy(newStrategy);

      await layoutManager.applyLayout(mockCy, ['node1']);

      // New strategy should be used
      expect(newStrategy.position).toHaveBeenCalled();
      expect(mockStrategy.position).not.toHaveBeenCalled();
    });
  });

  describe('Debouncing resize events (Integration with floatingwindow:resize)', () => {
    it('should debounce rapid resize events for the same node', async () => {
      vi.useFakeTimers();

      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: vi.fn(async () =>
          new Map<string, Position>([['node1', { x: 100, y: 100 }]])
        )
      };

      layoutManager.setStrategy(strategyWithUpdate);

      // Simulate rapid resize events
      const updatePromise1 = layoutManager.updateNodeDimensions(mockCy, ['node1']);
      const updatePromise2 = layoutManager.updateNodeDimensions(mockCy, ['node1']);
      const updatePromise3 = layoutManager.updateNodeDimensions(mockCy, ['node1']);

      // All promises should resolve
      await Promise.all([updatePromise1, updatePromise2, updatePromise3]);

      // All three calls should go through (no debouncing at LayoutManager level)
      // Debouncing should happen at the event listener level, not in LayoutManager itself
      expect(strategyWithUpdate.updateNodeDimensions).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should handle dimension updates for multiple different nodes simultaneously', async () => {
      const strategyWithUpdate = {
        ...mockStrategy,
        updateNodeDimensions: vi.fn(async (cy: cytoscape.Core, nodeIds: string[]) => {
          const positions = new Map<string, Position>();
          nodeIds.forEach(id => {
            positions.set(id, { x: 100, y: 100 });
          });
          return positions;
        })
      };

      layoutManager.setStrategy(strategyWithUpdate);

      // Update multiple nodes at once
      await layoutManager.updateNodeDimensions(mockCy, ['node1', 'node2']);

      // Should be called with both node IDs
      expect(strategyWithUpdate.updateNodeDimensions).toHaveBeenCalledWith(mockCy, ['node1', 'node2']);
    });
  });
});
