/**
 * Deterministic clustered graph generator for performance testing.
 * Pure function — no side effects, no randomness.
 *
 * Generates binary-tree-topology clusters placed in a grid pattern,
 * producing realistic parent-child hierarchies for layout profiling.
 */

export interface GraphElement {
  group: 'nodes' | 'edges';
  data: { id: string; source?: string; target?: string };
  position?: { x: number; y: number };
}

/**
 * Generate a clustered graph with binary-tree topology per cluster.
 *
 * @param clusterCount Number of clusters (e.g. 10)
 * @param nodesPerCluster Nodes per cluster (e.g. 50)
 * @param clusterSpacing Pixels between cluster grid cells (e.g. 50000)
 * @returns Array of Cytoscape element definitions
 */
export function generateClusteredGraph(
  clusterCount: number,
  nodesPerCluster: number,
  clusterSpacing: number
): GraphElement[] {
  const elements: GraphElement[] = [];
  const gridCols = Math.ceil(Math.sqrt(clusterCount));

  for (let c = 0; c < clusterCount; c++) {
    const gridRow = Math.floor(c / gridCols);
    const gridCol = c % gridCols;
    const baseX = gridCol * clusterSpacing;
    const baseY = gridRow * clusterSpacing;
    const prefix = `c${c}`;

    for (let i = 0; i < nodesPerCluster; i++) {
      const nodeId = `${prefix}-n${i}`;
      // Tree-like layout: level-based Y offset, centered X per level
      const level = Math.floor(Math.log2(i + 1));
      const posInLevel = i - (Math.pow(2, level) - 1);
      const levelWidth = Math.pow(2, level);
      const xOffset = ((posInLevel + 0.5) / levelWidth) * 800 - 400;
      const yOffset = level * 120;

      elements.push({
        group: 'nodes',
        data: { id: nodeId },
        position: { x: baseX + xOffset, y: baseY + yOffset },
      });

      // Binary tree edge: connect to parent at floor((i-1)/2)
      if (i > 0) {
        const parentIdx = Math.floor((i - 1) / 2);
        elements.push({
          group: 'edges',
          data: {
            id: `${prefix}-e${i}`,
            source: `${prefix}-n${parentIdx}`,
            target: nodeId,
          },
        });
      }
    }
  }

  return elements;
}

/**
 * Generate update elements: new nodes connected to existing cluster roots.
 *
 * @param clusterCount Number of existing clusters
 * @param nodesPerCluster New nodes to add per cluster
 * @param clusterSpacing Grid spacing (for positioning near roots)
 * @returns Array of Cytoscape element definitions
 */
export function generateUpdateElements(
  clusterCount: number,
  nodesPerCluster: number,
  clusterSpacing: number
): GraphElement[] {
  const elements: GraphElement[] = [];
  const gridCols = Math.ceil(Math.sqrt(clusterCount));

  for (let c = 0; c < clusterCount; c++) {
    const rootId = `c${c}-n0`;
    const gridCol = c % gridCols;
    const gridRow = Math.floor(c / gridCols);

    for (let j = 0; j < nodesPerCluster; j++) {
      const newId = `c${c}-update-${j}`;
      elements.push({
        group: 'nodes',
        data: { id: newId },
        position: {
          x: gridCol * clusterSpacing + j * 100,
          y: gridRow * clusterSpacing + 800,
        },
      });
      elements.push({
        group: 'edges',
        data: { id: `e-update-c${c}-${j}`, source: rootId, target: newId },
      });
    }
  }

  return elements;
}
