/**
 * ReingoldTilfordStrategy: Hierarchical tree layout algorithm
 *
 * This strategy implements a variant of the Reingold-Tilford algorithm for laying out
 * tree structures in a hierarchical manner. It positions nodes in a top-down tree layout
 * with proper spacing and aesthetic centering.
 *
 * Key features:
 * - Parents positioned above children (increasing y-coordinate for depth)
 * - Siblings spaced horizontally at the same y-level
 * - Parents centered over their children
 * - Handles forests (multiple disconnected trees)
 * - Consistent level spacing (vertical) and sibling spacing (horizontal)
 *
 * Algorithm overview:
 * 1. Build tree structure from node links
 * 2. Assign depth levels (BFS from roots)
 * 3. Position nodes recursively (post-order):
 *    - Children positioned first (left to right)
 *    - Parent positioned at center of children
 * 4. Handle multiple trees by spacing them horizontally
 */
import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  Position,
  NodeInfo
} from '@/graph-core/graphviz/layout/types';
import type { Node } from '@/graph-core/types';

// Extended Node with layout-specific fields
interface LayoutNode extends Node {
  depth: number;
  width: number;
  height: number;
  parents: string[];  // Temporary: track multiple parents for DAG->tree conversion
}

export class ReingoldTilfordStrategy implements PositioningStrategy {
  name = 'reingold-tilford';

  private readonly LEVEL_HEIGHT = 150;  // Vertical spacing between levels
  private readonly MIN_SIBLING_SPACING = 100;  // Minimum horizontal spacing between siblings
  private readonly TREE_SPACING = 400;  // Spacing between separate trees in forest (generous for wide nodes)
  private readonly NODE_PADDING = 50;  // Extra padding around each node

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();

    if (context.newNodes.length === 0) {
      return { positions };
    }

    // Debug: Check how many nodes have links
    const nodesWithLinks = context.newNodes.filter(n => n.linkedNodeIds.length > 0);
    console.log(`[ReingoldTilford] Nodes with links: ${nodesWithLinks.length}/${context.newNodes.length}`);
    if (nodesWithLinks.length > 0) {
      console.log(`[ReingoldTilford] Sample node with links:`, {
        id: nodesWithLinks[0].id,
        linkedNodeIds: nodesWithLinks[0].linkedNodeIds
      });
    }

    // Build tree structure
    const layoutNodes = this.buildTree(context.newNodes);

    // Find root nodes (nodes with no parents in the tree)
    // After buildTree, layoutNodes have proper parent-child relationships
    const roots: typeof context.newNodes = [];
    for (const node of context.newNodes) {
      const layoutNode = layoutNodes.get(node.id);
      if (layoutNode && layoutNode.parents.length === 0) {
        roots.push(node);
      }
    }

    console.log(`[ReingoldTilford] Total nodes: ${context.newNodes.length}, Roots found: ${roots.length}`);
    console.log(`[ReingoldTilford] Root IDs:`, roots.map(r => r.id).slice(0, 10));

    if (roots.length === 0) {
      // All nodes have parents - pick one arbitrarily as root
      roots.push(context.newNodes[0]);
      console.log(`[ReingoldTilford] No roots found - using arbitrary root: ${roots[0].id}`);
    }

    // Assign depths via BFS
    this.assignDepths(layoutNodes, roots.map(r => r.id));

    // Position each tree
    let forestOffset = 0;
    const treeSets = this.partitionIntoTrees(layoutNodes, roots.map(r => r.id));

    console.log(`[ReingoldTilford] Partitioned into ${treeSets.length} trees`);

    for (const treeRootIds of treeSets) {
      // Position this tree starting at forestOffset
      const treeWidth = this.positionTree(layoutNodes, treeRootIds, forestOffset);
      console.log(`[ReingoldTilford] Tree with roots [${treeRootIds}] positioned at offset ${forestOffset}, width ${treeWidth}`);
      forestOffset += treeWidth + this.TREE_SPACING;
    }

    // Convert layout positions to result map
    const depthCounts = new Map<number, number>();
    for (const [id, layoutNode] of layoutNodes) {
      positions.set(id, { x: layoutNode.x!, y: layoutNode.y! });
      depthCounts.set(layoutNode.depth, (depthCounts.get(layoutNode.depth) || 0) + 1);
    }

