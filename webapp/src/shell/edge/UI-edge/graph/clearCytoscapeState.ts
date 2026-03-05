import type {Core} from "cytoscape";
import {syncLargeGraphPerformanceMode} from "@/shell/UI/cytoscape-graph-ui/services/largegraphPerformance";

/**
 * Clear all nodes and edges from Cytoscape
 *
 * Pure function that clears the entire graph state in Cytoscape.
 * Used when loading a new folder to ensure clean slate.
 *
 * @param cy - Cytoscape instance
 */
export function clearCytoscapeState(cy: Core): void {
    //console.log('[clearCytoscapeState] Clearing all cytoscape elements');
    cy.batch(() => {
        cy.elements().remove();
    });
    syncLargeGraphPerformanceMode(cy);
    //console.log('[clearCytoscapeState] Cleared. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);
}
