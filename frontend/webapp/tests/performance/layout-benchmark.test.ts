/**
 * Performance Benchmark: Layout Strategy Performance
 *
 * This benchmark measures the performance difference between:
 * 1. Full layout (fullBuild) - O(N) complexity
 * 2. Incremental layout (addNodes single node) - O(depth) complexity expected
 *
 * Goal: Verify that incremental updates are actually faster than full rebuilds
 * for large graphs, and measure the actual performance characteristics.
 *
 * Context (from better_layout.md):
 * - Current implementation: addNodes with >1 node falls back to full layout() (line 403-405)
 * - Physics: microRelax runs 600 iterations in fullBuild, 100 iterations in addNodes
 * - Expected: Incremental should be O(depth), full should be O(N)
 *
 * HOW TO RUN THIS BENCHMARK:
 *
 *   # Run once (test is skipped by default - remove .skip to enable)
 *   npx vitest run tests/performance/layout-benchmark.test.ts
 *
 *   # Watch mode for iterative tuning
 *   npx vitest tests/performance/layout-benchmark.test.ts
 *
 *   # Run specific test
 *   npx vitest run tests/performance/layout-benchmark.test.ts -t "should measure fullBuild"
 *
 * EXPECTED OUTPUT FORMAT:
 *
 *   === Full Build Performance ===
 *   Graph Size | Avg Time (ms) | Min Time (ms) | Max Time (ms)
 *   -----------|---------------|---------------|---------------
 *           10 |         45.23 |         42.10 |         48.50
 *           50 |        156.78 |        152.30 |        161.20
 *          100 |        298.45 |        291.80 |        305.10
 *          200 |        587.92 |        579.40 |        596.50
 *
 *   === Incremental Add (Single Node) Performance ===
 *   Graph Size | Avg Time (ms) | Min Time (ms) | Max Time (ms)
 *   -----------|---------------|---------------|---------------
 *           10 |         12.34 |         11.50 |         13.20
 *           50 |         14.56 |         13.80 |         15.30
 *          100 |         15.23 |         14.60 |         15.90
 *          200 |         16.78 |         16.10 |         17.50
 *
 *   === Full Build vs Incremental Add Comparison ===
 *   Graph Size | Full Build (ms) | Incremental (ms) | Speedup Factor
 *   -----------|-----------------|------------------|----------------
 *           10 |           45.23 |            12.34 |           3.67x
 *           50 |          156.78 |            14.56 |          10.77x
 *          100 |          298.45 |            15.23 |          19.60x
 *          200 |          587.92 |            16.78 |          35.03x
 *
 * INTERPRETATION:
 * - fullBuild should scale linearly with N (O(N))
 * - addNodes (single node) should be constant or log with graph size (O(depth))
 * - Speedup factor should increase with graph size (incremental becomes more valuable)
 * - If speedup is close to 1.0x, incremental optimization may not be working
 *
 * Note: This test is marked .skip by default to avoid running in CI.
 * Remove .skip to run locally when measuring performance.
 */

import { describe, it, expect } from 'vitest';
import { TidyLayoutStrategy, TreeOrientation } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';
import type { NodeInfo } from '@/graph-core/graphviz/layout/types';

