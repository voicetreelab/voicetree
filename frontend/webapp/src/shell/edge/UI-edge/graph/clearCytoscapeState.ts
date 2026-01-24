import type {Core} from "cytoscape";

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
    //console.log('[clearCytoscapeState] Cleared. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);
}
