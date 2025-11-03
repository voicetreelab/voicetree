import * as O from 'fp-ts/lib/Option.js'
import type { CreateNode, UpdateNode, DeleteNode, Position } from '@/functional_graph/pure/types'

/**
 * Pure action creator functions.
 *
 * These functions are PURE - they have no side effects and always
 * return the same output for the same input.
 *
 * They create well-formed action objects that can be sent to the main process.
 */

/**
 * Creates a CreateNode action.
 *
 * @param nodeId - Unique identifier for the new node
 * @param content - Markdown content for the node
 * @param position - Optional position for the node
 * @returns A well-formed CreateNode action
 */
export function createCreateNodeAction(
  nodeId: string,
  content: string,
  position?: Position
): CreateNode {
  return {
    type: 'CreateNode',
    nodeId,
    content,
    position: position ? O.some(position) : O.none
  }
}

/**
 * Creates an UpdateNode action.
 *
 * @param nodeId - ID of the node to update
 * @param content - New markdown content for the node
 * @returns A well-formed UpdateNode action
 */
export function createUpdateNodeAction(
  nodeId: string,
  content: string
): UpdateNode {
  return {
    type: 'UpdateNode',
    nodeId,
    content
  }
}

/**
 * Creates a DeleteNode action.
 *
 * @param nodeId - ID of the node to delete
 * @returns A well-formed DeleteNode action
 */
export function createDeleteNodeAction(nodeId: string): DeleteNode {
  return {
    type: 'DeleteNode',
    nodeId
  }
}
