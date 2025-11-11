import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode} from '@/functional_graph/pure/types.ts'
import {calculateInitialPositionForChild} from "@/functional_graph/pure/positioning/calculateInitialPosition.ts";
import {addOutgoingEdge} from "@/functional_graph/pure/graph-operations /graph-edge-operations.ts";
import {extractLinkedNodeIds} from "@/functional_graph/pure/markdown-parsing/extract-linked-node-ids.ts";

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
  graph: Graph,
  parentNode: GraphNode
): GraphDelta {
  // Create the new node with default values for an empty node
  const newNode: GraphNode = {
    relativeFilePathIsID: parentNode.relativeFilePathIsID + '_' + parentNode.outgoingEdges.length, //todo doesn't guarantee uniqueness, but tis good enough
    outgoingEdges: [],
    content: '# Title',
    nodeUIMetadata: {
      color: O.none,
        title: "Child of " + parentNode.nodeUIMetadata.title,
      position: calculateInitialPositionForChild(parentNode, graph, undefined, 200)
    },
  }

  // Create updated parent node with edge to new child
  const updatedParentNode: GraphNode = addOutgoingEdge(parentNode, newNode.relativeFilePathIsID)

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


export function fromContentChangeToGraphDelta(
  Node: GraphNode,
  content: string,
  graph: Graph,
): GraphDelta {
    // Extract wikilinks from new content and update outgoingEdges
    // This ensures markdown is the source of truth for edges
    const newOutgoingEdges = extractLinkedNodeIds(content, graph.nodes);

    return [{
        type: 'UpsertNode',
        nodeToUpsert: {...Node, content, outgoingEdges: newOutgoingEdges}
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


