import type {Core, NodeSingular, CollectionReturnValue, EdgeCollection} from "cytoscape";
import type {GraphDelta, GraphNode, NodeIdAndFilePath} from "@vt/graph-model/pure/graph";
import * as O from 'fp-ts/lib/Option.js';
import {getNodeTitle} from "@vt/graph-model/pure/graph/markdown-parsing";
import {hasActualContentChanged} from "@vt/graph-model/pure/graph/contentChangeDetection";
import posthog from "posthog-js";
import {markTerminalActivityForContextNode} from "@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity";
import type {} from '@/utils/types/cytoscape-layout-utilities';
import {checkEngagementPrompts} from "./userEngagementPrompts";
import {setPendingPan, setPendingPanToNode} from "@/shell/edge/UI-edge/state/PendingPanStore";
import {scheduleIdleWork} from "@/utils/scheduleIdleWork";
import {syncLargeGraphPerformanceMode} from "@/shell/UI/cytoscape-graph-ui/services/largegraphPerformance";
import {getTerminals} from "@/shell/edge/UI-edge/state/TerminalStore";
import {getShadowNodeId, getTerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import {createAnchoredFloatingEditor} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import { absolutePathToGraphFolderId, getFolderParent } from '@vt/graph-model/pure/graph/folderCollapse'
import { addOrUpdateSyntheticEdge } from '@/shell/edge/UI-edge/graph/folderCollapse'
import { findCollapsedAncestor } from '@vt/graph-model/pure/graph/folderCollapse'
import { addCollapsedFolder, getFolderTreeState } from '@/shell/edge/UI-edge/state/FolderTreeStore'
import { getVaultState } from '@/shell/edge/UI-edge/state/VaultPathStore'

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

// Node IDs that should be auto-pinned when they appear in the next delta.
// Set by manual UI node creation (Cmd+N, radial menu "Add Child", etc.)
// so the newly created node opens in edit mode. Consumed on match.
const pendingManualPinNodeIds: Set<string> = new Set();

/**
 * Request that a node be auto-pinned (opened as editor) when it next
 * appears as a new node in applyGraphDeltaToUI. Call BEFORE the IPC
 * that creates the node, so the pending pin is ready when the delta arrives.
 */
export function requestAutoPinOnCreation(nodeId: string): void {
    pendingManualPinNodeIds.add(nodeId);
}

export interface ApplyGraphDeltaResult {
    newNodeIds: string[];
}

function getDeltaFallbackRoot(cy: Core, delta: GraphDelta): string | null {
    const absoluteNodeIds: string[] = [
        ...cy.nodes()
            .filter((node: NodeSingular) => !node.data('isFolderNode') && !node.data('isShadowNode'))
            .map((node: NodeSingular) => node.id()),
        ...delta
            .filter((nodeDelta): nodeDelta is Extract<GraphDelta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
            .map((nodeDelta) => nodeDelta.nodeToUpsert.absoluteFilePathIsID)
    ].filter((nodeId: string) => nodeId.startsWith('/'))

    if (absoluteNodeIds.length === 0) return null

    let prefix: string = absoluteNodeIds[0]
    for (const nodeId of absoluteNodeIds.slice(1)) {
        let nextPrefixLength: number = 0
        const maxLength: number = Math.min(prefix.length, nodeId.length)
        while (nextPrefixLength < maxLength && prefix[nextPrefixLength] === nodeId[nextPrefixLength]) {
            nextPrefixLength += 1
        }
        prefix = prefix.slice(0, nextPrefixLength)
        if (prefix.length === 0) return null
    }

    const lastSlash: number = prefix.lastIndexOf('/')
    if (lastSlash <= 0) return null

    return prefix.slice(0, lastSlash)
}

function getLoadedRootForNodeId(nodeId: string, fallbackRoot: string | null): string | null {
    const { writePath, readPaths } = getVaultState()
    const loadedRoots: string[] = [writePath, ...readPaths]
        .filter((root: string | null): root is string => !!root)
        .sort((left: string, right: string) => right.length - left.length)

    const storeRoot: string | undefined = loadedRoots.find((root: string) =>
        nodeId === root || nodeId.startsWith(`${root}/`)
    )
    if (storeRoot) return storeRoot

    if (fallbackRoot && (nodeId === fallbackRoot || nodeId.startsWith(`${fallbackRoot}/`))) {
        return fallbackRoot
    }

    return null
}

function getFolderChainForNodeId(nodeId: string, fallbackRoot: string | null): string[] {
    const folderPath: string | null = getFolderParent(nodeId)
    if (!folderPath) return []

    const loadedRoot: string | null = getLoadedRootForNodeId(nodeId, fallbackRoot)
    if (!loadedRoot) return [folderPath]

    const chain: string[] = []
    let currentPath: string = folderPath.replace(/\/$/, '')

    while (currentPath) {
        const graphFolderId: string | null = absolutePathToGraphFolderId(currentPath, loadedRoot)
        if (!graphFolderId) break
        chain.push(graphFolderId)

        const parentPath: string | null = getFolderParent(currentPath)
        if (!parentPath) break
        currentPath = parentPath.replace(/\/$/, '')
    }

    return chain.reverse()
}

function getProjectedDirectChildCounts(cy: Core, delta: GraphDelta, fallbackRoot: string | null): Map<string, number> {
    const projectedFileNodeIds: Set<string> = new Set(
        cy.nodes()
            .filter((node: NodeSingular) => !node.data('isFolderNode') && !node.data('isShadowNode'))
            .map((node: NodeSingular) => node.id())
    )
    const projectedFolderIds: Set<string> = new Set(
        cy.nodes()
            .filter((node: NodeSingular) => node.data('isFolderNode'))
            .map((node: NodeSingular) => node.id())
    )

    delta.forEach(nodeDelta => {
        if (nodeDelta.type === 'UpsertNode') {
            const node: GraphNode = nodeDelta.nodeToUpsert
            if (node.nodeUIMetadata.isContextNode === true) return

            projectedFileNodeIds.add(node.absoluteFilePathIsID)
            getFolderChainForNodeId(node.absoluteFilePathIsID, fallbackRoot).forEach((folderId: string) => {
                projectedFolderIds.add(folderId)
            })
            return
        }

        const nodeId: string = nodeDelta.nodeId
        projectedFileNodeIds.delete(nodeId)
    })

    const counts: Map<string, number> = new Map()
    const increment = (folderId: string): void => {
        counts.set(folderId, (counts.get(folderId) ?? 0) + 1)
    }

    projectedFileNodeIds.forEach((nodeId: string) => {
        const folderId: string | null = getFolderParent(nodeId)
        if (folderId) increment(folderId)
    })

    projectedFolderIds.forEach((folderId: string) => {
        const parentFolderId: string | null = getFolderParent(folderId.slice(0, -1))
        if (parentFolderId) increment(parentFolderId)
    })

    return counts
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
    const fallbackRoot: string | null = getDeltaFallbackRoot(cy, delta)
    const projectedDirectChildCounts: Map<string, number> = getProjectedDirectChildCounts(cy, delta, fallbackRoot)
    const pendingAutoCollapsedFolders: Set<string> = new Set()

    const getCollapsedFoldersSnapshot = (): Set<string> =>
        new Set([
            ...getFolderTreeState().graphCollapsedFolders,
            ...pendingAutoCollapsedFolders
        ])

    const ensureFolderChain = (nodeId: string): string | null => {
        const folderChain: string[] = getFolderChainForNodeId(nodeId, fallbackRoot)
        if (folderChain.length === 0) return null

        folderChain.forEach((folderId: string, index: number) => {
            if (cy.getElementById(folderId).length > 0) return

            const parentFolder: string | undefined = index > 0 ? folderChain[index - 1] : undefined
            const shouldAutoCollapse: boolean = parentFolder !== undefined && !getCollapsedFoldersSnapshot().has(folderId)

            if (shouldAutoCollapse) pendingAutoCollapsedFolders.add(folderId)

            const isCollapsed: boolean = getCollapsedFoldersSnapshot().has(folderId)
            cy.add({
                group: 'nodes' as const,
                data: {
                    id: folderId,
                    folderLabel: folderId.replace(/\/$/, '').split('/').pop()!,
                    isFolderNode: true,
                    parent: parentFolder,
                    ...(isCollapsed ? {
                        collapsed: true,
                        childCount: projectedDirectChildCounts.get(folderId) ?? 0
                    } : {})
                }
            })
        })

        return folderChain[folderChain.length - 1]
    }

    cy.batch(() => {
        // PASS 1: Create/update all nodes and handle deletions
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node: GraphNode = nodeDelta.nodeToUpsert;
                const nodeId: string = node.absoluteFilePathIsID;

                const existingNode: CollectionReturnValue = cy.getElementById(nodeId);
                const isNewNode: boolean = existingNode.length === 0;

                if (isNewNode) {
                    // Skip adding context nodes to cytoscape entirely — they're only needed on disk for agents
                    if (node.nodeUIMetadata.isContextNode === true) return;

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

                    // Lazily create the full folder chain within the loaded root.
                    const folderPath: string | null = ensureFolderChain(nodeId);

                    // Skip adding nodes inside any collapsed ancestor folder.
                    if (findCollapsedAncestor(nodeId, getCollapsedFoldersSnapshot())) {
                        return;
                    }

                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            id: nodeId,
                            label: getNodeTitle(node),
                            content: node.contentWithoutYamlOrLinks,
                            summary: '',
                            color: colorValue,
                            isContextNode: !!node.nodeUIMetadata.isContextNode,
                            parent: folderPath ?? undefined
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
                // Remove parent folder compound if now empty
                const folderPath: string | null = getFolderParent(nodeId);
                if (folderPath) {
                    const folder: CollectionReturnValue = cy.getElementById(folderPath);
                    if (folder.length > 0 && folder.data('isFolderNode') && folder.children().length === 0 && !folder.data('collapsed')) {
                        folder.remove();
                    }
                }
            }
        });

        // PASS 2: Sync edges for each node (add missing, remove stale)
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node: GraphNode = nodeDelta.nodeToUpsert;
                const nodeId: string = node.absoluteFilePathIsID;

                // Handle nodes inside collapsed folders — create synthetic edges instead
                if (!cy.getElementById(nodeId).length) {
                    const collapsedFolder: string | null = findCollapsedAncestor(nodeId, getCollapsedFoldersSnapshot())
                    if (collapsedFolder) {
                        node.outgoingEdges.forEach((edge) => {
                            const MAX_EDGE_LABEL_LENGTH: number = 50
                            const newLabel: string | undefined = edge.label
                                ? edge.label.replace(/_/g, ' ').slice(0, MAX_EDGE_LABEL_LENGTH) + (edge.label.length > MAX_EDGE_LABEL_LENGTH ? '…' : '')
                                : undefined
                            if (cy.getElementById(edge.targetId).length > 0) {
                                addOrUpdateSyntheticEdge(cy, collapsedFolder, 'outgoing', edge.targetId, {
                                    sourceId: nodeId, targetId: edge.targetId, label: newLabel
                                })
                            } else {
                                // Target might be in another collapsed folder (S8: cross-folder)
                                const targetFolder: string | null = findCollapsedAncestor(edge.targetId, getCollapsedFoldersSnapshot())
                                if (targetFolder && targetFolder !== collapsedFolder) {
                                    addOrUpdateSyntheticEdge(cy, collapsedFolder, 'outgoing', targetFolder, {
                                        sourceId: nodeId, targetId: edge.targetId, label: newLabel
                                    })
                                }
                            }
                        })
                    }
                    return
                }

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
                        if (isShadowNode || edge.data('isSyntheticEdge')) {
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
                            // Target missing — check if inside a collapsed folder
                            const collapsedFolder: string | null = findCollapsedAncestor(edge.targetId, getCollapsedFoldersSnapshot())
                            if (collapsedFolder) {
                                addOrUpdateSyntheticEdge(cy, collapsedFolder, 'incoming', nodeId, {
                                    sourceId: nodeId, targetId: edge.targetId, label: newLabel
                                })
                            }
                        }
                    }
                });
            }
        });
    });

    pendingAutoCollapsedFolders.forEach((folderId: string) => {
        addCollapsedFolder(folderId)
    })


    const newNodeCount: number = newNodeIds.length;
    const totalNodes: number = cy.nodes().length;
    syncLargeGraphPerformanceMode(cy);
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
    else if (newNodeCount >= 1) {
        // Only pan to user-created nodes (Cmd+N, button click) — agent/FS/voice nodes are distracting.
        // If an editor is focused, the editor-focus pan in onLayoutComplete handles viewport stability.
        const userCreatedNodeId: string | undefined = newNodeIds.find(id => pendingManualPinNodeIds.has(id));
        if (userCreatedNodeId) {
            setPendingPanToNode(userCreatedNodeId);
        }
    }
    //console.log('[applyGraphDeltaToUI] Complete. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);

    // Auto-pin nodes explicitly requested by manual UI creation (Cmd+N, radial menu, etc.)
    // Only pins nodes registered via requestAutoPinOnCreation() — never bulk/agent/FS-watcher nodes.
    for (const nodeId of newNodeIds) {
        if (pendingManualPinNodeIds.has(nodeId)) {
            pendingManualPinNodeIds.delete(nodeId);
            void createAnchoredFloatingEditor(cy, nodeId as NodeIdAndFilePath, true, true);
            break;
        }
    }

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
