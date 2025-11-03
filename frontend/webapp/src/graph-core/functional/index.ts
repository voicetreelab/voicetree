/**
 * Functional Graph Architecture - Phase 3
 *
 * This module implements a functional approach to graph state management:
 *
 * - Pure projection: Graph domain model → Cytoscape UI representation
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
} from './types'

// Pure functions
export { projectToCytoscape } from './project-to-cytoscape'
export {
  createCreateNodeAction,
  createUpdateNodeAction,
  createDeleteNodeAction
} from './action-creators'

// State management
export { GraphStateManager } from './GraphStateManager'
