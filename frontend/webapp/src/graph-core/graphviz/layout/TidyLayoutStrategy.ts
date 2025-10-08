/**
 * TidyLayoutStrategy: WASM-backed tidy tree layout algorithm
 *
 * Uses Rust/WASM implementation from zxch3n/tidy for optimal performance.
 * Implements bulk layout strategy - positions all nodes in a single operation.
 *
 * Handles forests (multiple disconnected trees) by:
 * - Detecting disconnected components
 * - Laying out each component separately with WASM
 * - Spacing components horizontally
 *
 * Architecture:
 * - String node IDs → numeric IDs for WASM
 * - Builds tree in WASM via add_node() calls
 * - Calls layout() to compute positions
 * - Converts Float64Array back to Map<string, Position>
 */

import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  Position,
  NodeInfo
} from '@/graph-core/graphviz/layout/types';
import { Tidy } from '@/graph-core/wasm-tidy/wasm';

export class TidyLayoutStrategy implements PositioningStrategy {
  name = 'tidy-layout';

  private readonly PARENT_CHILD_MARGIN = 100;
  private readonly PEER_MARGIN = 200;
  private readonly COMPONENT_SPACING = 400; // Spacing between disconnected components

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();
    const allNodes = [...context.nodes, ...context.newNodes];

    if (allNodes.length === 0) {
      return { positions };
    }

    console.log(`[TidyLayout] Positioning ${allNodes.length} nodes (${context.nodes.length} existing + ${context.newNodes.length} new)`);

    // Build parent map
    const parentMap = new Map<string, string>();
    const nodeIds = new Set(allNodes.map(n => n.id));

    for (const node of allNodes) {
      if (node.parentId && nodeIds.has(node.parentId)) {
        parentMap.set(node.id, node.parentId);
      } else if (node.linkedNodeIds && node.linkedNodeIds.length > 0) {
        for (const linkedId of node.linkedNodeIds) {
          if (linkedId !== node.id && nodeIds.has(linkedId)) {
            parentMap.set(node.id, linkedId);
            break;
          }
        }
      }
    }

    // Find disconnected components
    const components = this.findDisconnectedComponents(allNodes, parentMap);
    console.log(`[TidyLayout] Found ${components.length} disconnected component(s)`);

    // Layout each component separately
    let offsetX = 0;

    for (let compIndex = 0; compIndex < components.length; compIndex++) {
      const component = components[compIndex];
      const componentPositions = this.layoutComponent(component, parentMap);

      // Find bounding box of this component
      const componentXs = Array.from(componentPositions.values()).map(p => p.x);
      const minX = Math.min(...componentXs);
      const maxX = Math.max(...componentXs);
      const componentWidth = maxX - minX;

      // Shift component to avoid overlap
      const shiftX = offsetX - minX;
      for (const [nodeId, pos] of componentPositions.entries()) {
        positions.set(nodeId, { x: pos.x + shiftX, y: pos.y });
      }

      // Update offset for next component
      offsetX += componentWidth + this.COMPONENT_SPACING;
    }

    console.log(`[TidyLayout] Positioned ${positions.size} nodes across ${components.length} component(s)`);

    return { positions };
  }

  /**
   * Find disconnected components in the graph
   * Returns array of component node sets
   */
  private findDisconnectedComponents(
    nodes: NodeInfo[],
    parentMap: Map<string, string>
  ): NodeInfo[][] {
    // Build bidirectional adjacency map (parent-child + child-parent)
    const adjacency = new Map<string, Set<string>>();

    for (const node of nodes) {
      if (!adjacency.has(node.id)) {
        adjacency.set(node.id, new Set());
      }

      const parentId = parentMap.get(node.id);
      if (parentId) {
        adjacency.get(node.id)!.add(parentId);
        if (!adjacency.has(parentId)) {
          adjacency.set(parentId, new Set());
        }
        adjacency.get(parentId)!.add(node.id);
      }
    }

    // Find components using DFS
    const visited = new Set<string>();
    const components: NodeInfo[][] = [];
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    for (const node of nodes) {
      if (visited.has(node.id)) continue;

      // Start new component
      const component: NodeInfo[] = [];
      const stack = [node.id];

      while (stack.length > 0) {
        const nodeId = stack.pop()!;
        if (visited.has(nodeId)) continue;

        visited.add(nodeId);
        const nodeData = nodeMap.get(nodeId);
        if (nodeData) {
          component.push(nodeData);
        }

        // Add connected nodes
        const neighbors = adjacency.get(nodeId) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor);
          }
        }
      }

      if (component.length > 0) {
        components.push(component);
      }
    }

    return components;
  }

  /**
   * Layout a single connected component using WASM
   */
  private layoutComponent(
    nodes: NodeInfo[],
    globalParentMap: Map<string, string>
  ): Map<string, Position> {
    const positions = new Map<string, Position>();

    // Create fresh WASM instance for this component
    const tidy = Tidy.with_tidy_layout(this.PARENT_CHILD_MARGIN, this.PEER_MARGIN);

    // Build ID mappings for this component
    const stringToNum = new Map<string, number>();
    const numToString = new Map<number, string>();
    let nextId = 0;

    for (const node of nodes) {
      stringToNum.set(node.id, nextId);
      numToString.set(nextId, node.id);
      nextId++;
    }

    // Build parent map for this component
    const componentNodeIds = new Set(nodes.map(n => n.id));
    const componentParentMap = new Map<string, string>();

    for (const node of nodes) {
      const parentId = globalParentMap.get(node.id);
      if (parentId && componentNodeIds.has(parentId)) {
        componentParentMap.set(node.id, parentId);
      }
    }

    // Topological sort (parents before children)
    const sortedNodes = this.topologicalSort(nodes, componentParentMap);

    // Add nodes to WASM
    const nullId = Tidy.null_id();
    for (const node of sortedNodes) {
      const id = stringToNum.get(node.id)!;
      const parentStringId = componentParentMap.get(node.id);
      const parentId = parentStringId !== undefined ? stringToNum.get(parentStringId)! : nullId;

      tidy.add_node(id, node.size.width, node.size.height, parentId);
    }

    // Compute layout
    tidy.layout();

    // Get positions
    const posArray = tidy.get_pos();
    for (let i = 0; i < posArray.length; i += 3) {
      const numId = posArray[i];
      const x = posArray[i + 1];
      const y = posArray[i + 2];
      const stringId = numToString.get(numId);

      if (stringId) {
        positions.set(stringId, { x, y });
      }
    }

    return positions;
  }

  /**
   * Topological sort: ensures parents are added before children.
   * Uses BFS from roots to guarantee parent-first ordering.
   */
  private topologicalSort(
    nodes: NodeInfo[],
    parentMap: Map<string, string>
  ): NodeInfo[] {
    // Build children map
    const childrenMap = new Map<string, string[]>();
    for (const node of nodes) {
      const parentId = parentMap.get(node.id);
      if (parentId) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(node.id);
      }
    }

    // Find roots (nodes with no parents in this component)
    const roots: string[] = [];
    for (const node of nodes) {
      if (!parentMap.has(node.id)) {
        roots.push(node.id);
      }
    }

    // BFS from roots
    const sorted: string[] = [];
    const queue = [...roots];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;

      visited.add(nodeId);
      sorted.push(nodeId);

      // Add children to queue
      const children = childrenMap.get(nodeId) || [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }
    }

    // Convert back to node objects in sorted order
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    return sorted.map(id => nodeMap.get(id)!);
  }
}
