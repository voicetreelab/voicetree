import type {Graph, GraphNode, Position} from "@/functional_graph/pure/types.ts";
import * as O from 'fp-ts/lib/Option.js'
import {
    calculateChildAngle,
    calculateParentAngle,
    polarToCartesian,
    SPAWN_RADIUS
} from "@/functional_graph/pure/cytoscape/layout/angularPositionSeeding.ts";
import {findFirstParentNode} from "@/functional_graph/pure/findFirstParentNode.ts";

/**
 * Calculate initial position for a new child node (pure function)
 *
 * Uses angular position seeding to place the child at an appropriate angle
 * from the parent, based on how many siblings already exist.
 *
 * @param parentNode - The parent node that the child will spawn from
 * @param graph - The graph to search for grandparent node
 * @returns Position for the new child node, or None if parent has no position
 */
export function calculateInitialPositionForChild(parentNode: GraphNode, graph: Graph): O.Option<Position> {
    // Get parent's position
    return O.chain((parentPos: Position) => {
        // Find grandparent to determine parent's angle constraint
        const grandparentNode = findFirstParentNode(parentNode, graph);
        const parentAngle = calculateParentAngle(parentNode, grandparentNode);

        // Count existing children (siblings for the new node)
        const siblingCount = parentNode.outgoingEdges.length;

        // Calculate angle for this child (will be the Nth child, 0-indexed)
        const angle = calculateChildAngle(siblingCount, parentAngle);

        // Convert to cartesian offset
        const offset = polarToCartesian(angle, SPAWN_RADIUS);

        return O.some({
            x: parentPos.x + offset.x,
            y: parentPos.y + offset.y
        });
    })(parentNode.nodeUIMetadata.position);
}

// export calculateInitialPosition()
// todo, this function if parent will return  calculateInitialPositionForChild
// else will return 0,0