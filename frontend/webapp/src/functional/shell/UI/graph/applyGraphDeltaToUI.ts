import type {Core} from "cytoscape";
import type {GraphDelta} from "@/functional/pure/graph/types.ts";
import * as O from 'fp-ts/lib/Option.js';
import {prettyPrintGraphDelta} from "@/functional/pure/graph/graph-operations /prettyPrint.ts";
import posthog from "posthog-js";
import {stripDeltaForReplay} from "@/functional/pure/graph/graphDelta/stripDeltaForReplay.ts";

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
                    const colorValue = O.isSome(node.nodeUIMetadata.color)
                        ? node.nodeUIMetadata.color.value
                        : undefined;

                    console.log(`[applyGraphDeltaToUI] Creating node ${nodeId} with color:`, colorValue);

                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            id: nodeId,
                            label: node.nodeUIMetadata.title,
                            content: node.content,
                            summary: '',
                            color: colorValue
                        },
                        position: {
                            x: pos.x,
                            y: pos.y
                        }
                    });
                } else {
                    // Update existing node metadata (but NOT position)
                    existingNode.data('label', node.nodeUIMetadata.title);
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

        // PASS 2: Sync edges for each node (add missing, remove stale)
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node = nodeDelta.nodeToUpsert;
                const nodeId = node.relativeFilePathIsID;

                // Get current edges from this node in Cytoscape
                const currentEdges = cy.edges(`[source = "${nodeId}"]`);
                const currentTargets = new Set(currentEdges.map(edge => edge.data('target')));
                const desiredTargets = new Set(node.outgoingEdges);

                // Remove edges that are no longer in outgoingEdges
                currentEdges.forEach((edge) => {
                    const target = edge.data('target');
                    if (!desiredTargets.has(target)) {
                        if (!target.includes("shadow")){
                            // Only remove edge if target node doesn't exist in UI
                            // This prevents race condition where file watcher processes parent before child exists
                            const targetNode = cy.getElementById(target);
                            if (targetNode.length === 0) {
                                console.log(`[applyGraphDeltaToUI] Removing stale edge: ${nodeId}->${target}`);
                                edge.remove();
                            } else {
                                console.log(`[applyGraphDeltaToUI] Keeping edge to existing node: ${nodeId}->${target} (race condition protection)`);
                            }
                        }
                        else {
                            // todo, make shadow node part of the pure Graph type system / DSL itself.
                            console.log("Not removing shadow node.")
                        }
                    }
                });

                // Add edges for all outgoing connections (if they don't exist)
                node.outgoingEdges.forEach((targetId) => {
                    if (!currentTargets.has(targetId)) {
                        const edgeId = `${nodeId}->${targetId}`;
                        // Only create edge if target node exists
                        const targetNode = cy.getElementById(targetId);
                        if (targetNode.length > 0) {
                            console.log(`[applyGraphDeltaToUI] Adding new edge: ${edgeId}`);
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
    //analytics
    const anonGraphDelta = stripDeltaForReplay(delta);
    posthog.capture('graphDelta', { delta: anonGraphDelta });
    const userId = posthog.get_distinct_id()
    console.log("UUID", userId);
    console.log('[applyGraphDeltaToUI] Complete. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);
}
