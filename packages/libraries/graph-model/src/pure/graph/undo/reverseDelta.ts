import type { GraphDelta, NodeDelta, UpsertNodeDelta, DeleteNode } from '..'
import * as O from 'fp-ts/lib/Option.js'

/**
 * Computes the reverse of a GraphDelta for undo functionality.
 *
 * - UpsertNode with no previousNode (CREATE) → DeleteNode
 * - UpsertNode whose previousNode shares its id (in-place UPDATE) → UpsertNode
 *   restoring previous state
 * - UpsertNode whose previousNode has a *different* id (MOVE/RENAME) → DeleteNode
 *   of the new id + UpsertNode restoring the previous node at its old id
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
            nodeId: action.nodeToUpsert.absoluteFilePathIsID,
            deletedNode: O.some(action.nodeToUpsert)  // Save for potential re-redo
        }
        return [deleteAction]
    }

    const previousNode: typeof action.previousNode.value = action.previousNode.value
    const isMove: boolean = previousNode.absoluteFilePathIsID !== action.nodeToUpsert.absoluteFilePathIsID
    if (isMove) {
        // Was a MOVE/RENAME: the upsert wrote a *new* node id whose recorded
        // "previous" lived at a different id (the source of the move). Restoring
        // the previous node alone would leave the new file in place — a duplicate.
        // The inverse must remove the new id AND restore the source at its old id.
        const deleteMoved: DeleteNode = {
            type: 'DeleteNode',
            nodeId: action.nodeToUpsert.absoluteFilePathIsID,
            deletedNode: O.some(action.nodeToUpsert)
        }
        const restoreSource: UpsertNodeDelta = {
            type: 'UpsertNode',
            nodeToUpsert: previousNode,
            previousNode: O.none  // The old id was vacant after the move → a CREATE
        }
        return [deleteMoved, restoreSource]
    }

    // Was an in-place UPDATE → reverse is restore previous
    const restoreAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: previousNode,
        previousNode: O.some(action.nodeToUpsert)  // Swap old/new for redo chain
    }
    return [restoreAction]
}

function reverseDeleteNode(action: DeleteNode): GraphDelta {
    if (O.isNone(action.deletedNode)) {
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
