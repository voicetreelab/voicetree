import type {Core} from "cytoscape";
import type {GraphDelta} from "@/functional_graph/pure/types.ts";
import * as O from 'fp-ts/lib/Option.js';
import {prettyPrintGraphDelta} from "@/functional_graph/pure/prettyPrint.ts";

/**
 * Apply a GraphDelta to the Cytoscape UI
 *
 * Handles:
 * - Creating new nodes with positions
 * - Updating existing nodes' metadata (except positions)
 * - Creating edges
 * - Deleting nodes
 */
export function applyGraphDeltaToUI(cy: Core, delta: GraphDelta): void {
    console.log("applyGraphDeltaToUI", delta.length);
    console.log('[applyGraphDeltaToUI] Starting\n' + prettyPrintGraphDelta(delta));
    cy.batch(() => {
        // PASS 1: Create/update all nodes and handle deletions
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node = nodeDelta.nodeToUpsert;
                const nodeId = node.relativeFilePathIsID;
                const existingNode = cy.getElementById(nodeId);
                const isNewNode = existingNode.length === 0;

                if (isNewNode) {
                    // Add new node with position (or default to origin if none)
                    const pos = O.getOrElse(() => ({ x: 0, y: 0 }))(node.nodeUIMetadata.position);
                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            id: nodeId,
                            label: nodeId,
                            content: node.content,
                            summary: '',
                            color: O.isSome(node.nodeUIMetadata.color)
                                ? node.nodeUIMetadata.color.value
                                : undefined
                        },
                        position: {
                            x: pos.x,
                            y: pos.y
                        }
                    });
                } else {
                    // Update existing node metadata (but NOT position)

                    // TODO SEND NODE CONTENT TO NODE EDITOR
                    // window.markdownEditors[nodeID].updatContent(node.content)


                    existingNode.data('label', nodeId);
                    existingNode.data('summary', '');
                    const color = O.isSome(node.nodeUIMetadata.color)
                        ? node.nodeUIMetadata.color.value
                        : undefined;
                    existingNode.data('color', color);
                }
            } else if (nodeDelta.type === 'DeleteNode') {
                const nodeId = nodeDelta.nodeId;
                const nodeToRemove = cy.getElementById(nodeId);
                if (nodeToRemove.length > 0) {
                    nodeToRemove.remove();
                }
            }
        });

        // PASS 2: Create all edges (now that all nodes exist)
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node = nodeDelta.nodeToUpsert;
                const nodeId = node.relativeFilePathIsID;

                // Add edges for all outgoing connections (if they don't exist)
                node.outgoingEdges.forEach((targetId) => {
                    const edgeId = `${nodeId}->${targetId}`;
                    if (!cy.getElementById(edgeId).length) {
                        // Only create edge if target node exists
                        const targetNode = cy.getElementById(targetId);
                        if (targetNode.length > 0) {
                            cy.add({
                                group: 'edges' as const,
                                data: {
                                    id: edgeId,
                                    source: nodeId,
                                    target: targetId
                                }
                            });
                        } else {
                            console.warn(`[applyGraphDeltaToUI] Skipping edge ${nodeId}->${targetId}: target node does not exist`);
                        }
                    }
                });
            }
        });
    });
    if (delta.length > 2 ) {
        cy.fit()
        // setTimeout(() =>  cy.fit(), 800) // cy.fit  after layout would have finished. UNNECESSARY IF WE HAVE POSITIONS DERIVED FROM ANGULAR
    }
    console.log('[applyGraphDeltaToUI] Complete. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);
}
