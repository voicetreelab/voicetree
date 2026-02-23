import type {Core, NodeSingular, CollectionReturnValue, EdgeCollection} from "cytoscape";
import type {GraphDelta, GraphNode} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js';
import {getNodeTitle} from "@/pure/graph/markdown-parsing";
import {hasActualContentChanged} from "@/pure/graph/contentChangeDetection";
import posthog from "posthog-js";
import {markTerminalActivityForContextNode} from "@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity";
import type {} from '@/utils/types/cytoscape-layout-utilities';
import {checkEngagementPrompts} from "./userEngagementPrompts";
import {setPendingPan, setPendingPanToNode, setPendingVoiceFollowPan} from "@/shell/edge/UI-edge/state/PendingPanStore";
import {getEditorByNodeId} from "@/shell/edge/UI-edge/state/EditorStore";
import {scheduleIdleWork} from "@/utils/scheduleIdleWork";
import { createNodePresentation } from '@/shell/edge/UI-edge/node-presentation/createNodePresentation';
import { destroyNodePresentation } from '@/shell/edge/UI-edge/node-presentation/destroyNodePresentation';
import { wireHoverTransitions } from '@/shell/edge/UI-edge/node-presentation/hoverWiring';
import { hasPresentation, getPresentation } from '@/shell/edge/UI-edge/node-presentation/NodePresentationStore';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { transitionTo } from '@/shell/edge/UI-edge/node-presentation/transitions';
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

                    // Create node presentation for non-context nodes
                    if (!node.nodeUIMetadata.isContextNode) {
                        const presentation: NodePresentation = createNodePresentation(
                            cy,
                            nodeId,
                            getNodeTitle(node),
                            node.contentWithoutYamlOrLinks,
                            colorValue,
                            pos
                        );

                        // Bind Cy node position event → update presentation element position
                        const cyNodeForPosition: CollectionReturnValue = cy.getElementById(nodeId);
                        if (cyNodeForPosition.length > 0) {
                            cyNodeForPosition.on('position', () => {
                                const zoom: number = cy.zoom();
                                const newPos: { x: number; y: number } = cyNodeForPosition.position();
                                presentation.element.style.left = `${newPos.x * zoom}px`;
                                presentation.element.style.top = `${newPos.y * zoom}px`;
                            });
                        }

                        // Wire hover/click state transitions
                        wireHoverTransitions(cy, nodeId, presentation.element);

                        // Flash new-node animation (remove class after animation to prevent replay on display toggle)
                        presentation.element.classList.add('node-presentation-new');
                        presentation.element.addEventListener('animationend', (): void => {
                            presentation.element.classList.remove('node-presentation-new');
                        }, { once: true });

                        // Auto-enter INLINE_EDIT for UI-created nodes (minimal content, no agent)
                        const isUICreatedNode: boolean = node.contentWithoutYamlOrLinks.trim().length <= 2; // "# " or empty
                        const isAgentNode: boolean = node.nodeUIMetadata.additionalYAMLProps.has('agent_name');
                        if (isUICreatedNode && !isAgentNode) {
                            void transitionTo(cy, nodeId, 'INLINE_EDIT', true);
                        }
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

                    // Update node presentation title + preview on every metadata update
                    if (hasPresentation(nodeId)) {
                        const pres: NodePresentation | undefined = getPresentation(nodeId);
                        if (pres) {
                            const titleEl: HTMLElement | null = pres.element.querySelector('.node-presentation-title');
                            if (titleEl) titleEl.textContent = getNodeTitle(node);
                            const previewEl: HTMLElement | null = pres.element.querySelector('.node-presentation-preview');
                            if (previewEl) {
                                previewEl.textContent = node.contentWithoutYamlOrLinks
                                    .split('\n')
                                    .filter((line: string) => line.trim().length > 0)
                                    .slice(0, 3)
                                    .join('\n');
                            }
                        }
                    }

                    // Only emit content-changed (blue animation) if actual content changed, not just links
                    if (O.isSome(nodeDelta.previousNode) &&
                        hasActualContentChanged(
                            nodeDelta.previousNode.value.contentWithoutYamlOrLinks,
                            node.contentWithoutYamlOrLinks
                        )) {
                        existingNode.emit('content-changed');
                        // Flash node presentation with content-changed animation
                        if (hasPresentation(nodeId)) {
                            const pres: NodePresentation | undefined = getPresentation(nodeId);
                            if (pres) {
                                pres.element.classList.add('node-presentation-content-changed');
                                pres.element.addEventListener('animationend', (): void => {
                                    pres.element.classList.remove('node-presentation-content-changed');
                                }, { once: true });
                            }
                        }
                    }
                }
            } else if (nodeDelta.type === 'DeleteNode') {
                const nodeId: string = nodeDelta.nodeId;
                const nodeToRemove: CollectionReturnValue = cy.getElementById(nodeId);
                if (nodeToRemove.length > 0) {
                    destroyNodePresentation(nodeId);
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


                        if (targetNode.length > 0) {
                            // Detect user-added wikilink: new edge from node with open editor
                            const hasOpenEditor: boolean = O.isSome(getEditorByNodeId(nodeId));
                            if (hasOpenEditor) {
                                setPendingPanToNode(edge.targetId);
                            }

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
                            // markTerminalActivityForContextNode checks both attachedToContextNodeId (context) and anchoredToNodeId (task)
                            // Deferred via requestIdleCallback since activity dots are non-critical visual feedback
                            scheduleIdleWork(() => {
                                markTerminalActivityForContextNode(nodeId);
                                markTerminalActivityForContextNode(edge.targetId);
                            }, 500);
                        } else {
                            console.debug(`[applyGraphDeltaToUI] Skipping edge ${nodeId}->${edge.targetId}: target node does not exist`);
                        }
                    }
                });
            }
        });
    });


    const newNodeCount: number = newNodeIds.length;
    const totalNodes: number = cy.nodes().length;
    const changeRatio: number = totalNodes > 0 ? newNodeCount / totalNodes : 1;

    // Set pending pan to be executed when layout completes (instead of arbitrary timeout)
    // This ensures we pan after layout positions are finalized, not before
    if (changeRatio > 0.3) {
        // Large batch (>30% new nodes): will fit all in view with padding
        setPendingPan('large-batch', newNodeIds, totalNodes);
    }
    else if (newNodeCount >= 1 && totalNodes <= 4) {
        // Will fit so average node takes target fraction of viewport
        setPendingPan('small-graph', newNodeIds, totalNodes);
    }
    else {
        // Auto-pan to new voice nodes so the view follows dictation
        for (let i: number = newNodeIds.length - 1; i >= 0; i--) {
            if (newNodeIds[i].includes('/voice/')) {
                setPendingVoiceFollowPan(newNodeIds[i]);
                break;
            }
        }
    }
    //console.log('[applyGraphDeltaToUI] Complete. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);

    // Defer non-critical analytics and engagement prompts to idle time
    scheduleIdleWork(() => {
        posthog.capture('graphDelta');

        // Show engagement prompts after enough deltas created in session
        if (newNodeCount) {
            checkEngagementPrompts();
        }
    }, 2000);

    return { newNodeIds };
}
