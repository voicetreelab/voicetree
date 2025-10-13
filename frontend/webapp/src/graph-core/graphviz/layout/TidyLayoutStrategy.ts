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
import wasmInit, { Tidy } from '@wasm/wasm';

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
      const wasmPath = join(__dirname, '../../../../tidy/wasm_dist/wasm_bg.wasm');
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
  LeftRight = 'left-right',
  Diagonal45 = 'diagonal-45'
}

export class TidyLayoutStrategy implements PositioningStrategy {
  name = 'tidy-layout';

  // Orientation: controls layout direction
  private orientation: TreeOrientation;

  // Micro-relax configuration: force-directed refinement after Tidy
  private readonly RELAX_ENABLED = true;  // Disabled for now - needs tuning
  private readonly RELAX_ITERS = 600
  private readonly LEAF_ATTRACTION_K = 0.1;  // Pull leaf nodes toward parent
  private readonly LEAF_TARGET_DISTANCE = 200; // Ideal distance for leaf from parent
  private readonly REPEL_K = 0.1;
  private readonly STEP_SIZE = 100;
  private readonly LOCAL_RADIUS_MULT = 50;

  constructor(orientation: TreeOrientation = TreeOrientation.Diagonal45) {
    this.orientation = orientation;
  }

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

    // Extract positions in engine space (before rotation)
    const enginePositions = this.extractEnginePositions();

    // Apply micro-relax in engine space (before rotation)
    const relaxedEnginePositions = this.microRelax(enginePositions, nodes);

