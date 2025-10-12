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
import wasmInit, { Tidy } from '@/graph-core/wasm-tidy/wasm';

const GHOST_ROOT_STRING_ID = '__GHOST_ROOT__';
const GHOST_ROOT_NUMERIC_ID = 0;

// Lazily initialize WASM once
let wasmInitialized = false;
async function ensureWasmInit() {
  if (wasmInitialized) return;

  try {
    // In Node.js environment (tests), load WASM from file system using dynamic import
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const wasmPath = join(__dirname, '../../wasm-tidy/wasm_bg.wasm');
      const wasmBytes = await readFile(wasmPath);
      await wasmInit(wasmBytes);
    } else {
      // In browser environment, let it fetch from URL
      await wasmInit();
    }
    wasmInitialized = true;
  } catch (error) {
    console.error('[TidyLayoutStrategy] Failed to initialize WASM:', error);
    throw error;
  }
}

export enum TreeOrientation {
  TopDown = 'top-down',
  LeftRight = 'left-right'
}

export class TidyLayoutStrategy implements PositioningStrategy {
  name = 'tidy-layout';

  // Orientation: controls layout direction
  private orientation: TreeOrientation = TreeOrientation.LeftRight;

  // ----------------------------------------------------
  // Public Interface (Simple and Narrow)
  // ----------------------------------------------------

  /**
   * Position nodes based on context.
   * Automatically chooses between full build and incremental layout.
   */
  async position(context: PositioningContext): Promise<PositioningResult> {
    const { nodes, newNodes } = context;

    console.log('[TidyLayoutStrategy] position called', {
      isEmpty: this.isEmpty(),
      nodesCount: nodes.length,
      newNodesCount: newNodes.length,
      wasmNodeIdsSize: this.wasmNodeIds.size
    });

    // Initial load: do full build
    if (this.isEmpty()) {
      const allNodes = [...nodes, ...newNodes];
      console.log('[TidyLayoutStrategy] Doing fullBuild with', allNodes.length, 'nodes');
      return { positions: await this.fullBuild(allNodes) };
    }

    // Incremental update: add only new nodes
    if (newNodes.length > 0) {
      console.log('[TidyLayoutStrategy] Doing addNodes with', newNodes.length, 'new nodes');
      return { positions: await this.addNodes(newNodes) };
    }

    // No new nodes: return empty
    console.log('[TidyLayoutStrategy] No new nodes, returning empty');
    return { positions: new Map() };
  }

  // ----------------------------------------------------
  // Private Implementation (Complex and Deep)
  // ----------------------------------------------------

  // Margins - semantic meaning depends on orientation:
  // - LeftRight: PARENT_CHILD_MARGIN = horizontal spacing (depth), PEER_MARGIN = vertical spacing (siblings)
  // - TopDown: PARENT_CHILD_MARGIN = vertical spacing (depth), PEER_MARGIN = horizontal spacing (siblings)
  private readonly PARENT_CHILD_MARGIN = 300;
  private readonly PEER_MARGIN = 60;

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
  async fullBuild(nodes: NodeInfo[]): Promise<Map<string, Position>> {
    console.log('[TidyLayoutStrategy] fullBuild called with nodes:', nodes.map(n => n.id));
    const positions = new Map<string, Position>();

    if (nodes.length === 0) {
      console.log('[TidyLayoutStrategy] fullBuild: nodes array is empty, returning');
      return positions;
    }

    // Ensure WASM is initialized
    await ensureWasmInit();

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
    console.log('[TidyLayoutStrategy] parentMap:', Object.fromEntries(parentMap));

    // Topologically sort nodes (parents before children)
    const sortedNodes = this.topologicalSort(nodes, parentMap);
    console.log('[TidyLayoutStrategy] sortedNodes:', sortedNodes.map(n => n.id));

    // Add nodes to WASM
    console.log('[TidyLayoutStrategy] Adding', sortedNodes.length, 'nodes to WASM');
    for (const node of sortedNodes) {
      const numericId = this.stringToNum.get(node.id)!;
      const parentStringId = parentMap.get(node.id);
      const parentNumericId = parentStringId !== undefined
        ? this.stringToNum.get(parentStringId)!
        : GHOST_ROOT_NUMERIC_ID; // Orphans parent to ghost

      console.log('[TidyLayoutStrategy] Adding node', node.id, 'numericId:', numericId, 'parentId:', parentNumericId);
      this.tidy.add_node(
        numericId,
        this.toEngineWidth(node.size),
        this.toEngineHeight(node.size),
        parentNumericId
      );
      this.wasmNodeIds.add(node.id);
    }
    console.log('[TidyLayoutStrategy] After adding, wasmNodeIds size:', this.wasmNodeIds.size);

    // Compute layout
    this.tidy.layout();

    // Extract positions (excluding ghost root)
    return this.extractPositions();
  }

  /**
   * Update dimensions of existing nodes and trigger partial relayout
   * Uses update_node_size() + partial_layout() for O(depth) updates
   *
   * Public for dimension change handling
   */
  async updateNodeDimensions(cy: import('cytoscape').Core, nodeIds: string[]): Promise<Map<string, Position>> {
    if (nodeIds.length === 0 || !this.tidy || this.isEmpty()) {
      return new Map();
    }

    const changedNumericIds: number[] = [];

    for (const nodeId of nodeIds) {
      const numericId = this.stringToNum.get(nodeId);
      if (numericId === undefined) continue;

      const node = cy.$id(nodeId);
      if (!node.length) continue;

      const bb = node.boundingBox({ includeLabels: false });
      const size = { width: bb.w || 40, height: bb.h || 40 };

      this.tidy.update_node_size(numericId, this.toEngineWidth(size), this.toEngineHeight(size));
      changedNumericIds.push(numericId);
    }

    if (changedNumericIds.length === 0) return new Map();

    this.tidy.partial_layout(new Uint32Array(changedNumericIds));
    return this.extractPositions();
  }

