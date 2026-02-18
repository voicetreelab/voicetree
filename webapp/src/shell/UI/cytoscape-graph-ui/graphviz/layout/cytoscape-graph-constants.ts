/**
 * Shared constants for Cytoscape graph layout
 * Re-exported from pure layer (source of truth)
 */

export { DEFAULT_EDGE_LENGTH } from "@/pure/graph/positioning/angularPositionSeeding";
import { DEFAULT_EDGE_LENGTH } from "@/pure/graph/positioning/angularPositionSeeding";

/** Editors use a short edge length to sit close to their parent node */
export function getEdgeDistance(windowType: string | undefined): number {
    if (windowType === 'Editor') return 50;
    return DEFAULT_EDGE_LENGTH;
}
