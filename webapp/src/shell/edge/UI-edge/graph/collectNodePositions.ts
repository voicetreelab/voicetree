import type {NodeDefinition} from "cytoscape";
import type {Position} from "@vt/graph-model/graph";

/**
 * Reduce `cy.nodes().jsons()` (typed as NodeDefinition[]; note @types/cytoscape
 * mistypes the runtime value) into the `{nodeId: {x, y}}` map that graphd's
 * `/graph/write-positions` endpoint expects. Nodes without a string id or a
 * finite position are skipped. Pure — shared by the Electron main path and the
 * browser runtime adapter so both produce the identical wire shape.
 */
export function collectNodePositions(cyNodes: readonly NodeDefinition[]): Record<string, Position> {
    const positions: Record<string, Position> = {};
    for (const node of cyNodes) {
        const id: unknown = node.data?.id;
        const position: Position | undefined = node.position as Position | undefined;
        if (
            typeof id !== 'string'
            || position === undefined
            || !Number.isFinite(position.x)
            || !Number.isFinite(position.y)
        ) {
            continue;
        }
        positions[id] = position;
    }
    return positions;
}
