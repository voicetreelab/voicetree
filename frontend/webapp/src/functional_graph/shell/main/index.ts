/**
 * Functional Graph Architecture - Phase 3
 *
 * This module implements a functional approach to graph state management:
 *
 * - Pure projection: Graph pure model → Cytoscape UI representation
 * - Idempotent reconciliation: Rendering same graph state has no effect
 * - Action-based mutations: All changes go through well-typed actions
 * - Single source of truth: Graph state lives in main process
 *
 * Architecture:
 * 1. User action → Action creator (pure function)
 * 2. Action → Main process (via IPC)
 * 3. Main process updates graph state
 * 4. Graph state → Broadcast to renderer
 * 5. GraphStateManager projects and reconciles
 *
 * Benefits:
 * - Optimistic updates possible
 * - Undo/redo ready (action log)
 * - Testable (pure functions)
 * - Predictable (immutable state)
 */

// Core types
export type {
  Graph,
  GraphNode,
  NodeId,
  NodeAction,
  CreateNode,
  UpdateNode,
  DeleteNode,
  Position,
  CytoscapeElements,
  CytoscapeNodeElement,
  CytoscapeEdgeElement
} from '@/functional_graph/pure/types.ts'

// Pure functions
export { projectToCytoscape } from '@/functional_graph/pure/cytoscape/project-to-cytoscape.ts'
export {
  createCreateNodeAction,
  createUpdateNodeAction,
  createDeleteNodeAction
} from '@/functional_graph/pure/action-creators.ts'

// State management - GraphStateManager removed (commented out in source)