    // Convert to UI positions (apply rotation)
    return this.engineToUIPositions(relaxedEnginePositions);
  }

  /**
   * Update dimensions of existing nodes and trigger partial relayout
   * Currently falls back to full layout (baseline tidy doesn't have update_node_size/partial_layout)
   *
   * Public for dimension change handling
   */
  async updateNodeDimensions(cy: import('cytoscape').Core, nodeIds: string[]): Promise<Map<string, Position>> {
    if (nodeIds.length === 0 || !this.tidy || this.isEmpty()) {
      return new Map();
    }

    // Baseline tidy doesn't have update_node_size/partial_layout, so we fall back to full relayout
    // TODO: Add these methods to Rust tidy library for O(depth) updates
    console.warn('[TidyLayoutStrategy] update_node_size/partial_layout not available, falling back to full layout');
    this.tidy.layout();
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

    // Baseline tidy doesn't have partial_layout, so we fall back to full relayout
    // TODO: Add partial_layout to Rust tidy library for O(depth) updates
    console.warn('[TidyLayoutStrategy] partial_layout not available, falling back to full layout');
    this.tidy.layout();

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
   * Extract positions from WASM in engine space (no rotation applied)
   * Returns raw positions before orientation transformation
   */
  private extractEnginePositions(): Map<string, Position> {
    const positions = new Map<string, Position>();

    if (!this.tidy) {
      console.log('[TidyLayoutStrategy] extractEnginePositions: no tidy instance');
      return positions;
    }

    const posArray = this.tidy.get_pos();
    console.log('[TidyLayoutStrategy] extractEnginePositions: got', posArray.length / 3, 'positions from WASM');

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
        // Return raw engine positions (no rotation)
        positions.set(stringId, { x: engineX, y: engineY });
      }
    }

    return positions;
  }

  /**
   * Convert engine positions to UI positions (apply rotation)
   */
  private engineToUIPositions(enginePositions: Map<string, Position>): Map<string, Position> {
    const uiPositions = new Map<string, Position>();

    for (const [nodeId, enginePos] of enginePositions) {
      const uiPos = this.toUIPosition(enginePos.x, enginePos.y);
      console.log(`[TidyLayoutStrategy] ${nodeId}: engine(${enginePos.x.toFixed(1)}, ${enginePos.y.toFixed(1)}) -> UI(${uiPos.x.toFixed(1)}, ${uiPos.y.toFixed(1)})`);
      uiPositions.set(nodeId, uiPos);
    }

    return uiPositions;
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
        const uiPos = this.toUIPosition(engineX, engineY);
        console.log(`[TidyLayoutStrategy] ${stringId}: engine(${engineX.toFixed(1)}, ${engineY.toFixed(1)}) -> UI(${uiPos.x.toFixed(1)}, ${uiPos.y.toFixed(1)})`);
        positions.set(stringId, uiPos);
      }
    }

    return positions;
  }

  /**
   * Apply micro-relax: force-directed physics to refine Tidy positions
   * Improves edge uniformity and spacing while preserving tree structure
   */
  private microRelax(
    positions: Map<string, Position>,
    allNodes: NodeInfo[]
  ): Map<string, Position> {
    if (!this.RELAX_ENABLED || positions.size === 0) {
      return positions;
    }

    console.log('[TidyLayoutStrategy] Applying micro-relax with', this.RELAX_ITERS, 'iterations');

    // Build node lookup
    const nodeMap = new Map<string, NodeInfo>();
    for (const node of allNodes) {
      nodeMap.set(node.id, node);
    }

    // Clone positions for mutation
    const currentPositions = new Map<string, Position>();
    for (const [id, pos] of positions) {
      currentPositions.set(id, { ...pos });
    }

    // Build parent map to identify leaf nodes
    const childrenMap = new Map<string, string[]>();
    for (const node of allNodes) {
      const parentId = node.parentId || (node.linkedNodeIds && node.linkedNodeIds.length > 0 ? node.linkedNodeIds[0] : null);
      if (parentId) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(node.id);
      }
    }

    // Pre-distribute leaf nodes into full circle (alternating hemispheres)
    // This seeds them around the parent so forces can refine into radial pattern
    for (const node of allNodes) {
      const isLeaf = !childrenMap.has(node.id) || childrenMap.get(node.id)!.length === 0;
      if (!isLeaf) continue;

      const parentId = node.parentId || (node.linkedNodeIds && node.linkedNodeIds.length > 0 ? node.linkedNodeIds[0] : null);
      if (!parentId) continue;

      const parentPos = currentPositions.get(parentId);
      if (!parentPos) continue;

      const nodePos = currentPositions.get(node.id);
      if (!nodePos) continue;

      // Get siblings (other leaves of same parent)
      const siblings = childrenMap.get(parentId) || [];
      const leafSiblings = siblings.filter(sibId => {
        const sib = nodeMap.get(sibId);
        return sib && (!childrenMap.has(sibId) || childrenMap.get(sibId)!.length === 0);
      });

      const siblingIndex = leafSiblings.indexOf(node.id);
      if (siblingIndex === -1) continue;

      // Distribute evenly around circle
      const angle = (siblingIndex / leafSiblings.length) * 2 * Math.PI;
      const targetX = parentPos.x + this.LEAF_TARGET_DISTANCE * Math.cos(angle);
      const targetY = parentPos.y + this.LEAF_TARGET_DISTANCE * Math.sin(angle);

      // Blend current position with target (30/70) to seed hemisphere distribution
      nodePos.x = 0.3 * nodePos.x + 0.7 * targetX;
      nodePos.y = 0.3 * nodePos.y + 0.7 * targetY;
    }

    // Run relaxation iterations
    for (let iter = 0; iter < this.RELAX_ITERS; iter++) {
      const forces = new Map<string, { fx: number; fy: number }>();

      // Calculate forces for each node
      for (const [nodeId, nodePos] of currentPositions) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;

        const nodeRadius = Math.max(node.size.width, node.size.height) / 2 + 20;
        const localRadius = this.LOCAL_RADIUS_MULT * nodeRadius * 2;

        let fx = 0, fy = 0;

        // LEAF NODE ATTRACTION: Pull leaf nodes toward parent in a radial pattern
        const isLeaf = !childrenMap.has(nodeId) || childrenMap.get(nodeId)!.length === 0;
        if (isLeaf) {
          const parentId = node.parentId || (node.linkedNodeIds && node.linkedNodeIds.length > 0 ? node.linkedNodeIds[0] : null);
          if (parentId) {
            const parentPos = currentPositions.get(parentId);
            if (parentPos) {
              const dx = nodePos.x - parentPos.x;
              const dy = nodePos.y - parentPos.y;
              const dist = Math.hypot(dx, dy) || 1;
              const delta = dist - this.LEAF_TARGET_DISTANCE;

              // Attractive force toward parent (pull in if too far, push out if too close)
              fx -= this.LEAF_ATTRACTION_K * delta * (dx / dist);
              fy -= this.LEAF_ATTRACTION_K * delta * (dy / dist);
            }
          }
        }

        // Repulsion forces from nearby nodes
        for (const [otherId, otherPos] of currentPositions) {
          if (otherId === nodeId) continue;

          const otherNode = nodeMap.get(otherId);
          if (!otherNode) continue;

          const dx = nodePos.x - otherPos.x;
          const dy = nodePos.y - otherPos.y;
          const dist2 = dx * dx + dy * dy + 1e-6;
          const dist = Math.sqrt(dist2);

          if (dist < localRadius) {
            const otherRadius = Math.max(otherNode.size.width, otherNode.size.height) / 2 + 20;
            const minDist = nodeRadius + otherRadius;

            if (dist < minDist) {
              // Strong repulsion when overlapping
              const factor = this.REPEL_K * 5;
              const pushDist = minDist - dist + 5;
              fx += factor * pushDist * (dx / dist);
              fy += factor * pushDist * (dy / dist);
            } else {
              // Normal repulsion
              fx += this.REPEL_K * dx / dist2;
              fy += this.REPEL_K * dy / dist2;
            }
          }
        }

        forces.set(nodeId, { fx, fy });
      }

      // Apply forces
      for (const [nodeId, nodePos] of currentPositions) {
        const force = forces.get(nodeId);
        if (!force) continue;

        const node = nodeMap.get(nodeId);
        if (!node) continue;

        const nodeRadius = Math.max(node.size.width, node.size.height) / 2 + 20;
        const forceMag = Math.hypot(force.fx, force.fy);
        const maxStep = nodeRadius * 0.5;
        const step = Math.min(this.STEP_SIZE, maxStep / Math.max(forceMag, 1e-6));

        nodePos.x += step * force.fx;
        nodePos.y += step * force.fy;
      }
    }

    console.log('[TidyLayoutStrategy] Micro-relax complete');
    return currentPositions;
  }

  /**
   * Convert node size to engine width (swaps based on orientation)
   * Engine uses dimensions for collision detection and spacing calculations.
   */
  private toEngineWidth(nodeSize: { width: number; height: number }): number {
    if (this.orientation === TreeOrientation.LeftRight || this.orientation === TreeOrientation.Diagonal45) {
      return nodeSize.height;  // swap: siblings stack vertically, so HEIGHT controls spacing
    }
    return nodeSize.width;
  }

  /**
   * Convert node size to engine height (swaps based on orientation)
   */
  private toEngineHeight(nodeSize: { width: number; height: number }): number {
    if (this.orientation === TreeOrientation.LeftRight || this.orientation === TreeOrientation.Diagonal45) {
      return nodeSize.width;   // swap: depth grows horizontally, so WIDTH controls depth spacing
    }
    return nodeSize.height;
  }

  /**
   * Convert engine position to UI position (transposes/rotates based on orientation)
   */
  private toUIPosition(engineX: number, engineY: number): Position {
    if (this.orientation === TreeOrientation.Diagonal45) {
      // Apply 45-degree rotation: top-left to bottom-right
      // Standard rotation matrix: x_new = cos45*x + sin45*y, y_new = -sin45*x + cos45*y
      // For 45°: cos(45°) = sin(45°) = √2/2 ≈ 0.7071
      const cos45 = Math.SQRT1_2; // JavaScript constant for 1/√2
      const x = cos45 * (engineX + engineY);  // Preserves sign of engineX
      const y = cos45 * (engineY - engineX);  // Creates diagonal
      return { x, y };
    }

    if (this.orientation === TreeOrientation.LeftRight) {
      return { x: engineY, y: engineX };  // transpose: engine Y becomes UI X, engine X becomes UI Y
    }

    return { x: engineX, y: engineY };
  }
}