    console.log(`[ReingoldTilford] Depth distribution:`, Array.from(depthCounts.entries()).sort((a,b) => a[0] - b[0]));

    return { positions };
  }

  private buildTree(nodes: NodeInfo[]): Map<string, LayoutNode> {
    const layoutNodes = new Map<string, LayoutNode>();
    const nodeIds = new Set(nodes.map(n => n.id));

    // Initialize layout nodes (extends Node with layout fields)
    for (const node of nodes) {
      layoutNodes.set(node.id, {
        id: node.id,
        label: node.id,
        children: [],
        parents: [],
        depth: 0,
        x: 0,
        y: 0,
        width: node.size.width,
        height: node.size.height
      });
    }

    // Build parent-child relationships
    // linkedNodeIds contains the children (targets of outgoing edges)
    for (const node of nodes) {
      const layoutNode = layoutNodes.get(node.id)!;

      for (const childId of node.linkedNodeIds) {
        // Skip self-references to prevent infinite recursion
        if (childId === node.id) continue;

        if (!nodeIds.has(childId)) continue;

        const childLayoutNode = layoutNodes.get(childId);
        if (!childLayoutNode) continue;

        // node.id is parent of childId (linkedNodeIds contains children/targets)
        layoutNode.children.push(childId);
        childLayoutNode.parents.push(node.id);
      }
    }

    return layoutNodes;
  }

  private assignDepths(layoutNodes: Map<string, LayoutNode>, rootIds: string[]): void {
    const visited = new Set<string>();
    const queue: string[] = [...rootIds];

    // Set root depths to 0
    for (const rootId of rootIds) {
      const node = layoutNodes.get(rootId);
      if (node) {
        node.depth = 0;
        visited.add(rootId);
      }
    }

    // BFS to assign depths
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = layoutNodes.get(nodeId);
      if (!node) continue;

      for (const childId of node.children) {
        if (visited.has(childId)) continue;

        const child = layoutNodes.get(childId);
        if (!child) continue;

        child.depth = node.depth + 1;
        visited.add(childId);
        queue.push(childId);
      }
    }
  }

  private partitionIntoTrees(layoutNodes: Map<string, LayoutNode>, rootIds: string[]): string[][] {
    // For simplicity, treat each root as a separate tree
    // A more sophisticated approach would merge roots that share descendants
    return rootIds.map(rootId => [rootId]);
  }

  private positionTree(layoutNodes: Map<string, LayoutNode>, rootIds: string[], offsetX: number): number {
    let maxWidth = 0;

    for (const rootId of rootIds) {
      const width = this.positionSubtree(layoutNodes, rootId, offsetX);
      maxWidth = Math.max(maxWidth, width);
    }

    return maxWidth;
  }

  private positionSubtree(layoutNodes: Map<string, LayoutNode>, nodeId: string, offsetX: number): number {
    const node = layoutNodes.get(nodeId);
    if (!node) return 0;

    // Base case: leaf node
    if (node.children.length === 0) {
      node.x = offsetX;
      node.y = node.depth * this.LEVEL_HEIGHT;
      // Return width including node size and padding
      return node.width + this.NODE_PADDING;
    }

    // Recursive case: position children first
    let childOffsetX = offsetX;
    const childPositions: number[] = [];

    for (const childId of node.children) {
      const childWidth = this.positionSubtree(layoutNodes, childId, childOffsetX);
      const child = layoutNodes.get(childId);
      if (child) {
        childPositions.push(child.x!);
      }
      childOffsetX += childWidth + this.MIN_SIBLING_SPACING;
    }

    // Position parent at center of children
    if (childPositions.length > 0) {
      const minChildX = Math.min(...childPositions);
      const maxChildX = Math.max(...childPositions);
      node.x = (minChildX + maxChildX) / 2;
    } else {
      node.x = offsetX;
    }

    node.y = node.depth * this.LEVEL_HEIGHT;

    // Return total width used by this subtree (including last child's width)
    const lastChild = node.children.length > 0 ? layoutNodes.get(node.children[node.children.length - 1]) : null;
    const lastChildWidth = lastChild ? lastChild.width : 0;
    return (childOffsetX - offsetX - this.MIN_SIBLING_SPACING) + lastChildWidth + this.NODE_PADDING;
  }
}
