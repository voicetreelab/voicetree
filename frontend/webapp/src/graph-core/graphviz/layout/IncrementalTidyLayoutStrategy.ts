/**
 * IncrementalTidyLayoutStrategy: WASM-backed incremental tidy tree layout
 *
 * Uses Rust/WASM implementation for both full and partial layouts.
 * When nodes are added incrementally, only affected subtrees are re-laid out.
 *
 * Algorithm (from blog.md):
 * - Build set of changed nodes + all their ancestors
 * - Invalidate thread pointers for siblings of changed nodes
 * - Re-layout only the affected subtrees
 * - Time complexity: O(d) where d is max depth of changed nodes
 *
 * Architecture:
 * - Maintains persistent WASM Tidy instance between calls
 * - String node IDs → numeric IDs for WASM
 * - Uses partial_layout() for incremental updates
 * - Falls back to full layout when cache is stale
 */

import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  Position,
  NodeInfo
} from './types';
import { Tidy } from '@/graph-core/wasm-tidy/wasm';

export class IncrementalTidyLayoutStrategy implements PositioningStrategy {
  name = 'incremental-tidy-layout';

  private readonly PARENT_CHILD_MARGIN = 300;
  private readonly PEER_MARGIN = 260;

  // Persistent WASM instance for incremental updates
  private tidy: Tidy | null = null;

  // ID mappings for WASM
  private stringToNum = new Map<string, number>();
  private numToString = new Map<number, string>();
  private nextId = 0;

  // Track what nodes exist in WASM
  private wasmNodeIds = new Set<string>();

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();
    const allNodes = [...context.nodes, ...context.newNodes];

    if (allNodes.length === 0) {
      return { positions };
    }

    // Check if this is an incremental update
    const isIncremental = context.newNodes.length > 0 &&
                          context.nodes.length > 0 &&
                          this.tidy !== null;

