import type { Core, CollectionReturnValue, EdgeCollection, NodeSingular } from 'cytoscape'
import type { GraphDelta, GraphNode } from '@vt/graph-model/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import { getNodeTitle } from '@vt/graph-model/pure/graph/markdown-parsing'
import { hasActualContentChanged } from '@vt/graph-model/pure/graph/contentChangeDetection'

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

    let hash: number = 0;
    for (let i: number = 0; i < vaultPrefix.length; i++) {
        hash = vaultPrefix.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }

    const hue: number = Math.abs(hash % 360);
    const saturation: number = 18 + (Math.abs(hash >> 8) % 8);
    const lightness: number = 89 + (Math.abs(hash >> 16) % 4);

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export interface ApplyGraphDeltaResult {
    newNodeIds: string[];
}

/**
 * Apply a GraphDelta to a Cytoscape instance for web (non-Electron) use.
 *
 * Core Cytoscape CRUD only — no terminals, panning, auto-pin, analytics, or engagement prompts.
 */
export function applyGraphDeltaToWebUI(cy: Core, delta: GraphDelta): ApplyGraphDeltaResult {
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
                    // Skip adding context nodes to cytoscape entirely
                    if (node.nodeUIMetadata.isContextNode === true) return;

                    newNodeIds.push(nodeId);
                    const hasPosition: boolean = O.isSome(node.nodeUIMetadata.position);
                    const pos: { x: number; y: number } = O.getOrElse(() => ({ x: 0, y: 0 }))(node.nodeUIMetadata.position);

                    const vaultPrefix: string = getVaultPrefixFromNodeId(nodeId);
                    const colorValue: string | undefined = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : generateVaultColor(vaultPrefix);

                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            id: nodeId,
                            label: getNodeTitle(node),
                            content: node.contentWithoutYamlOrLinks,
                            summary: '',
                            color: colorValue,
                            isContextNode: !!node.nodeUIMetadata.isContextNode
                        },
                        position: {
                            x: pos.x,
                            y: pos.y
                        }
                    });

                    if (!hasPosition) {
                        nodesWithoutPositions.push(nodeId);
                    }
                } else if (existingNode.length > 0) {
                    // Update existing node metadata (but NOT position)
                    existingNode.data('label', getNodeTitle(node));
                    existingNode.data('content', node.contentWithoutYamlOrLinks);
                    existingNode.data('summary', '');

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

                const currentEdges: EdgeCollection = cy.edges(`[source = "${nodeId}"]`);
                const currentTargets: Set<string> = new Set(currentEdges.map(edge => edge.data('target') as string));
                const desiredTargets: Set<string> = new Set(node.outgoingEdges.map(edge => edge.targetId));

                // Remove edges that are no longer in outgoingEdges
                // Keep edges to shadow nodes (UI-only nodes not tracked in graph model)
                currentEdges.forEach((edge) => {
                    const target: string = edge.data('target') as string;
                    if (!desiredTargets.has(target)) {
                        const targetNode: NodeSingular = cy.getElementById(target);
                        const isShadowNode: boolean = targetNode.length > 0 && targetNode.data('isShadowNode') === true;
                        if (isShadowNode) {
                            return;
                        }
                        edge.remove();
                    }
                });

                // Add edges for all outgoing connections (if they don't exist), and update labels
                node.outgoingEdges.forEach((edge) => {
                    const edgeId: string = `${nodeId}->${edge.targetId}`;
                    const existingEdge: CollectionReturnValue = cy.getElementById(edgeId);
                    const MAX_EDGE_LABEL_LENGTH: number = 50;
                    const newLabel: string | undefined = edge.label
                        ? edge.label.replace(/_/g, ' ').slice(0, MAX_EDGE_LABEL_LENGTH) + (edge.label.length > MAX_EDGE_LABEL_LENGTH ? '...' : '')
                        : undefined;

                    if (existingEdge.length > 0) {
                        existingEdge.data('label', newLabel);
                        return;
                    }

                    if (!currentTargets.has(edge.targetId)) {
                        const targetNode: CollectionReturnValue = cy.getElementById(edge.targetId);
                        if (targetNode.length > 0) {
                            cy.add({
                                group: 'edges' as const,
                                data: {
                                    id: edgeId,
                                    source: nodeId,
                                    target: edge.targetId,
                                    label: newLabel
                                }
                            });
                        }
                    }
                });
            }
        });
    });

    return { newNodeIds };
}