  /**
   * Incremental add: adds new nodes to existing tree and recomputes layout
   * Uses partial_layout() for O(depth) updates against the persistent WASM tree.
   *
   * IMPORTANT: addNodes() only adds NEW nodes. It does not re-layout existing nodes.
   * Caller must ensure existing nodes were already added via fullBuild() or previous addNodes().
   *
   * Public for advanced use cases and testing.
   */
  async addNodes(newNodes: NodeInfo[]): Promise<Map<string, Position>> {
    if (newNodes.length === 0) {
      return new Map();
    }

    // If no existing state, we can't do incremental - caller error
    // Check against 1 because ghost root is always present
    if (!this.tidy || this.wasmNodeIds.size <= 1) {
      // Fallback: do full build with ONLY the new nodes
      // This is not ideal but handles the edge case
      console.warn('[TidyLayoutStrategy] addNodes called without prior fullBuild, doing full build of new nodes only');
      return await this.fullBuild(newNodes);
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

      this.tidy.add_node(
        numericId,
        this.toEngineWidth(node.size),
        this.toEngineHeight(node.size),
        parentNumericId
      );
      this.wasmNodeIds.add(node.id);
    }

    if (changedNodeIds.length === 0) {
      return this.extractPositions();
    }

    // Deduplicate changedNodeIds and convert to Uint32Array for WASM
    const uniqueChangedNodeIds = Array.from(new Set(changedNodeIds));
    const changedIdsArray = new Uint32Array(uniqueChangedNodeIds);

    // Perform partial layout (O(depth) incremental update)
    this.tidy.partial_layout(changedIdsArray);

    // Extract all positions
    return this.extractPositions();
  }

  /**
   * Build parent map from node metadata
   * Uses explicit parentId first, falls back to linkedNodeIds with cycle prevention
   * Filters out invalid parents (non-existent, self-references, cycles)
   */
  private buildParentMap(nodes: NodeInfo[]): Map<string, string> {
    const parentMap = new Map<string, string>();
    const nodeIds = new Set(nodes.map(n => n.id));
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // First pass: collect all explicit parentId relationships
    for (const node of nodes) {
      if (node.parentId && nodeIds.has(node.parentId) && node.parentId !== node.id) {
        parentMap.set(node.id, node.parentId);
      }
    }

    // Second pass: for nodes without explicit parentId, try linkedNodeIds (with cycle check)
    for (const node of nodes) {
      if (parentMap.has(node.id)) {
        continue; // Already has explicit parent
      }

      // Try to use first valid linkedNode as parent (if it doesn't create cycle)
      if (node.linkedNodeIds && node.linkedNodeIds.length > 0) {
        for (const linkedId of node.linkedNodeIds) {
          if (linkedId === node.id || !nodeIds.has(linkedId)) {
            continue; // Skip self-reference or non-existent nodes
          }

          // Check if linkedNode has this node as its parent (would create cycle)
          const linkedNode = nodeMap.get(linkedId);
          if (linkedNode?.parentId === node.id || parentMap.get(linkedId) === node.id) {
            continue; // Skip - would create cycle
          }

          // Valid parent found
          parentMap.set(node.id, linkedId);
          break;
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
      console.log('[TidyLayoutStrategy] extractPositions: no tidy instance');
      return positions;
    }

    const posArray = this.tidy.get_pos();
    console.log('[TidyLayoutStrategy] extractPositions: got', posArray.length / 3, 'positions from WASM');

    for (let i = 0; i < posArray.length; i += 3) {
      const numId = posArray[i];
      const engineX = posArray[i + 1];
      const engineY = posArray[i + 2];
      const stringId = this.numToString.get(numId);

      if (!stringId) {
        console.warn(`[TidyLayoutStrategy] No string ID for numeric ID ${numId}`);
        continue;
      }

      // Filter out ghost root
      if (stringId !== GHOST_ROOT_STRING_ID) {
        positions.set(stringId, this.toUIPosition(engineX, engineY));
      }
    }

    return positions;
  }

  /**
   * Convert node size to engine width (swaps based on orientation)
   * Engine uses dimensions for collision detection and spacing calculations.
   */
  private toEngineWidth(nodeSize: { width: number; height: number }): number {
    return this.orientation === TreeOrientation.LeftRight
      ? nodeSize.height  // swap: siblings stack vertically, so HEIGHT controls spacing
      : nodeSize.width;
  }

  /**
   * Convert node size to engine height (swaps based on orientation)
   */
  private toEngineHeight(nodeSize: { width: number; height: number }): number {
    return this.orientation === TreeOrientation.LeftRight
      ? nodeSize.width   // swap: depth grows horizontally, so WIDTH controls depth spacing
      : nodeSize.height;
  }

  /**
   * Convert engine position to UI position (transposes based on orientation)
   */
  private toUIPosition(engineX: number, engineY: number): Position {
    return this.orientation === TreeOrientation.LeftRight
      ? { x: engineY, y: engineX }  // transpose: engine Y becomes UI X, engine X becomes UI Y
      : { x: engineX, y: engineY };
  }
}