    if (isIncremental) {
      console.log(`[IncrementalTidy] Partial layout for ${context.newNodes.length} new nodes`);
      return this.partialRelayout(context);
    } else {
      console.log(`[IncrementalTidy] Full layout for ${allNodes.length} nodes`);
      return this.fullLayout(context);
    }
  }

  private fullLayout(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();
    const allNodes = [...context.nodes, ...context.newNodes];

    // Reset ID mappings
    this.stringToNum.clear();
    this.numToString.clear();
    this.wasmNodeIds.clear();
    this.nextId = 0;

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
    console.log(`[IncrementalTidy] Full layout for ${components.length} disconnected component(s)`);

    // Layout each component separately
    let offsetX = 0;
    const COMPONENT_SPACING = 400;

    for (const component of components) {
      const componentPositions = this.layoutComponentFull(component, parentMap);

      // Find bounding box
      const componentXs = Array.from(componentPositions.values()).map(p => p.x);
      const minX = Math.min(...componentXs);
      const maxX = Math.max(...componentXs);
      const componentWidth = maxX - minX;

      // Shift component
      const shiftX = offsetX - minX;
      for (const [nodeId, pos] of componentPositions.entries()) {
        positions.set(nodeId, { x: pos.x + shiftX, y: pos.y });
      }

      offsetX += componentWidth + COMPONENT_SPACING;
    }

    return { positions };
  }

  /**
   * Layout a single component for full layout
   */
  private layoutComponentFull(
    nodes: NodeInfo[],
    globalParentMap: Map<string, string>
  ): Map<string, Position> {
    const positions = new Map<string, Position>();

    // Create fresh WASM instance for this component
    this.tidy = Tidy.with_tidy_layout(this.PARENT_CHILD_MARGIN, this.PEER_MARGIN);

    // Build ID mappings for component
    for (const node of nodes) {
      this.stringToNum.set(node.id, this.nextId);
      this.numToString.set(this.nextId, node.id);
      this.wasmNodeIds.add(node.id);
      this.nextId++;
    }

    // Build component parent map
    const componentNodeIds = new Set(nodes.map(n => n.id));
    const componentParentMap = new Map<string, string>();

    for (const node of nodes) {
      const parentId = globalParentMap.get(node.id);
      if (parentId && componentNodeIds.has(parentId)) {
        componentParentMap.set(node.id, parentId);
      }
    }

    // Topological sort
    const sortedNodes = this.topologicalSort(nodes, componentParentMap);

    // Add nodes to WASM
    const nullId = Tidy.null_id();
    for (const node of sortedNodes) {
      const id = this.stringToNum.get(node.id)!;
      const parentStringId = componentParentMap.get(node.id);
      const parentId = parentStringId !== undefined ? this.stringToNum.get(parentStringId)! : nullId;

      this.tidy.add_node(id, node.size.width, node.size.height, parentId);
    }

    // Layout
    this.tidy.layout();

    // Get positions
    const posArray = this.tidy.get_pos();
    for (let i = 0; i < posArray.length; i += 3) {
      const numId = posArray[i];
      const x = posArray[i + 1];
      const y = posArray[i + 2];
      const stringId = this.numToString.get(numId);

      if (stringId) {
        positions.set(stringId, { x, y });
      }
    }

    return positions;
  }

  /**
   * Find disconnected components in the graph
   */
  private findDisconnectedComponents(
    nodes: NodeInfo[],
    parentMap: Map<string, string>
  ): NodeInfo[][] {
    // Build bidirectional adjacency map
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

  private partialRelayout(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();

    // Validate cache state
    if (!this.tidy || this.wasmNodeIds.size === 0) {
      console.log('[IncrementalTidy] Cache invalid, performing full layout');
      return this.fullLayout(context);
    }

    const allNodes = [...context.nodes, ...context.newNodes];
    const changedNodeIds: number[] = [];

    // Add new nodes to WASM
    const nullId = Tidy.null_id();
    const nodeIds = new Set(allNodes.map(n => n.id));

    for (const nodeInfo of context.newNodes) {
      // Assign numeric ID if new
      if (!this.stringToNum.has(nodeInfo.id)) {
        this.stringToNum.set(nodeInfo.id, this.nextId);
        this.numToString.set(this.nextId, nodeInfo.id);
        this.nextId++;
      }

      const id = this.stringToNum.get(nodeInfo.id)!;
      changedNodeIds.push(id);

      // Determine parent
      let parentId = nullId;
      if (nodeInfo.parentId && nodeIds.has(nodeInfo.parentId)) {
        const parentNumId = this.stringToNum.get(nodeInfo.parentId);
        if (parentNumId !== undefined) {
          parentId = parentNumId;
        }
      } else if (nodeInfo.linkedNodeIds && nodeInfo.linkedNodeIds.length > 0) {
        for (const linkedId of nodeInfo.linkedNodeIds) {
          if (linkedId !== nodeInfo.id && nodeIds.has(linkedId)) {
            const linkedNumId = this.stringToNum.get(linkedId);
            if (linkedNumId !== undefined) {
              parentId = linkedNumId;
              break;
            }
          }
        }
      }

      // Add or update node in WASM
      if (!this.wasmNodeIds.has(nodeInfo.id)) {
        this.tidy.add_node(id, nodeInfo.size.width, nodeInfo.size.height, parentId);
        this.wasmNodeIds.add(nodeInfo.id);
      }
    }

    if (changedNodeIds.length === 0) {
      console.warn('[IncrementalTidy] No changed nodes found');
      return { positions };
    }

    // Use WASM partial_layout
    const changedIdsArray = new Uint32Array(changedNodeIds);
    this.tidy.partial_layout(changedIdsArray);

    // Get all positions (including unchanged nodes that may have shifted)
    const posArray = this.tidy.get_pos();
    for (let i = 0; i < posArray.length; i += 3) {
      const numId = posArray[i];
      const x = posArray[i + 1];
      const y = posArray[i + 2];
      const stringId = this.numToString.get(numId);

      if (stringId) {
        positions.set(stringId, { x, y });
      }
    }

    return { positions };
  }

  /**
   * Topologically sort nodes so parents come before children
   * Required by Rust add_node() which panics if parent doesn't exist
   */
  private topologicalSort(nodes: NodeInfo[], parentMap: Map<string, string>): NodeInfo[] {
    const nodeMap = new Map<string, NodeInfo>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // Find roots (nodes with no parent)
    const roots: NodeInfo[] = [];
    for (const node of nodes) {
      if (!parentMap.has(node.id)) {
        roots.push(node);
      }
    }

    // BFS from roots
    const sorted: NodeInfo[] = [];
    const visited = new Set<string>();
    const queue: NodeInfo[] = [...roots];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;

      visited.add(node.id);
      sorted.push(node);

      // Add children to queue
      for (const [childId, parentId] of parentMap.entries()) {
        if (parentId === node.id && !visited.has(childId)) {
          const childNode = nodeMap.get(childId);
          if (childNode) {
            queue.push(childNode);
          }
        }
      }
    }

    // Add any remaining nodes (disconnected components)
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        sorted.push(node);
      }
    }

    return sorted;
  }
}
