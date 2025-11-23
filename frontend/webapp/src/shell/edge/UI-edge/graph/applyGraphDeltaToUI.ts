import type {Core} from "cytoscape";
import type {GraphDelta} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js';
import {prettyPrintGraphDelta, stripDeltaForReplay} from "@/pure/graph";
import posthog from "posthog-js";

/**
 * Validates if a color value is a valid CSS color using the browser's CSS.supports API
 */
function isValidCSSColor(color: string): boolean {
    if (!color) return false;
    return CSS.supports('color', color);
}

/**
 * Apply a GraphDelta to the Cytoscape UI-edge
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
                    const colorValue = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : undefined;

                    console.log(`[applyGraphDeltaToUI] Creating node ${nodeId} with color:`, colorValue);

                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            id: nodeId,
                            label: node.nodeUIMetadata.title,
                            content: node.contentWithoutYamlOrLinks,
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
                    // DO NOT sET existingNode.data('content', node.content); it's too much storage duplicated unnec in frontend.
                    existingNode.data('summary', '');
                    const color = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : undefined;
                    if (color === undefined) {
                        existingNode.removeData('color'); // todo, really necessary? Cytoscape doesn't clear values when set to undefined but that shouldn't matter?
                    } else {
                        existingNode.data('color', color);
                    }
                    existingNode.emit('content-changed'); //todo, this event system, should we use this or hook into FS at breathing animation? same for markdown editor updates...
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
                const desiredTargets = new Set(node.outgoingEdges.map(edge => edge.targetId));

                // Remove edges that are no longer in outgoingEdges
                currentEdges.forEach((edge) => {
                    const target = edge.data('target');
                    if (!desiredTargets.has(target)) {
                        if (!target.includes("shadow")){
                            // Only remove edge if target node doesn't exist in UI-edge
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
                node.outgoingEdges.forEach((edge) => {
                    if (!currentTargets.has(edge.targetId)) {
                        const edgeId = `${nodeId}->${edge.targetId}`;
                        // Only create edge if target node exists
                        const targetNode = cy.getElementById(edge.targetId);
                        if (targetNode.length > 0) {
                            console.log(`[applyGraphDeltaToUI] Adding new edge: ${edgeId} with label ${edge.label}`);
                            cy.add({
                                group: 'edges' as const,
                                data: {
                                    id: edgeId,
                                    source: nodeId,
                                    target: edge.targetId,
                                    label: edge.label ? edge.label.replace(/_/g, ' ') : undefined
                                }
                            });
                        } else {
                            console.warn(`[applyGraphDeltaToUI] Skipping edge ${nodeId}->${edge.targetId}: target node does not exist`);
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
