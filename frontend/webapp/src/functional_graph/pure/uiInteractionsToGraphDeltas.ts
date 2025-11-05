import * as O from 'fp-ts/lib/Option.js'
import type {
    CreateEmptyNodeFromUIInteraction,
    UpsertNodeAction,
    DeleteNode,
    Position,
    Node,
    Graph, NodeId, GraphDelta
} from '@/functional_graph/pure/types'
import {
    calculateChildAngle,
    calculateParentAngle,
    polarToCartesian,
    SPAWN_RADIUS
} from '@/functional_graph/pure/cytoscape/layout/angularPositionSeeding';

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
    idAndFilePath: parentNode.idAndFilePath + '_' + parentNode.outgoingEdges.length, //todo doesn't guarantee uniqueness, but tis good enough
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
    outgoingEdges: [...parentNode.outgoingEdges, newNode.idAndFilePath]
  }

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

/**
 * Calculate initial position for a new child node (pure function)
 *
 * Uses angular position seeding to place the child at an appropriate angle
 * from the parent, based on how many siblings already exist.
 *
 * @param parentNode - The parent node that the child will spawn from
 * @param graph - The graph to search for grandparent node
 * @returns Position for the new child node
 */
function calculateInitialPositionForChild(parentNode: Node, graph: Graph): Position {
    // Get parent's position
    const parentPos = parentNode.nodeUIMetadata.position;

    // Find grandparent to determine parent's angle constraint
    const grandparentNode = findParentNode(parentNode, graph);
    const parentAngle = calculateParentAngle(parentNode, grandparentNode);

    // Count existing children (siblings for the new node)
    const siblingCount = parentNode.outgoingEdges.length;

    // Calculate angle for this child (will be the Nth child, 0-indexed)
    const angle = calculateChildAngle(siblingCount, parentAngle);

    // Convert to cartesian offset
    const offset = polarToCartesian(angle, SPAWN_RADIUS);

    return {
        x: parentPos.x + offset.x,
        y: parentPos.y + offset.y
    };
}

/**
 * Find the parent node of a given node by searching the graph
 *
 * @param node - The node to find the parent of
 * @param graph - The graph to search
 * @returns The parent node, or undefined if no parent exists (root node)
 */
function findParentNode(node: Node, graph: Graph): Node | undefined {
    // Search for a node that has this node in its outgoingEdges
    for (const candidateNode of Object.values(graph.nodes)) {
        if (candidateNode.outgoingEdges.includes(node.idAndFilePath)) {
            return candidateNode;
        }
    }
    return undefined;
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

//todo switch between the three


