import type {Graph, Node, Position} from "@/functional_graph/pure/types.ts";
import {
    calculateChildAngle,
    calculateParentAngle,
    polarToCartesian,
    SPAWN_RADIUS
} from "@/functional_graph/pure/cytoscape/layout/angularPositionSeeding.ts";
import {findParentNode} from "@/functional_graph/pure/findParentNode.ts";

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
export function calculateInitialPositionForChild(parentNode: Node, graph: Graph): Position {
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

// export calculateInitialPosition()
// todo, this function if parent will return  calculateInitialPositionForChild
// else will return 0,0