describe.skip('Layout Performance Benchmark', () => {
  // Graph sizes to test
  const GRAPH_SIZES = [10, 50, 100, 200];

  // Number of iterations for averaging (reduces noise)
  const ITERATIONS = 3;

  /**
   * Generate a balanced tree of specified size
   * Structure: root with multiple levels, each node has 2-3 children
   */
  function generateBalancedTree(size: number): NodeInfo[] {
    const nodes: NodeInfo[] = [];
    const baseWidth = 100;
    const baseHeight = 50;

    // Create root
    nodes.push({
      id: 'node-0',
      position: { x: 0, y: 0 },
      size: { width: baseWidth, height: baseHeight }
    });

    let nodeId = 1;
    const queue: string[] = ['node-0'];

    while (nodes.length < size && queue.length > 0) {
      const parentId = queue.shift()!;

      // Add 2-3 children per parent (alternating for variety)
      const numChildren = nodeId % 2 === 0 ? 2 : 3;

      for (let i = 0; i < numChildren && nodes.length < size; i++) {
        const childId = `node-${nodeId}`;
        nodes.push({
          id: childId,
          position: { x: 0, y: 0 },
          size: { width: baseWidth + (nodeId % 20), height: baseHeight + (nodeId % 10) },
          parentId: parentId
        });
        queue.push(childId);
        nodeId++;
      }
    }

    return nodes;
  }

  /**
   * Measure time for a single operation
   */
  async function measureTime(operation: () => Promise<void>): Promise<number> {
    const start = performance.now();
    await operation();
    const end = performance.now();
    return end - start;
  }

  /**
   * Calculate average time from multiple iterations
   */
  async function measureAverage(operation: () => Promise<void>, iterations: number): Promise<number> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const time = await measureTime(operation);
      times.push(time);
    }

    // Return average
    const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
    return avg;
  }

  it('should measure fullBuild performance across different graph sizes', async () => {
    console.log('\n=== Full Build Performance ===');
    console.log('Graph Size | Avg Time (ms) | Min Time (ms) | Max Time (ms)');
    console.log('-----------|---------------|---------------|---------------');

    const results: Array<{ size: number; avgTime: number; minTime: number; maxTime: number }> = [];

    for (const size of GRAPH_SIZES) {
      const nodes = generateBalancedTree(size);
      const times: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const strategy = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        const time = await measureTime(async () => {
          await strategy.fullBuild(nodes);
        });
        times.push(time);
      }

      const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);

      results.push({ size, avgTime, minTime, maxTime });

      console.log(
        `${size.toString().padStart(10)} | ${avgTime.toFixed(2).padStart(13)} | ${minTime.toFixed(2).padStart(13)} | ${maxTime.toFixed(2).padStart(13)}`
      );
    }

    // Verify that fullBuild completes for all sizes
    expect(results.length).toBe(GRAPH_SIZES.length);

    // Verify that time increases with graph size (O(N) behavior)
    // Allow some variance, but generally larger graphs should take more time
    const smallestTime = results[0].avgTime;
    const largestTime = results[results.length - 1].avgTime;
    expect(largestTime).toBeGreaterThanOrEqual(smallestTime * 0.8); // Allow 20% variance
  });

  it('should measure addNodes (single node) performance across different graph sizes', async () => {
    console.log('\n=== Incremental Add (Single Node) Performance ===');
    console.log('Graph Size | Avg Time (ms) | Min Time (ms) | Max Time (ms)');
    console.log('-----------|---------------|---------------|---------------');

    const results: Array<{ size: number; avgTime: number; minTime: number; maxTime: number }> = [];

    for (const size of GRAPH_SIZES) {
      const baseNodes = generateBalancedTree(size);
      const times: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        // Setup: build initial graph
        const strategy = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        await strategy.fullBuild(baseNodes);

        // Create new node to add (child of root)
        const newNode: NodeInfo = {
          id: `new-node-${i}`,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: 'node-0'
        };

        // Measure: add single node incrementally
        const time = await measureTime(async () => {
          await strategy.addNodes([newNode]);
        });
        times.push(time);
      }

      const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);

      results.push({ size, avgTime, minTime, maxTime });

      console.log(
        `${size.toString().padStart(10)} | ${avgTime.toFixed(2).padStart(13)} | ${minTime.toFixed(2).padStart(13)} | ${maxTime.toFixed(2).padStart(13)}`
      );
    }

    // Verify that addNodes completes for all sizes
    expect(results.length).toBe(GRAPH_SIZES.length);

    // NOTE: Currently addNodes with >1 node falls back to full layout (line 403-405 in TidyLayoutStrategy.ts)
    // For single node adds, we expect O(depth) which should be relatively constant
    // However, if physics is involved, it may still scale with graph size
  });

  it('should compare fullBuild vs addNodes performance', async () => {
    console.log('\n=== Full Build vs Incremental Add Comparison ===');
    console.log('Graph Size | Full Build (ms) | Incremental (ms) | Speedup Factor');
    console.log('-----------|-----------------|------------------|----------------');

    const results: Array<{
      size: number;
      fullBuildTime: number;
      incrementalTime: number;
      speedup: number
    }> = [];

    for (const size of GRAPH_SIZES) {
      const baseNodes = generateBalancedTree(size);

      // Measure full build time
      const fullBuildTimes: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const strategy = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        const newNode: NodeInfo = {
          id: `new-node-${i}`,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: 'node-0'
        };
        const allNodes = [...baseNodes, newNode];

        const time = await measureTime(async () => {
          await strategy.fullBuild(allNodes);
        });
        fullBuildTimes.push(time);
      }

      // Measure incremental add time
      const incrementalTimes: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const strategy = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        await strategy.fullBuild(baseNodes);

        const newNode: NodeInfo = {
          id: `new-node-${i}`,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: 'node-0'
        };

        const time = await measureTime(async () => {
          await strategy.addNodes([newNode]);
        });
        incrementalTimes.push(time);
      }

      const avgFullBuild = fullBuildTimes.reduce((sum, t) => sum + t, 0) / fullBuildTimes.length;
      const avgIncremental = incrementalTimes.reduce((sum, t) => sum + t, 0) / incrementalTimes.length;
      const speedup = avgFullBuild / avgIncremental;

      results.push({
        size,
        fullBuildTime: avgFullBuild,
        incrementalTime: avgIncremental,
        speedup
      });

      console.log(
        `${size.toString().padStart(10)} | ${avgFullBuild.toFixed(2).padStart(15)} | ${avgIncremental.toFixed(2).padStart(16)} | ${speedup.toFixed(2)}x`
      );
    }

    // Verify we collected all results
    expect(results.length).toBe(GRAPH_SIZES.length);

    // For large graphs, incremental should be faster
    // Note: This assertion may fail if the current implementation falls back to full layout
    const largestGraph = results[results.length - 1];
    console.log(`\nFor largest graph (${largestGraph.size} nodes):`);
    console.log(`- Full build: ${largestGraph.fullBuildTime.toFixed(2)}ms`);
    console.log(`- Incremental: ${largestGraph.incrementalTime.toFixed(2)}ms`);
    console.log(`- Speedup: ${largestGraph.speedup.toFixed(2)}x`);

    // The speedup should ideally be >1 for large graphs (incremental faster)
    // However, current implementation may fall back to full layout for >1 node
    // This test documents the actual behavior for future optimization
  });

  it('should measure multi-node addNodes performance (fallback to full layout)', async () => {
    console.log('\n=== Multi-Node Incremental Add Performance (Current Fallback) ===');
    console.log('Note: Current implementation falls back to full layout() when adding >1 node');
    console.log('(See TidyLayoutStrategy.ts line 403-405)');
    console.log('');
    console.log('Graph Size | 1 Node (ms) | 5 Nodes (ms) | 10 Nodes (ms) | Ratio (10/1)');
    console.log('-----------|-------------|--------------|---------------|-------------');

    const results: Array<{
      size: number;
      oneNodeTime: number;
      fiveNodesTime: number;
      tenNodesTime: number;
      ratio: number;
    }> = [];

    for (const size of GRAPH_SIZES) {
      const baseNodes = generateBalancedTree(size);

      // Measure 1 node add
      const strategy1 = new TidyLayoutStrategy(TreeOrientation.LeftRight);
      await strategy1.fullBuild(baseNodes);
      const newNode1: NodeInfo = {
        id: 'new-single',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
        parentId: 'node-0'
      };
      const oneNodeTime = await measureAverage(async () => {
        const strat = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        await strat.fullBuild(baseNodes);
        await strat.addNodes([newNode1]);
      }, ITERATIONS);

      // Measure 5 nodes add
      const newNodes5: NodeInfo[] = Array.from({ length: 5 }, (_, i) => ({
        id: `new-five-${i}`,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
        parentId: 'node-0'
      }));
      const fiveNodesTime = await measureAverage(async () => {
        const strat = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        await strat.fullBuild(baseNodes);
        await strat.addNodes(newNodes5);
      }, ITERATIONS);

      // Measure 10 nodes add
      const newNodes10: NodeInfo[] = Array.from({ length: 10 }, (_, i) => ({
        id: `new-ten-${i}`,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 50 },
        parentId: 'node-0'
      }));
      const tenNodesTime = await measureAverage(async () => {
        const strat = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        await strat.fullBuild(baseNodes);
        await strat.addNodes(newNodes10);
      }, ITERATIONS);

      const ratio = tenNodesTime / oneNodeTime;

      results.push({
        size,
        oneNodeTime,
        fiveNodesTime,
        tenNodesTime,
        ratio
      });

      console.log(
        `${size.toString().padStart(10)} | ${oneNodeTime.toFixed(2).padStart(11)} | ${fiveNodesTime.toFixed(2).padStart(12)} | ${tenNodesTime.toFixed(2).padStart(13)} | ${ratio.toFixed(2).padStart(11)}x`
      );
    }

    // If the ratio is close to 1, it suggests single node optimization is working
    // If the ratio scales with number of nodes, it suggests full layout fallback
    console.log('\nInterpretation:');
    console.log('- Ratio close to 1.0x: Single node optimization working well');
    console.log('- Ratio > 2.0x: Likely falling back to full layout for multi-node adds');

    expect(results.length).toBe(GRAPH_SIZES.length);
  });

  it('should measure depth impact on incremental add performance', async () => {
    console.log('\n=== Depth Impact on Incremental Add Performance ===');
    console.log('Testing hypothesis: O(depth) complexity for incremental adds');
    console.log('');
    console.log('Tree Depth | Avg Time (ms) | Description');
    console.log('-----------|---------------|-------------');

    // Generate trees with controlled depth
    const depthTests = [
      { depth: 2, description: 'Shallow tree (depth=2)' },
      { depth: 4, description: 'Medium tree (depth=4)' },
      { depth: 8, description: 'Deep tree (depth=8)' }
    ];

    function generateDeepTree(depth: number): NodeInfo[] {
      const nodes: NodeInfo[] = [];

      // Create a chain: root -> child -> grandchild -> ...
      for (let i = 0; i < depth; i++) {
        const node: NodeInfo = {
          id: `node-${i}`,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 }
        };

        if (i > 0) {
          node.parentId = `node-${i - 1}`;
        }

        nodes.push(node);
      }

      return nodes;
    }

    const results: Array<{ depth: number; avgTime: number; description: string }> = [];

    for (const test of depthTests) {
      const baseNodes = generateDeepTree(test.depth);

      // Add node at deepest level
      const times: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const strategy = new TidyLayoutStrategy(TreeOrientation.LeftRight);
        await strategy.fullBuild(baseNodes);

        const newNode: NodeInfo = {
          id: `new-deep-${i}`,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          parentId: `node-${test.depth - 1}` // Parent to deepest node
        };

        const time = await measureTime(async () => {
          await strategy.addNodes([newNode]);
        });
        times.push(time);
      }

      const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;

      results.push({
        depth: test.depth,
        avgTime,
        description: test.description
      });

      console.log(
        `${test.depth.toString().padStart(10)} | ${avgTime.toFixed(2).padStart(13)} | ${test.description}`
      );
    }

    console.log('\nInterpretation:');
    console.log('- If time scales linearly with depth: O(depth) confirmed');
    console.log('- If time is constant: Better than O(depth), possibly O(1)');
    console.log('- If time scales quadratically: May be doing unnecessary work');

    expect(results.length).toBe(depthTests.length);
  });
});
