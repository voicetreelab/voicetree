/**
 * TidyLayoutStrategy: WASM-backed tidy tree layout algorithm
 *
 * Uses Rust/WASM implementation from zxch3n/tidy for optimal performance.
 * Implements bulk layout strategy - positions all nodes in a single operation.
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
  Position
} from '@/graph-core/graphviz/layout/types';
import { Tidy } from '@/graph-core/wasm-tidy/wasm';

export class TidyLayoutStrategy implements PositioningStrategy {
  name = 'tidy-layout';

  private readonly PARENT_CHILD_MARGIN = 100;
  private readonly PEER_MARGIN = 200;
  private tidy: Tidy | null = null;

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();
    const allNodes = [...context.nodes, ...context.newNodes];

    if (allNodes.length === 0) {
      return { positions };
    }

    console.log(`[TidyLayout] Positioning ${allNodes.length} nodes (${context.nodes.length} existing + ${context.newNodes.length} new)`);

    // Create fresh WASM instance for bulk layout (no clear/reset method available)
    this.tidy = Tidy.with_tidy_layout(this.PARENT_CHILD_MARGIN, this.PEER_MARGIN);

    // Build ID mappings
    const stringToNum = new Map<string, number>();
    const numToString = new Map<number, string>();
    let nextId = 0;

    for (const node of allNodes) {
      stringToNum.set(node.id, nextId);
      numToString.set(nextId, node.id);
      nextId++;
    }

    // Build tree structure to find parents
    const parentMap = new Map<string, string>();
    const nodeIds = new Set(allNodes.map(n => n.id));

    for (const node of allNodes) {
      // Prefer canonical parentId structure
      if (node.parentId && nodeIds.has(node.parentId)) {
        parentMap.set(node.id, node.parentId);
      } else if (node.linkedNodeIds && node.linkedNodeIds.length > 0) {
        // Fallback to linkedNodeIds
        for (const linkedId of node.linkedNodeIds) {
          if (linkedId !== node.id && nodeIds.has(linkedId)) {
            parentMap.set(node.id, linkedId);
            break;
          }
        }
      }
    }

    // Sort nodes in topological order (parents before children)
    // CRITICAL: Rust add_node() requires parent to exist before adding child
    const sortedNodes = this.topologicalSort(allNodes, parentMap);

    // Add nodes to WASM in topological order
    const nullId = Tidy.null_id();
    for (const node of sortedNodes) {
      const id = stringToNum.get(node.id)!;
      const parentStringId = parentMap.get(node.id);
      const parentId = parentStringId !== undefined ? stringToNum.get(parentStringId)! : nullId;

      this.tidy.add_node(id, node.size.width, node.size.height, parentId);
    }

    // Compute layout
    this.tidy.layout();

    // Get positions: [id1, x1, y1, id2, x2, y2, ...]
    const posArray = this.tidy.get_pos();

    // Convert to Map
    for (let i = 0; i < posArray.length; i += 3) {
      const numId = posArray[i];
      const x = posArray[i + 1];
      const y = posArray[i + 2];
      const stringId = numToString.get(numId);

      if (stringId) {
        positions.set(stringId, { x, y });
      }
    }

    console.log(`[TidyLayout] Positioned ${positions.size} nodes using WASM`);

    return { positions };
  }

  /**
   * Topological sort: ensures parents are added before children.
   * Uses BFS from roots to guarantee parent-first ordering.
   */
  private topologicalSort(
    nodes: Array<{ id: string; [key: string]: unknown }>,
    parentMap: Map<string, string>
  ): Array<{ id: string; [key: string]: unknown }> {
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

    // Find roots (nodes with no parents)
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
