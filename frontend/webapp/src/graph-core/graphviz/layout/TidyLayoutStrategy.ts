/**
 * TidyLayoutStrategy: WASM-backed incremental tidy tree layout (Deep Module)
 *
 * This is a "deep module" - it has a simple, narrow public interface (just position())
 * that hides significant complexity behind it. All WASM lifecycle, state management,
 * and layout decisions are private implementation details.
 *
 * Architecture:
 * - Maintains one persistent WASM Tidy instance across calls
 * - Uses ghost root (ID=0, string="__GHOST_ROOT__") to parent disconnected components
 * - Maintains stable string→number ID mappings
 * - Automatically chooses fullBuild() for initial layout or addNodes() for incremental
 * - O(N) for initial build, O(depth) for incremental additions
 *
 * Key Design Decisions:
 * - Ghost root MUST be ID 0 (Rust code expects this)
 * - Topological sort critical - Rust panics if parent added after child
 * - Ghost never appears in returned positions
 * - Same Tidy instance reused for incremental updates
 */

import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  NodeInfo,
  Position
} from '@/graph-core/graphviz/layout/types';
import { Tidy } from '@/graph-core/wasm-tidy/wasm';

const GHOST_ROOT_STRING_ID = '__GHOST_ROOT__';
const GHOST_ROOT_NUMERIC_ID = 0;

export class TidyLayoutStrategy implements PositioningStrategy {
  name = 'tidy-layout';

  // ----------------------------------------------------
  // Public Interface (Simple and Narrow)
  // ----------------------------------------------------

  /**
   * Position nodes based on context.
   * Automatically chooses between full build and incremental layout.
   */
  position(context: PositioningContext): PositioningResult {
    const { nodes, newNodes } = context;

    // Initial load: do full build
    if (this.isEmpty()) {
      const allNodes = [...nodes, ...newNodes];
      return { positions: this.fullBuild(allNodes) };
    }

    // Incremental update: add only new nodes
    if (newNodes.length > 0) {
      return { positions: this.addNodes(newNodes) };
    }

    // No new nodes: return empty
    return { positions: new Map() };
  }

  // ----------------------------------------------------
  // Private Implementation (Complex and Deep)
  // ----------------------------------------------------

  private readonly PARENT_CHILD_MARGIN = 300;
  private readonly PEER_MARGIN = 260;

  // Persistent WASM instance for incremental updates
  private tidy: Tidy | null = null;

  // ID mappings: string ↔ numeric
  // Ghost root is always: "__GHOST_ROOT__" ↔ 0
  private stringToNum = new Map<string, number>();
  private numToString = new Map<number, string>();
  private nextId = 1; // Start at 1 since 0 is reserved for ghost root

  // Track which nodes exist in WASM
  private wasmNodeIds = new Set<string>();

  /**
   * Check if coordinator is empty (no real nodes, only ghost root or nothing)
   */
  isEmpty(): boolean {
    // Check against 1 to account for the ghost root
    return this.wasmNodeIds.size <= 1;
  }

