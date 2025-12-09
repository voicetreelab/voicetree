import type {Core, NodeSingular, CollectionReturnValue, EdgeCollection} from "cytoscape";
type CyNodeSingular = NodeSingular;
import type {GraphDelta, GraphNode} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js';
import {prettyPrintGraphDelta, stripDeltaForReplay} from "@/pure/graph";
import {getNodeTitle} from "@/pure/graph/markdown-parsing";
import {hasActualContentChanged} from "@/pure/graph/contentChangeDetection";
import posthog from "posthog-js";
import {markTerminalActivityForContextNode} from "@/shell/UI/views/AgentTabsBar";
import type {} from '@/utils/types/cytoscape-layout-utilities';

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
    let newNodeCount: number = 0;
    const nodesWithoutPositions: string[] = [];
    cy.batch(() => {
        // PASS 1: Create/update all nodes and handle deletions
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node: GraphNode = nodeDelta.nodeToUpsert;
                const nodeId: string = node.relativeFilePathIsID;
                const existingNode: CollectionReturnValue = cy.getElementById(nodeId);
                const isNewNode: boolean = existingNode.length === 0;

                if (isNewNode) {
                    newNodeCount++;
                    const hasPosition: boolean = O.isSome(node.nodeUIMetadata.position);
                    // Use saved position or temporary (0,0) - placeNewNodes will fix nodes without positions
                    const pos: { x: number; y: number; } = O.getOrElse(() => ({x: 0, y: 0}))(node.nodeUIMetadata.position);
                    const colorValue: string | undefined = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : undefined;

                    console.log(`[applyGraphDeltaToUI] Creating node ${nodeId} with color:`, colorValue);

                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            id: nodeId,
                            label: getNodeTitle(node),
                            content: node.contentWithoutYamlOrLinks,
                            summary: '',
                            color: colorValue,
                            isContextNode: node.nodeUIMetadata.isContextNode === true
                        },
                        position: {
                            x: pos.x,
                            y: pos.y
                        }
                    });

                    if (!hasPosition) {
                        nodesWithoutPositions.push(nodeId);
                    }
                } else {
                    // Update existing node metadata (but NOT position)
                    existingNode.data('label', getNodeTitle(node));
                    // DO NOT sET existingNode.data('content', node.content); it's too much storage duplicated unnec in frontend.
                    existingNode.data('summary', '');
                    const color: string | undefined = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : undefined;
                    if (color === undefined) {
                        existingNode.removeData('color'); // todo, really necessary? Cytoscape doesn't clear values when set to undefined but that shouldn't matter?
                    } else {
                        existingNode.data('color', color);
                    }
                    existingNode.data('isContextNode', node.nodeUIMetadata.isContextNode === true);
                    // Only emit content-changed (blue animation) if actual content changed, not just links
                    if (O.isSome(nodeDelta.previousNode) &&
                        hasActualContentChanged(
                            nodeDelta.previousNode.value.contentWithoutYamlOrLinks,
                            node.contentWithoutYamlOrLinks
                        )) {
                        existingNode.emit('content-changed');
                    }
                }
            } else if (nodeDelta.type === 'DeleteNode') {
                const nodeId: string = nodeDelta.nodeId;
                const nodeToRemove: CollectionReturnValue = cy.getElementById(nodeId);
                if (nodeToRemove.length > 0) {
                    nodeToRemove.remove();
                }
            }
        });

        // PASS 2: Sync edges for each node (add missing, remove stale)
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node: GraphNode = nodeDelta.nodeToUpsert;
                const nodeId: string = node.relativeFilePathIsID;

                // Get current edges from this node in Cytoscape
                const currentEdges: EdgeCollection = cy.edges(`[source = "${nodeId}"]`);
                const currentTargets: Set<string> = new Set(currentEdges.map(edge => edge.data('target') as string));
                const desiredTargets: Set<string> = new Set(node.outgoingEdges.map(edge => edge.targetId));

                // Remove edges that are no longer in outgoingEdges
                // BUT: Don't remove edges to floating window shadow nodes (terminals/editors)
                // These are UI-only nodes not tracked in the graph model
                currentEdges.forEach((edge) => {
                    const target: string = edge.data('target') as string;
                    if (!desiredTargets.has(target)) {
                        const targetNode: CyNodeSingular =  cy.getElementById(target);
                        const isShadowNode: boolean = targetNode.length > 0 && targetNode.data('isShadowNode') === true;
                        if (isShadowNode) {
                            console.log(`[applyGraphDeltaToUI] Keeping edge to shadow node: ${nodeId}->${target}`);
                            return;
                        }
                        console.log(`[applyGraphDeltaToUI] Removing edge no longer in graph: ${nodeId}->${target}`);
                        edge.remove();
                    }
                });

                // Add edges for all outgoing connections (if they don't exist)
                node.outgoingEdges.forEach((edge) => {
                    if (!currentTargets.has(edge.targetId)) {
                        const edgeId: string = `${nodeId}->${edge.targetId}`;
                        // Only create edge if target node exists AND edge doesn't already exist
                        // (belt-and-suspenders check - currentTargets should catch most cases,
                        // but direct getElementById catches edge cases like same node appearing
                        // multiple times in delta or race conditions between deltas)
                        const targetNode: CollectionReturnValue = cy.getElementById(edge.targetId);
                        const existingEdge: CollectionReturnValue = cy.getElementById(edgeId);
                        if (existingEdge.length > 0) {
                            // Edge already exists (race condition or duplicate in delta)
                            console.log(`[applyGraphDeltaToUI] Edge ${edgeId} already exists, skipping`);
                        } else if (targetNode.length > 0) {
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
                            // If source or target is a context node, mark associated terminal as having activity
                            console.log(`[applyGraphDeltaToUI] Checking isContextNode for ${nodeId}:`, node.nodeUIMetadata.isContextNode);
                            if (node.nodeUIMetadata.isContextNode === true) {
                                console.log(`[applyGraphDeltaToUI] Context node ${nodeId} got new edge, marking terminal activity`);
                                markTerminalActivityForContextNode(nodeId);
                            }
                            // Always try to mark activity - markTerminalActivityForContextNode handles non-context nodes gracefully
                            markTerminalActivityForContextNode(edge.targetId);
                        } else {
                            console.warn(`[applyGraphDeltaToUI] Skipping edge ${nodeId}->${edge.targetId}: target node does not exist`);
                        }
                    }
                });
            }
        });
    });

    // Place nodes that don't have saved positions near their neighbors
    if (nodesWithoutPositions.length > 0) {
        let nodesCollection: ReturnType<Core['collection']> = cy.collection();
        nodesWithoutPositions.forEach((nodeId: string) => {
            nodesCollection = nodesCollection.merge(cy.getElementById(nodeId));
        });
        console.log('[applyGraphDeltaToUI] Placing', nodesWithoutPositions.length, 'nodes without positions');
        const layoutUtils: ReturnType<Core['layoutUtilities']> = cy.layoutUtilities({ idealEdgeLength: 200, offset: 50 });
        layoutUtils.placeNewNodes(nodesCollection);
    }

    if (newNodeCount>=1 && cy.nodes().length <= 4){
        setTimeout(() => { if (!cy.destroyed()) cy.fit(); }, 150); // fit when a new node comes in for the first few nodes.
    }
    else if (newNodeCount >= 2) { // if not just one node + incoming changing, probs a bulk load.
        setTimeout(() => { if (!cy.destroyed()) cy.fit(); }, 150);
    }
    //analytics
    const anonGraphDelta: GraphDelta = stripDeltaForReplay(delta);
    posthog.capture('graphDelta', {delta: anonGraphDelta});
    const userId: string = posthog.get_distinct_id()
    console.log("UUID", userId);
    console.log('[applyGraphDeltaToUI] Complete. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);
}
