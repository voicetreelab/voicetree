import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, Node, NodeId} from '@/functional_graph/pure/types.ts'
import {calculateInitialPositionForChild} from "@/functional_graph/pure/positioning/calculateInitialPosition.ts";

/**
 * Pure action creator functions.
 *
 * These functions are PURE - they have no side effects and always
 * return the same output for the same input.
 *
 * They create well-formed action objects that can be sent to the main process.
 */

// human
// Creates a new child node and returns deltas for both the child and updated parent
export function fromUICreateChildToUpsertNode(
  g: Graph,
  parentNode: Node
): GraphDelta {
  // Create the new node with default values for an empty node
  const newNode: Node = {
    relativeFilePathIsID: parentNode.relativeFilePathIsID + '_' + parentNode.outgoingEdges.length, //todo doesn't guarantee uniqueness, but tis good enough
    outgoingEdges: [],
    content: '# New Node',
    nodeUIMetadata: {
      color: O.none,
      position: calculateInitialPositionForChild(parentNode, g)
    },
  }

  // Create updated parent node with edge to new child
  const updatedParentNode: Node = {
    ...parentNode,
    outgoingEdges: [...parentNode.outgoingEdges, newNode.relativeFilePathIsID]
  }

  console.log("new node / parent node", newNode.relativeFilePathIsID, parentNode.relativeFilePathIsID)

  // Return deltas for both the new child and the updated parent
  return [
    {
      type: 'UpsertNode',
      nodeToUpsert: newNode
    },
    {
      type: 'UpsertNode',
      nodeToUpsert: updatedParentNode
    }
  ]
}


export function createUpdateNodeAction(
  nodeId: NodeId,
  content: string,
  graph : Graph
): GraphDelta {
    return [{
        type: 'UpsertNode',
        nodeToUpsert: {...graph.nodes[nodeId], content}
    }]
}

/**
 * Creates a DeleteNode action.
 *
 * @param nodeId - ID of the node to delete
 * @returns A GraphDelta with the DeleteNode action
 */
export function createDeleteNodeAction(nodeId: string): GraphDelta {
  return [{
    type: 'DeleteNode',
    nodeId
  }]
}

//todo switch between the three (?)