  /**
   * Full build: layout all nodes from scratch
   * Creates fresh WASM instance and builds complete tree
   * O(N) complexity
   *
   * Public for advanced use cases and testing.
   */
  fullBuild(nodes: NodeInfo[]): Map<string, Position> {
    const positions = new Map<string, Position>();

    if (nodes.length === 0) {
      return positions;
    }

    // Reset state
    this.tidy = null;
    this.stringToNum.clear();
    this.numToString.clear();
    this.wasmNodeIds.clear();
    this.nextId = 1;

    // Create fresh WASM instance
    this.tidy = Tidy.with_tidy_layout(this.PARENT_CHILD_MARGIN, this.PEER_MARGIN);

    // Initialize ghost root
    this.stringToNum.set(GHOST_ROOT_STRING_ID, GHOST_ROOT_NUMERIC_ID);
    this.numToString.set(GHOST_ROOT_NUMERIC_ID, GHOST_ROOT_STRING_ID);

    // Add ghost root to WASM (width=0, height=0, no parent)
    const nullId = Tidy.null_id();
    this.tidy.add_node(GHOST_ROOT_NUMERIC_ID, 0, 0, nullId);
    this.wasmNodeIds.add(GHOST_ROOT_STRING_ID);

    // Assign numeric IDs to all nodes
    for (const node of nodes) {
      if (!this.stringToNum.has(node.id)) {
        this.stringToNum.set(node.id, this.nextId);
        this.numToString.set(this.nextId, node.id);
        this.nextId++;
      }
    }

    // Build parent map
    const parentMap = this.buildParentMap(nodes);

    // Topologically sort nodes (parents before children)
    const sortedNodes = this.topologicalSort(nodes, parentMap);

    // Add nodes to WASM
    for (const node of sortedNodes) {
      const numericId = this.stringToNum.get(node.id)!;
      const parentStringId = parentMap.get(node.id);
      const parentNumericId = parentStringId !== undefined
        ? this.stringToNum.get(parentStringId)!
        : GHOST_ROOT_NUMERIC_ID; // Orphans parent to ghost

      this.tidy.add_node(numericId, node.size.width, node.size.height, parentNumericId);
      this.wasmNodeIds.add(node.id);
    }

    // Compute layout
    this.tidy.layout();

    // Extract positions (excluding ghost root)
    return this.extractPositions();
  }

  /**
   * Incremental add: adds new nodes to existing tree and recomputes layout
   * Uses layout() for O(N) complexity (partial_layout has WASM stability issues)
   *
   * NOTE: While this is O(N) rather than O(depth), it's still efficient because:
   * - The tree structure is already built in WASM, only positions are recomputed
   * - It avoids the "recursive use of object" WASM panics from partial_layout()
   *
   * IMPORTANT: addNodes() only adds NEW nodes. It does not re-layout existing nodes.
   * Caller must ensure existing nodes were already added via fullBuild() or previous addNodes().
   *
   * Public for advanced use cases and testing.
   */
  addNodes(newNodes: NodeInfo[]): Map<string, Position> {
    if (newNodes.length === 0) {
      return new Map();
    }

    // If no existing state, we can't do incremental - caller error
    // Check against 1 because ghost root is always present
    if (!this.tidy || this.wasmNodeIds.size <= 1) {
      // Fallback: do full build with ONLY the new nodes
      // This is not ideal but handles the edge case
      console.warn('[TidyLayoutStrategy] addNodes called without prior fullBuild, doing full build of new nodes only');
      return this.fullBuild(newNodes);
    }

    const changedNodeIds: number[] = [];

    // Assign numeric IDs to new nodes
    for (const node of newNodes) {
      if (!this.stringToNum.has(node.id)) {
        this.stringToNum.set(node.id, this.nextId);
        this.numToString.set(this.nextId, node.id);
        this.nextId++;
      }
    }

    // Build parent map for new nodes
    // IMPORTANT: Only include parent relationships where BOTH parent and child are new nodes
    // If parent is already in WASM, don't include it in parentMap for topological sort
    const parentMap = new Map<string, string>();
    const newNodeIds = new Set(newNodes.map(n => n.id));

    for (const node of newNodes) {
      let parentId: string | undefined;

      // Prefer explicit parentId
      if (node.parentId && this.stringToNum.has(node.parentId) && node.parentId !== node.id) {
        parentId = node.parentId;
      }
      // Fall back to first valid wikilink
      else if (node.linkedNodeIds && node.linkedNodeIds.length > 0) {
        for (const linkedId of node.linkedNodeIds) {
          if (linkedId !== node.id && this.stringToNum.has(linkedId)) {
            parentId = linkedId;
            break;
          }
        }
      }

      // Only add to parentMap if the parent is ALSO a new node
      // If parent already exists in WASM, the child can be added directly
      if (parentId && newNodeIds.has(parentId)) {
        parentMap.set(node.id, parentId);
      }
    }

    // Topologically sort new nodes (parents before children)
    // This is critical to avoid WASM panics when adding nodes
    const sortedNewNodes = this.topologicalSort(newNodes, parentMap);

    // Add nodes to WASM in topological order
    for (const node of sortedNewNodes) {
      // Skip if already in WASM
      if (this.wasmNodeIds.has(node.id)) {
        continue;
      }

      const numericId = this.stringToNum.get(node.id)!;
      changedNodeIds.push(numericId);

      // Determine parent - check actual node metadata, not just parentMap
      // parentMap only contains parent relationships between NEW nodes
      let parentStringId: string | undefined;

      // Prefer explicit parentId
      if (node.parentId && this.stringToNum.has(node.parentId) && node.parentId !== node.id) {
        parentStringId = node.parentId;
      }
      // Fall back to first valid wikilink
      else if (node.linkedNodeIds && node.linkedNodeIds.length > 0) {
        for (const linkedId of node.linkedNodeIds) {
          if (linkedId !== node.id && this.stringToNum.has(linkedId)) {
            parentStringId = linkedId;
            break;
          }
        }
      }

      const parentNumericId = parentStringId !== undefined
        ? this.stringToNum.get(parentStringId)!
        : GHOST_ROOT_NUMERIC_ID;

      this.tidy.add_node(numericId, node.size.width, node.size.height, parentNumericId);
      this.wasmNodeIds.add(node.id);
    }

    if (changedNodeIds.length === 0) {
      return this.extractPositions();
    }

    // Use full layout after adding nodes
    // Note: partial_layout() causes WASM panics ("recursive use of object") in many cases
    // This is still efficient since WASM only needs to recompute positions, not rebuild tree structure
    this.tidy.layout();

    // Extract all positions
    return this.extractPositions();
  }

