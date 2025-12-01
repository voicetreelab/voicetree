import type { GraphDelta, NodeDelta, UpsertNodeDelta, DeleteNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

/**
 * Computes the reverse of a GraphDelta for undo functionality.
 *
 * - UpsertNode with no previousNode (CREATE) → DeleteNode
 * - UpsertNode with previousNode (UPDATE) → UpsertNode restoring previous state
 * - DeleteNode with deletedNode → UpsertNode recreating the node
 * - DeleteNode without deletedNode → cannot reverse (skipped with warning)
 *
 * Actions are processed in reverse order to maintain consistency when multiple
 * related changes are undone together (e.g., create child + update parent edge).
 */
export function reverseDelta(delta: GraphDelta): GraphDelta {
    return [...delta].reverse().flatMap(reverseAction)
}

function reverseAction(action: NodeDelta): GraphDelta {
    switch (action.type) {
        case 'UpsertNode':
            return reverseUpsertNode(action)
        case 'DeleteNode':
            return reverseDeleteNode(action)
    }
}

function reverseUpsertNode(action: UpsertNodeDelta): GraphDelta {
    if (O.isNone(action.previousNode)) {
        // Was a CREATE (no previousNode) → reverse is DELETE
        const deleteAction: DeleteNode = {
            type: 'DeleteNode',
            nodeId: action.nodeToUpsert.relativeFilePathIsID,
            deletedNode: O.some(action.nodeToUpsert)  // Save for potential re-redo
        }
        return [deleteAction]
    }
    // Was an UPDATE → reverse is restore previous
    const restoreAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: action.previousNode.value,
        previousNode: O.some(action.nodeToUpsert)  // Swap old/new for redo chain
    }
    return [restoreAction]
}

function reverseDeleteNode(action: DeleteNode): GraphDelta {
    if (O.isNone(action.deletedNode)) {
        // Cannot reverse without knowing what was deleted
        console.warn('Cannot undo delete: missing deletedNode for', action.nodeId)
        return []
    }
    // Was a DELETE → reverse is CREATE
    const recreateAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: action.deletedNode.value,
        previousNode: O.none  // It's a 'new' node again
    }
    return [recreateAction]
}
