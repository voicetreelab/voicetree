import type {Core, NodeSingular, CollectionReturnValue, EdgeCollection} from "cytoscape";
import type {GraphDelta, GraphNode} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js';
import {getNodeTitle} from "@/pure/graph/markdown-parsing";
import {hasActualContentChanged} from "@/pure/graph/contentChangeDetection";
import posthog from "posthog-js";
import {markTerminalActivityForContextNode} from "@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity";
import type {} from '@/utils/types/cytoscape-layout-utilities';
import {cyFitCollectionByAverageNodeSize, getResponsivePadding} from "@/utils/responsivePadding";
import {checkEngagementPrompts} from "./userEngagementPrompts";
import {scheduleIdleWork} from "@/utils/scheduleIdleWork";
import {getTerminals} from "@/shell/edge/UI-edge/state/TerminalStore";
import {getShadowNodeId, getTerminalId} from "@/shell/edge/UI-edge/floating-windows/types";

/**
 * Validates if a color value is a valid CSS color using the browser's CSS.supports API
 */
function isValidCSSColor(color: string): boolean {
    if (!color) return false;
    return CSS.supports('color', color);
}

/**
 * Extract the vault path prefix from a node ID.
 * Node IDs are relative file paths like "openspec/foo.md" or "wed/bar.md".
 * Returns the first path segment (vault folder name).
 */
function getVaultPrefixFromNodeId(nodeId: string): string {
    const firstSlash: number = nodeId.indexOf('/');
    if (firstSlash === -1) return '';
    return nodeId.slice(0, firstSlash);
}

/**
 * Generate a subtle, muted color based on a vault path prefix.
 * Uses a hash of the prefix to create consistent hue, with low saturation
 * for a professional appearance that doesn't overpower explicit colors.
 */
