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
import type { Core } from 'cytoscape';
import wasmInit, { Tidy } from '@wasm/wasm';
import { applyColaRefinement, type ColaRefinementOptions } from './ColaRefinement';

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

  // Cytoscape instance for Cola refinement
  private cy: Core;

  // Micro-relax configuration: force-directed refinement after Tidy
  private readonly RELAX_ENABLED = true;  // Disabled for now - needs tuning
  private readonly RELAX_ITERS = 60
  private readonly LEAF_ATTRACTION_K = 0.1;  // Pull leaf nodes toward parent
  private readonly LEAF_TARGET_DISTANCE = 200; // Ideal distance for leaf from parent
  private readonly REPEL_K = 1;
  private readonly STEP_SIZE = 100;
  private readonly LOCAL_RADIUS_MULT = 10;

  constructor(cy: Core, orientation: TreeOrientation = TreeOrientation.Diagonal45) {
    this.cy = cy;
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
      return { positions: await this.fullBuild(allNodes, 10) };
    }

    else {
        const allNodes = [...nodes, ...newNodes];
        console.log('[TidyLayoutStrategy] Doing fullBuild with', allNodes.length, 'nodes');
        return { positions: await this.fullBuild(allNodes, 0) };
      }
        //temp just do full build as well. todo optimise with partial_layout later.
  }

  // ----------------------------------------------------
  // Private Implementation (Complex and Deep)
  // ----------------------------------------------------

  // Margins - semantic meaning depends on orientation:
  // - LeftRight: PARENT_CHILD_MARGIN = horizontal spacing (depth), PEER_MARGIN = vertical spacing (siblings)
  // - TopDown: PARENT_CHILD_MARGIN = vertical spacing (depth), PEER_MARGIN = horizontal spacing (siblings)
  private readonly PARENT_CHILD_MARGIN = 260;
  private readonly PEER_MARGIN = 140;

  // Persistent WASM instance for incremental updates
  private tidy: Tidy | null = null;

  // ID mappings: string ↔ numeric
  // Ghost root is always: "__GHOST_ROOT__" ↔ 0
  private stringToNum = new Map<string, number>();
  private numToString = new Map<number, string>();
  private nextId = 1; // Start at 1 since 0 is reserved for ghost root

  // Track which nodes exist in WASM
  private wasmNodeIds = new Set<string>();

  // Persistent physics state: offsets from tidy targets and velocities
  private physDelta = new Map<string, { x: number; y: number }>();
  private physVel = new Map<string, { x: number; y: number }>();

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
  async fullBuild(nodes: NodeInfo[], iterations: number): Promise<Map<string, Position>> {
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
    this.physDelta.clear();
    this.physVel.clear();
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

      // console.log('[TidyLayoutStrategy] Adding node', node.id, 'numericId:', numericId, 'parentId:', parentNumericId);
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

    // Apply micro-relax with warm-start (stores deltas for incremental updates)
    const relaxedEnginePositions = await this.microRelaxWithWarmStart(
      enginePositions,
      nodes,
      iterations  // Use full 600 iterations for fullBuild
    );

    // =============================================================
    // COMMIT (NO CLEAR): Sync Tidy's state with visual reality
    // =============================================================
    // After physics, commit the relaxed positions back to Tidy so that Tidy's
    // internal state matches the visual reality. This ensures partial_layout()
    // starts from the correct base (visual positions P', not structural positions P).
    //
    // IMPORTANT: We do NOT clear deltas here! The deltas will be recalculated
    // by microRelaxWithWarmStart in the next operation, and they provide the
    // warm-start continuity that prevents jarring visual jumps.
    console.log('[TidyLayoutStrategy] fullBuild: Committing physics-relaxed positions to Tidy...');
    for (const [nodeId, relaxedPos] of relaxedEnginePositions) {
      if (nodeId === GHOST_ROOT_STRING_ID) continue;

      const numericId = this.stringToNum.get(nodeId);
      if (numericId !== undefined) {
        this.tidy.set_position(numericId, relaxedPos.x, relaxedPos.y);
      }
    }
    console.log('[TidyLayoutStrategy] fullBuild: Commit complete. Tidy state = visual state.');

    // Convert to UI positions (apply rotation)
    return this.engineToUIPositions(relaxedEnginePositions);
  }

  /**
   * Update dimensions of existing nodes and trigger partial relayout
   *
   * Updates node dimensions in WASM and performs incremental layout update.
   *
   * Public for dimension change handling
   */
  //todo
      // Listen to floating window resize events and trigger layout
  // const dimensionChangeMap = new Map<string, ReturnType<typeof setTimeout>>();
  //   core.on('floatingwindow:resize', async (_event, data) => {
 // is what calls this in voice-tree-graph-viz-layout.tsx
    async updateNodeDimensions(cy: import('cytoscape').Core, nodeIds: string[]): Promise<Map<string, Position>> {
    // @ts-expect-error - temp disable
    //   return new Map(); //temp disable
      if (!this.tidy || nodeIds.length === 0) {
      return new Map();
    }

    // =============================================================
    // STEP 0: VERIFY NODES EXIST IN WASM
    // =============================================================
    // Filter out nodes that haven't been added to WASM yet (e.g., ghost nodes)
    // This prevents WASM panic when ResizeObserver fires before addNodes completes
    const existingNodeIds = nodeIds.filter(id => this.wasmNodeIds.has(id));

    if (existingNodeIds.length === 0) {
      console.log('[TidyLayoutStrategy] updateNodeDimensions: No existing nodes found, skipping');
      return new Map();
    }

    if (existingNodeIds.length < nodeIds.length) {
      const missing = nodeIds.filter(id => !this.wasmNodeIds.has(id));
      console.warn('[TidyLayoutStrategy] updateNodeDimensions: Skipping non-existent nodes:', missing);
    }

    // Continue with only existing nodes
    nodeIds = existingNodeIds;

    // Since fullBuild/addNodes committed at the end, Tidy's internal state
    // is already at the visual positions. We can directly update dimensions
    // and run partial_layout from this correct base.
    const changedNumericIds: number[] = [];

    // Update dimensions in WASM
    for (const nodeId of nodeIds) {
      const numericId = this.stringToNum.get(nodeId);
      if (numericId === undefined) {
        console.warn(`[TidyLayoutStrategy] Node ${nodeId} not found in WASM, skipping dimension update`);
        continue;
      }

      const cyNode = cy.getElementById(nodeId);
      if (!cyNode || cyNode.length === 0) {
        console.warn(`[TidyLayoutStrategy] Node ${nodeId} not found in Cytoscape, skipping`);
        continue;
      }

      const width = cyNode.width();
      const height = cyNode.height();

      this.tidy.update_node_dimensions(
        numericId,
        this.toEngineWidth({ width, height }),
        this.toEngineHeight({ width, height })
      );
      changedNumericIds.push(numericId);
    }

    // Trigger partial layout for changed nodes
    if (changedNumericIds.length > 0) {
      const changedIdsArray = new Uint32Array(changedNumericIds);
      const affectedIds = this.tidy.partial_layout(changedIdsArray);

      console.log(`[TidyLayoutStrategy] partial_layout affected ${affectedIds.length} nodes (vs ${this.wasmNodeIds.size} total)`);

      // Extract new Tidy positions in engine space (for all nodes, needed for physics)
      const newTidyPositions = this.extractEnginePositions();

      // Collect all nodes for physics
      const allNodes: NodeInfo[] = [];
      for (const nodeId of this.wasmNodeIds) {
        if (nodeId === GHOST_ROOT_STRING_ID) continue;

        // For existing nodes, use default size (limitation of current architecture)
        // In production, size info should be tracked separately
        allNodes.push({
          id: nodeId,
          size: { width: 200, height: 100 }, // Default size
          parentId: undefined,
          linkedNodeIds: []
        });
      }

      // Run physics to refine the new Tidy positions
      const relaxedEnginePositions = await this.microRelaxWithWarmStart(
        newTidyPositions,
        allNodes,
        100  // Fewer iterations than fullBuild (600)
      );

      // =============================================================
      // COMMIT (NO CLEAR): Sync Tidy's state with visual reality
      // =============================================================
      console.log('[TidyLayoutStrategy] updateNodeDimensions: Committing physics-relaxed positions to Tidy...');
      for (const [nodeId, relaxedPos] of relaxedEnginePositions) {
        if (nodeId === GHOST_ROOT_STRING_ID) continue;

        const numericId = this.stringToNum.get(nodeId);
        if (numericId !== undefined) {
          this.tidy.set_position(numericId, relaxedPos.x, relaxedPos.y);
        }
      }
      console.log('[TidyLayoutStrategy] updateNodeDimensions: Commit complete. Tidy state = visual state.');

      // Convert to UI positions and return ALL positions (not just affected)
      // This maintains consistency with addNodes() behavior
      return this.engineToUIPositions(relaxedEnginePositions);
    }

    return new Map();
  }

  /**
   * Remove nodes from WASM layout and clean up all internal state
   *
   * This should be called when nodes are deleted from the graph to prevent memory leaks.
   * Cleans up:
   * - WASM layout state (via remove_node)
   * - wasmNodeIds tracking set
   * - physDelta map (physics offset state)
   * - physVel map (physics velocity state)
   *
   * Public for node deletion handling
   */
  removeNodes(nodeIds: string[]): void {
    if (!this.tidy || nodeIds.length === 0) {
      return;
    }

    console.log('[TidyLayoutStrategy] Removing', nodeIds.length, 'nodes:', nodeIds);

    for (const nodeId of nodeIds) {
      // Skip ghost root - it should never be removed
      if (nodeId === GHOST_ROOT_STRING_ID) {
        console.warn('[TidyLayoutStrategy] Attempted to remove ghost root, skipping');
        continue;
      }

      const numericId = this.stringToNum.get(nodeId);
      if (numericId === undefined) {
        console.warn(`[TidyLayoutStrategy] Node ${nodeId} not found in ID mappings, skipping removal`);
        continue;
      }

      // Only remove if node exists in WASM
      if (!this.wasmNodeIds.has(nodeId)) {
        console.warn(`[TidyLayoutStrategy] Node ${nodeId} not tracked in wasmNodeIds, skipping WASM removal`);
        continue;
      }

      // Remove from WASM
      this.tidy.remove_node(numericId);

      // Clean up tracking state
      this.wasmNodeIds.delete(nodeId);

      // Clean up physics state (prevent memory leaks)
      this.physDelta.delete(nodeId);
      this.physVel.delete(nodeId);

      console.log(`[TidyLayoutStrategy] Removed node ${nodeId} (numeric ID: ${numericId})`);
    }

    console.log('[TidyLayoutStrategy] After removal, wasmNodeIds size:', this.wasmNodeIds.size);
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
      // console.log(`[TidyLayoutStrategy] ${nodeId}: engine(${enginePos.x.toFixed(1)}, ${enginePos.y.toFixed(1)}) -> UI(${uiPos.x.toFixed(1)}, ${uiPos.y.toFixed(1)})`);
      uiPositions.set(nodeId, uiPos);
    }

    return uiPositions;
  }


  /**
   * Apply micro-relax with warm-start: force-directed physics to refine Tidy positions
   * with support for persisting deltas and velocities across incremental updates.
   *
   * Warm-start logic:
   * 1. Load existing deltas/velocities from previous run (if any)
   * 2. Initialize new nodes with delta=0, vel=0
   * 3. Apply physics simulation
   * 4. Write back new deltas: delta = relaxed - tidy
   */
  private async microRelaxWithWarmStart(
    tidyPositions: Map<string, Position>,
    allNodes: NodeInfo[],
    iterations: number
  ): Promise<Map<string, Position>> {
    if (!this.RELAX_ENABLED || tidyPositions.size === 0) {
      return tidyPositions;
    }

    console.log('[TidyLayoutStrategy] Applying micro-relax with warm-start,', iterations, 'iterations');

    // Warm-start: initialize positions from tidy + existing deltas
    const currentPositions = new Map<string, Position>();
    for (const [id, tidyPos] of tidyPositions) {
      const delta = this.physDelta.get(id) || { x: 0, y: 0 };
      currentPositions.set(id, {
        x: tidyPos.x + delta.x,
        y: tidyPos.y + delta.y
      });
    }

    // Run the physics simulation
    const relaxedPositions = await this.microRelaxInternal(
      currentPositions,
      allNodes,
      iterations
    );

    // Write back deltas: delta = relaxed - tidy
    for (const [id, relaxedPos] of relaxedPositions) {
      const tidyPos = tidyPositions.get(id);
      if (tidyPos) {
        this.physDelta.set(id, {
          x: relaxedPos.x - tidyPos.x,
          y: relaxedPos.y - tidyPos.y
        });
      }
    }

    return relaxedPositions;
  }

  /**
   * Internal micro-relax implementation: the actual physics simulation
   * Takes starting positions and returns relaxed positions after N iterations.
   */
  private async microRelaxInternal(
    startPositions: Map<string, Position>,
    allNodes: NodeInfo[],
    iterations: number
  ): Promise<Map<string, Position>> {

    // Build node lookup
    const nodeMap = new Map<string, NodeInfo>();
    for (const node of allNodes) {
      nodeMap.set(node.id, node);
    }

    // Clone positions for mutation
    const currentPositions = new Map<string, Position>();
    for (const [id, pos] of startPositions) {
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

    // Group leaves by parent first
    const parentToLeaves = new Map<string, string[]>();
    for (const node of allNodes) {
      const isLeaf = (!childrenMap.has(node.id) || childrenMap.get(node.id)!.length === 0) && !node.isShadowNode;
      if (!isLeaf) continue;

      const parentId = node.parentId || (node.linkedNodeIds && node.linkedNodeIds.length > 0 ? node.linkedNodeIds[0] : null);
      if (!parentId) continue;

      if (!parentToLeaves.has(parentId)) {
        parentToLeaves.set(parentId, []);
      }
      parentToLeaves.get(parentId)!.push(node.id);
    }

    // Then iterate siblings in order
    for (const [parentId, leafSiblings] of parentToLeaves) {
      if (leafSiblings.length < 3) continue;

      const parentPos = currentPositions.get(parentId);
      if (!parentPos) continue;

      for (let siblingIndex = 0; siblingIndex < leafSiblings.length; siblingIndex++) {
        const nodeId = leafSiblings[siblingIndex];
        const nodePos = currentPositions.get(nodeId);
        if (!nodePos) continue;

        // Distribute evenly around opposite semi-circle
        const angle = Math.PI + (siblingIndex) * (Math.PI) / (leafSiblings.length);
        const targetX = parentPos.x + this.LEAF_TARGET_DISTANCE * Math.cos(angle);
        const targetY = parentPos.y + this.LEAF_TARGET_DISTANCE * Math.sin(angle);

        // Blend current position with target (30/70) to seed hemisphere distribution
        nodePos.x = targetX;
        nodePos.y = targetY;
        console.log("AAANGLE", angle, leafSiblings, siblingIndex);
      }
    }

    // Apply Cola refinement with the seeded positions
    const colaOptions: ColaRefinementOptions = {
      maxSimulationTime: iterations * 10,  // Convert iterations to milliseconds
      convergenceThreshold: 0.1,
      avoidOverlap: true,
      nodeSpacing: 30,
      centerGraph: false,
      handleDisconnected: false,
    };

    console.log('[TidyLayoutStrategy] Applying Cola refinement with seeded positions');
    const refinedPositions = await applyColaRefinement(this.cy, currentPositions, allNodes, colaOptions);

    console.log('[TidyLayoutStrategy] Micro-relax complete');
    return refinedPositions;
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