  /**
   * Build parent map from node metadata
   * Handles both parentId and legacy linkedNodeIds
   * Filters out invalid parents (non-existent, self-references)
   */
  private buildParentMap(nodes: NodeInfo[]): Map<string, string> {
    const parentMap = new Map<string, string>();
    const nodeIds = new Set(nodes.map(n => n.id));

    for (const node of nodes) {
      // Prefer explicit parentId
      if (node.parentId && nodeIds.has(node.parentId) && node.parentId !== node.id) {
        parentMap.set(node.id, node.parentId);
      }
      // Fall back to first valid wikilink
      else if (node.linkedNodeIds && node.linkedNodeIds.length > 0) {
        for (const linkedId of node.linkedNodeIds) {
          if (linkedId !== node.id && nodeIds.has(linkedId)) {
            parentMap.set(node.id, linkedId);
            break;
          }
        }
      }
      // Otherwise, node is an orphan (will parent to ghost root)
    }

    return parentMap;
  }

  /**
   * Topological sort: ensures parents are added before children
   * Uses BFS from roots to guarantee parent-first ordering
   * Critical: Rust panics if parent added after child
   */
  private topologicalSort(nodes: NodeInfo[], parentMap: Map<string, string>): NodeInfo[] {
    const nodeMap = new Map<string, NodeInfo>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

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

    // Find roots (nodes with no parents in this set)
    const roots: string[] = [];
    for (const node of nodes) {
      if (!parentMap.has(node.id)) {
        roots.push(node.id);
      }
    }

    // BFS from roots
    const sorted: string[] = [];
    const visited = new Set<string>();
    const queue = [...roots];

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
    return sorted.map(id => nodeMap.get(id)!);
  }

  /**
   * Extract positions from WASM, filtering out ghost root
   */
  private extractPositions(): Map<string, Position> {
    const positions = new Map<string, Position>();

    if (!this.tidy) {
      return positions;
    }

    const posArray = this.tidy.get_pos();

    for (let i = 0; i < posArray.length; i += 3) {
      const numId = posArray[i];
      const x = posArray[i + 1];
      const y = posArray[i + 2];
      const stringId = this.numToString.get(numId);

      if (!stringId) {
        console.warn(`[TidyLayoutStrategy] No string ID for numeric ID ${numId}`);
        continue;
      }

      // Filter out ghost root
      if (stringId !== GHOST_ROOT_STRING_ID) {
        positions.set(stringId, { x, y });
      }
    }

    return positions;
  }
}
