/**
 * Shared constants for Cytoscape graph layout
 * Re-exported from pure layer (source of truth)
 */

export { DEFAULT_EDGE_LENGTH } from "@vt/graph-model/spatial";
import { DEFAULT_EDGE_LENGTH } from "@vt/graph-model/spatial";

/** Editors use a short edge length to sit close to their parent node */
export function getEdgeDistance(windowType: string | undefined): number {
    if (windowType === 'Editor') return 125;
    return DEFAULT_EDGE_LENGTH;
}