function generateVaultColor(vaultPrefix: string): string | undefined {
    if (!vaultPrefix) return undefined;

    // Simple hash function to convert string to number
    let hash: number = 0;
    for (let i: number = 0; i < vaultPrefix.length; i++) {
        hash = vaultPrefix.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32-bit integer
    }

    // Generate hue from hash (0-360), keep saturation and lightness subtle
    const hue: number = Math.abs(hash % 360);
    // Low saturation (15-25%) and high lightness (88-92%) for subtle, professional look
    const saturation: number = 18 + (Math.abs(hash >> 8) % 8);
    const lightness: number = 89 + (Math.abs(hash >> 16) % 4);

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export interface ApplyGraphDeltaResult {
    newNodeIds: string[];
}

/**
 * Apply a GraphDelta to the Cytoscape UI-edge
 *
 * Handles:
 * - Creating new nodes with positions
 * - Updating existing nodes' metadata (except positions)
 * - Creating edges
 * - Deleting nodes
 *
 */
export function applyGraphDeltaToUI(cy: Core, delta: GraphDelta): ApplyGraphDeltaResult {
    //console.log("applyGraphDeltaToUI", delta.length);
    //console.log('[applyGraphDeltaToUI] Starting\n' + prettyPrintGraphDelta(delta));
    const newNodeIds: string[] = [];
    const nodesWithoutPositions: string[] = [];

    cy.batch(() => {
        // PASS 1: Create/update all nodes and handle deletions
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node: GraphNode = nodeDelta.nodeToUpsert;
                const nodeId: string = node.absoluteFilePathIsID;

                const existingNode: CollectionReturnValue = cy.getElementById(nodeId);
                const isNewNode: boolean = existingNode.length === 0;

                if (isNewNode) {
                    newNodeIds.push(nodeId);
                    const hasPosition: boolean = O.isSome(node.nodeUIMetadata.position);
                    // Use saved position or temporary (0,0) - placeNewNodes will fix nodes without positions
                    const pos: { x: number; y: number; } = O.getOrElse(() => ({x: 0, y: 0}))(node.nodeUIMetadata.position);
                    // Use frontmatter color if valid, otherwise generate subtle vault-based color
                    const vaultPrefix: string = getVaultPrefixFromNodeId(nodeId);
                    const colorValue: string | undefined = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : generateVaultColor(vaultPrefix);

                    //console.log(`[applyGraphDeltaToUI] Creating node ${nodeId} with color:`, colorValue);

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

                    // Create edge from terminal to node if agent_name matches terminal's agentName
                    const nodeAgentName: string | undefined = node.nodeUIMetadata.additionalYAMLProps.get('agent_name');
                    if (nodeAgentName) {
                        // Find terminal with matching agentName
                        const terminals: Map<string, import('@/shell/edge/UI-edge/floating-windows/types').TerminalData> = getTerminals();
                        // todo, make it O(1) with map by agentName
                        for (const terminal of terminals.values()) {
                            if (terminal.agentName === nodeAgentName) {
                                const shadowNodeId: string = getShadowNodeId(getTerminalId(terminal));
                                const shadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);
                                if (shadowNode.length > 0) {
                                    const edgeId: string = `terminal-progress-${shadowNodeId}->${nodeId}`;
                                    // isIndicatorEdge: true excludes this edge from Cola layout forces
                                    cy.add({
                                        group: 'edges' as const,
                                        data: {
                                            id: edgeId,
                                            source: shadowNodeId,
                                            target: nodeId,
                                            isIndicatorEdge: true
                                        },
                                        classes: 'terminal-progres-nodes-indicator'
                                    });
                                    //console.log(`[applyGraphDeltaToUI] Created terminal->node edge: ${edgeId}`);
                                    break; // Only link to first matching terminal
                                }
                            }
                        }
                    }

                    if (!hasPosition) {
                        nodesWithoutPositions.push(nodeId);
                    }
                } else if (existingNode.length > 0) {
                    // Update existing node metadata (but NOT position)
                    existingNode.data('label', getNodeTitle(node));
                    existingNode.data('content', node.contentWithoutYamlOrLinks);
                    existingNode.data('summary', '');
                    // Use frontmatter color if valid, otherwise generate subtle vault-based color
                    const existingVaultPrefix: string = getVaultPrefixFromNodeId(nodeId);
                    const color: string | undefined = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : generateVaultColor(existingVaultPrefix);
                    if (color === undefined) {
                        existingNode.removeData('color');
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
                const nodeId: string = node.absoluteFilePathIsID;

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
                        const targetNode: NodeSingular = cy.getElementById(target);
                        const isShadowNode: boolean = targetNode.length > 0 && targetNode.data('isShadowNode') === true;
                        if (isShadowNode) {
                            //console.log(`[applyGraphDeltaToUI] Keeping edge to shadow node: ${nodeId}->${target}`);
                            return;
                        }
                        //console.log(`[applyGraphDeltaToUI] Removing edge no longer in graph: ${nodeId}->${target}`);
                        edge.remove();
                    }
                });

                // Add edges for all outgoing connections (if they don't exist), and update labels for existing edges
                node.outgoingEdges.forEach((edge) => {
                    const edgeId: string = `${nodeId}->${edge.targetId}`;
                    const existingEdge: CollectionReturnValue = cy.getElementById(edgeId);
                    const MAX_EDGE_LABEL_LENGTH: number = 50;
                    const newLabel: string | undefined = edge.label
                        ? edge.label.replace(/_/g, ' ').slice(0, MAX_EDGE_LABEL_LENGTH) + (edge.label.length > MAX_EDGE_LABEL_LENGTH ? '…' : '')
                        : undefined;

                    // If edge already exists, update its label
                    if (existingEdge.length > 0) {
                        existingEdge.data('label', newLabel);
                        return;
                    }

                    if (!currentTargets.has(edge.targetId)) {
                        // Only create edge if target node exists
                        const targetNode: CollectionReturnValue = cy.getElementById(edge.targetId);
                        // if (cy.edges().length >= MAX_EDGES) {
                            // // Edge limit reached - only show alert once per delta application
                            // if (!edgeLimitAlertShown) {
                            //     alert(`There is a limit of ${MAX_EDGES} edges at once, contact 1manumasson@gmail.com to increase this`);
                            //     edgeLimitAlertShown = true;
                            // }
                            // console.warn(`[applyGraphDeltaToUI] Edge limit reached (${MAX_EDGES}), not adding edge ${edgeId}`);
                        // max edge disabled


                        if (targetNode.length > 0) {
                            //console.log(`[applyGraphDeltaToUI] Adding new edge: ${edgeId} with label ${edge.label}`);
                            cy.add({
                                group: 'edges' as const,
                                data: {
                                    id: edgeId,
                                    source: nodeId,
                                    target: edge.targetId,
                                    label: newLabel
                                }
                            });
                            // Mark terminal activity for both source and target nodes
                            // markTerminalActivityForContextNode checks both attachedToNodeId (context) and anchoredToNodeId (task)
                            // Deferred via requestIdleCallback since activity dots are non-critical visual feedback
                            scheduleIdleWork(() => {
                                markTerminalActivityForContextNode(nodeId);
                                markTerminalActivityForContextNode(edge.targetId);
                            }, 500);
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
        //console.log('[applyGraphDeltaToUI] Placing', nodesWithoutPositions.length, 'nodes without positions');
        const layoutUtils: ReturnType<Core['layoutUtilities']> = cy.layoutUtilities({ idealEdgeLength: 100, offset: 10 });
        layoutUtils.placeNewNodes(nodesCollection);
    }

    const newNodeCount: number = newNodeIds.length;
    const totalNodes: number = cy.nodes().length;
    const changeRatio: number = totalNodes > 0 ? newNodeCount / totalNodes : 1;

    if (changeRatio > 0.3) {
        // Large batch (>30% new nodes): fit all in view with padding
        setTimeout(() => { if (!cy.destroyed()) cy.fit(undefined, getResponsivePadding(cy, 15)); }, 150);
    }
    else if (newNodeCount >= 1 && totalNodes <= 4) {
        // Fit so average node takes target fraction of viewport (smart zoom: only zooms if needed)
        setTimeout(() => { if (!cy.destroyed()) cyFitCollectionByAverageNodeSize(cy, cy.nodes(), 0.15); }, 150);
    }
    //console.log('[applyGraphDeltaToUI] Complete. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);

    // Defer non-critical analytics and engagement prompts to idle time
    scheduleIdleWork(() => {
        posthog.capture('graphDelta');
        const _userId: string = posthog.get_distinct_id();
        //console.log("UUID", userId);

        // Show engagement prompts after enough deltas created in session
        if (newNodeCount) {
            checkEngagementPrompts();
        }
    }, 2000);

    return { newNodeIds };
}
