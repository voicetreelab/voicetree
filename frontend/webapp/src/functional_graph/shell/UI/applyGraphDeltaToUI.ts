import type {Core} from "cytoscape";
import type {GraphDelta} from "@/functional_graph/pure/types.ts";
import {GHOST_ROOT_ID} from "@/graph-core/constants.ts";
import * as O from 'fp-ts/lib/Option.js';

/**
 * Apply a GraphDelta to the Cytoscape UI
 *
 * Handles:
 * - Creating new nodes with positions
 * - Updating existing nodes' metadata (except positions)
 * - Creating edges (including to ghost root for orphan nodes)
 * - Deleting nodes
 */
export function applyGraphDeltaToUI(cy: Core, delta: GraphDelta): void {
    cy.batch(() => {
        // Ensure ghost root exists before processing deltas
        ensureGhostRoot(cy);

        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node = nodeDelta.nodeToUpsert;
                const nodeId = node.relativeFilePathIsID;
                const existingNode = cy.getElementById(nodeId);
                const isNewNode = existingNode.length === 0;

                if (isNewNode) {
                    // Add new node with position
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
                            x: node.nodeUIMetadata.position.x,
                            y: node.nodeUIMetadata.position.y
                        }
                    });

                    // Connect to ghost root if no parent (orphan node)
                    if (node.outgoingEdges.length === 0) {
                        const ghostEdgeId = `${GHOST_ROOT_ID}->${nodeId}`;
                        if (!cy.getElementById(ghostEdgeId).length) {
                            cy.add({
                                group: 'edges' as const,
                                data: {
                                    id: ghostEdgeId,
                                    source: GHOST_ROOT_ID,
                                    target: nodeId,
                                    isGhostEdge: true
                                }
                            });
                        }
                    }
                } else {
                    // Update existing node metadata (but NOT position)
                    existingNode.data('content', node.content);
                    existingNode.data('label', nodeId);
                    existingNode.data('summary', '');
                    const color = O.isSome(node.nodeUIMetadata.color)
                        ? node.nodeUIMetadata.color.value
                        : undefined;
                    existingNode.data('color', color);
                }

                // Add edges for all outgoing connections (if they don't exist)
                node.outgoingEdges.forEach((targetId) => {
                    const edgeId = `${nodeId}->${targetId}`;
                    if (!cy.getElementById(edgeId).length) {
                        // Ensure target node exists (create placeholder if needed)
                        ensureNodeExists(cy, targetId, nodeId);

                        cy.add({
                            group: 'edges' as const,
                            data: {
                                id: edgeId,
                                source: nodeId,
                                target: targetId
                            }
                        });
                    }
                });

            } else if (nodeDelta.type === 'DeleteNode') {
                const nodeId = nodeDelta.nodeId;
                const nodeToRemove = cy.getElementById(nodeId);
                if (nodeToRemove.length > 0) {
                    nodeToRemove.remove();
                }
            }
        });
    });
}

/**
 * Ensure ghost root node exists in the graph
 */
function ensureGhostRoot(cy: Core): void {
    if (!cy.getElementById(GHOST_ROOT_ID).length) {
        cy.add({
            data: {
                id: GHOST_ROOT_ID,
                label: '',
                linkedNodeIds: [],
                isGhostRoot: true
            },
            position: { x: 0, y: 0 }
        });
    }
}

/**
 * Ensure a target node exists, creating a placeholder if necessary
 */
function ensureNodeExists(cy: Core, targetId: string, referenceNodeId: string): void {
    if (!cy.getElementById(targetId).length) {
        // Position placeholder near reference node
        const referenceNode = cy.getElementById(referenceNodeId);
        const placeholderPos = referenceNode.length > 0
            ? {
                x: referenceNode.position().x + 150,
                y: referenceNode.position().y
            }
            : { x: cy.width() / 2, y: cy.height() / 2 };

        cy.add({
            data: {
                id: targetId,
                label: targetId,
                linkedNodeIds: [],
                content: '',
                summary: ''
            },
            position: placeholderPos
        });
    }
}

