import type {Core, NodeSingular, CollectionReturnValue} from "cytoscape";
import type {NodeIdAndFilePath} from "@vt/graph-model/graph";
import type {ProjectedEdge, ProjectedGraph, ProjectedNode} from '@vt/graph-state/contract'
import posthog from "posthog-js";
import {markTerminalActivityForContextNode} from "@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity";
import type {} from '@/utils/types/cytoscape-layout-utilities';
import {checkEngagementPrompts} from "@/shell/edge/UI-edge/graph/popups/userEngagementPrompts";
import {setPendingPan, setPendingPanToNode} from "@/shell/edge/UI-edge/state/stores/PendingPanStore";
import {scheduleIdleWork} from "@/utils/scheduleIdleWork";
import {syncLargeGraphPerformanceMode} from "@/shell/UI/cytoscape-graph-ui/services/animation/largegraphPerformance";
import {getTerminals} from "@/shell/edge/UI-edge/state/stores/TerminalStore";
import {getShadowNodeId, getTerminalId} from "@/shell/edge/UI-edge/floating-windows/anchoring/types";
import {createAnchoredFloatingEditor} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {hasActualContentChanged} from "@vt/graph-model/graph";
import {getNodeTitle} from "@vt/graph-model/pure/graph/markdown-parsing";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import * as O from "fp-ts/lib/Option.js";
import {anchorToNode} from "@/shell/edge/UI-edge/floating-windows/anchoring/anchor-to-node";
import {getCurrentIndex} from "@/shell/UI/cytoscape-graph-ui/services/layout/spatialIndexSync";

function isValidCSSColor(color: string): boolean {
    if (!color) return false;
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
    return CSS.supports('color', color);
}

function getVaultPrefixFromNodeId(nodeId: string): string {
    const firstSlash: number = nodeId.indexOf('/');
    if (firstSlash === -1) return '';
    return nodeId.slice(0, firstSlash);
}

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

// Node IDs that should be auto-pinned when they appear in the next delta.
const pendingManualPinNodeIds: Set<string> = new Set();

export function requestAutoPinOnCreation(nodeId: string): void {
    pendingManualPinNodeIds.add(nodeId);
}

export interface ApplyGraphDeltaResult {
    newNodeIds: string[];
}

function getAgentNameFromNode(node: ProjectedNode): string | undefined {
    const props: ProjectedNode['additionalYAMLProps'] = node.additionalYAMLProps
    if (!props) return undefined
    for (const entry of props) {
        if (entry[0] === 'agent_name') return entry[1]
    }
    return undefined
}

function nodeDisplayLabel(node: ProjectedNode): string {
    const content: string = node.content ?? ''
    if (content.length > 0) {
        const synthetic: { absoluteFilePathIsID: string; contentWithoutYamlOrLinks: string } = {
            absoluteFilePathIsID: node.id,
            contentWithoutYamlOrLinks: content,
        }
        const title: string = getNodeTitle(synthetic as never)
        if (title.length > 0) return title
    }
    if ((node.label ?? '').length > 0) return node.label
    const lastSlash: number = node.id.lastIndexOf('/')
    const tail: string = lastSlash >= 0 ? node.id.slice(lastSlash + 1) : node.id
    const dot: number = tail.lastIndexOf('.')
    return dot > 0 ? tail.slice(0, dot) : tail
}

const MAX_EDGE_LABEL_LENGTH: number = 50;

function truncatedEdgeLabel(label: string | undefined): string | undefined {
    if (!label) return undefined
    const clean: string = label.replace(/_/g, ' ')
    return clean.slice(0, MAX_EDGE_LABEL_LENGTH)
        + (clean.length > MAX_EDGE_LABEL_LENGTH ? '…' : '')
}

function colorForNode(node: ProjectedNode): string | undefined {
    if (node.color && isValidCSSColor(node.color)) return node.color
    return generateVaultColor(getVaultPrefixFromNodeId(node.id))
}

function isFolderNode(node: ProjectedNode): boolean {
    return node.kind === 'folder' || node.kind === 'folder-collapsed'
}

function isContextNode(node: ProjectedNode): boolean {
    return node.isContextNode === true
}

function syncExistingNodeParent(existing: CollectionReturnValue, specNode: ProjectedNode): void {
    const nextParent: string | null = specNode.parent ?? null
    const currentParent = existing.parent()
    const currentParentId: string | null = currentParent.length > 0 ? currentParent.id() : null
    if (currentParentId !== nextParent) existing.move({ parent: nextParent })
    if (nextParent === null) {
        existing.removeData('parent')
    } else {
        existing.data('parent', nextParent)
    }
}

function createTerminalIndicatorEdge(cy: Core, nodeId: string, agentName: string): void {
    const terminals: Map<string, import('@/shell/edge/UI-edge/floating-windows/anchoring/types').TerminalData> = getTerminals()
    for (const terminal of terminals.values()) {
        if (terminal.agentName !== agentName) continue
        const shadowNodeId: string = getShadowNodeId(getTerminalId(terminal))
        const shadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId)
        if (shadowNode.length === 0) continue
        const edgeId: string = `terminal-progress-${shadowNodeId}->${nodeId}`
        if (cy.getElementById(edgeId).length > 0) break
        cy.add({
            group: 'edges' as const,
            data: {
                id: edgeId,
                source: shadowNodeId,
                target: nodeId,
                isIndicatorEdge: true,
            },
            classes: 'terminal-progres-nodes-indicator',
        })
        break
    }
}

function repairTerminalAnchorsForNode(cy: Core, nodeId: string): void {
    for (const terminal of getTerminals().values()) {
        if (!terminal.ui || !O.isSome(terminal.anchoredToNodeId)) continue
        if (terminal.anchoredToNodeId.value !== nodeId) continue

        const shadowNodeId: string = getShadowNodeId(getTerminalId(terminal))
        const edgeId: string = `edge-${nodeId}-${shadowNodeId}`
        const shadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId)
        const hasAnchorEdge: boolean = cy.getElementById(edgeId).length > 0
        if (shadowNode.length > 0 && hasAnchorEdge) continue

        if (shadowNode.length > 0) shadowNode.remove()
        anchorToNode(cy, terminal as TerminalData, getCurrentIndex(cy))
        cy.getElementById(nodeId).data('hasRunningTerminal', true)
    }
}

function syncFolderNodeInteractivity(folder: CollectionReturnValue, collapsed: boolean): void {
    if (collapsed) {
        if (!folder.grabbable()) folder.grabify()
        if (!folder.selectable()) folder.selectify()
        return
    }

    if (folder.grabbable()) folder.ungrabify()
    if (folder.selectable()) folder.unselectify()
    if (folder.selected()) folder.unselect()
}

function addFolderNode(
    cy: Core,
    specNode: ProjectedNode,
    baseData: Record<string, unknown>,
): void {
    const collapsed: boolean = specNode.kind === 'folder-collapsed'
    const addedFolder = cy.add({
        group: 'nodes' as const,
        data: {
            ...baseData,
            content: specNode.content ?? '',
            isFolderNode: true,
            folderLabel: specNode.label ?? nodeDisplayLabel(specNode),
            ...(collapsed
                ? {
                      collapsed: true,
                      childCount: specNode.childCount ?? 0,
                  }
                : {}),
        },
    })
    syncFolderNodeInteractivity(addedFolder, collapsed)
}

function updateFolderNode(existing: CollectionReturnValue, specNode: ProjectedNode): void {
    const collapsed: boolean = specNode.kind === 'folder-collapsed'
    existing.data('isFolderNode', true)
    existing.data('folderLabel', specNode.label ?? nodeDisplayLabel(specNode))
    existing.data('content', specNode.content ?? '')
    if (collapsed) {
        existing.data('collapsed', true)
        existing.data('childCount', specNode.childCount ?? 0)
    } else {
        if (existing.data('collapsed')) existing.removeData('collapsed')
        if (existing.data('childCount') !== undefined) existing.removeData('childCount')
    }
    syncFolderNodeInteractivity(existing, collapsed)
}

export function applyGraphDeltaToUI(cy: Core, graph: ProjectedGraph): ApplyGraphDeltaResult {
    const specNodes: readonly ProjectedNode[] = graph.nodes
    const specNodeIds: Set<string> = new Set(specNodes.map((node: ProjectedNode) => node.id))
    const specEdges: readonly ProjectedEdge[] = graph.edges
    const specEdgeIds: Set<string> = new Set(specEdges.map((edge: ProjectedEdge) => edge.id))

    const newNodeIds: string[] = []
    const nodesWithoutPositions: string[] = []
    const agentNameByNewNodeId: Map<string, string> = new Map()

    cy.batch(() => {
        // PASS 1 — remove cy nodes no longer in spec
        // Skip shadow nodes (floating-window-only) and context nodes cy never
        // owned them under the previous path either.
        cy.nodes().forEach((node: NodeSingular) => {
            if (specNodeIds.has(node.id())) return
            if (node.data('isShadowNode') === true) return
            node.remove()
        })

        // PASS 2 — remove cy edges no longer in spec
        // Keep: indicator edges (terminal→node, floating-window glue), and any
        // edge whose source OR target is a shadow node (floating-window UI).
        cy.edges().forEach((edge) => {
            if (specEdgeIds.has(edge.id())) return
            if (edge.data('isIndicatorEdge') === true) return
            const source: CollectionReturnValue = cy.getElementById(edge.data('source') as string)
            const target: CollectionReturnValue = cy.getElementById(edge.data('target') as string)
            const sourceIsShadow: boolean = source.length > 0 && source.data('isShadowNode') === true
            const targetIsShadow: boolean = target.length > 0 && target.data('isShadowNode') === true
            if (sourceIsShadow || targetIsShadow) return
            edge.remove()
        })

        // PASS 3 — add/update nodes from spec
        for (const specNode of specNodes) {
            if (isContextNode(specNode)) continue

            const existing: CollectionReturnValue = cy.getElementById(specNode.id)
            const isFolder: boolean = isFolderNode(specNode)

            if (existing.length === 0) {
                const baseData: Record<string, unknown> = {
                    id: specNode.id,
                    ...(specNode.parent ? { parent: specNode.parent } : {}),
                }

                if (isFolder) {
                    addFolderNode(cy, specNode, baseData)
                    continue
                }

                // file-node
                newNodeIds.push(specNode.id)
                const agentName: string | undefined = getAgentNameFromNode(specNode)
                if (agentName) agentNameByNewNodeId.set(specNode.id, agentName)

                const color: string | undefined = colorForNode(specNode)
                const position: { x: number; y: number } = specNode.position
                    ? { x: specNode.position.x, y: specNode.position.y }
                    : { x: 0, y: 0 }
                const hasPosition: boolean = specNode.position !== undefined
                const classes: string[] = [
                    ...(specNode.classes ? [...specNode.classes] : []),
                    ...(hasPosition ? ['vt-has-graph-position'] : []),
                ]

                cy.add({
                    group: 'nodes' as const,
                    data: {
                        ...baseData,
                        label: nodeDisplayLabel(specNode),
                        content: specNode.content ?? '',
                        summary: '',
                        color,
                        isContextNode: false,
                    },
                    position,
                    ...(classes.length > 0 ? { classes: classes.join(' ') } : {}),
                })

                if (!hasPosition) nodesWithoutPositions.push(specNode.id)
                continue
            }

            syncExistingNodeParent(existing, specNode)

            if (isFolder) {
                updateFolderNode(existing, specNode)
                continue
            }

            // file-node update path — preserve the previous content-changed
            // animation trigger by comparing existing cy data vs spec content.
            const previousContent: string = (existing.data('content') as string | undefined) ?? ''
            const nextContent: string = specNode.content ?? ''
            existing.data('label', nodeDisplayLabel(specNode))
            existing.data('content', nextContent)
            existing.data('summary', '')
            existing.toggleClass('vt-has-graph-position', specNode.position !== undefined)
            const nextColor: string | undefined = colorForNode(specNode)
            if (nextColor === undefined) {
                existing.removeData('color')
            } else {
                existing.data('color', nextColor)
            }
            existing.data('isContextNode', false)
            if (hasActualContentChanged(previousContent, nextContent)) {
                existing.emit('content-changed')
            }
        }

        // PASS 4 — add edges from spec (data-driven)
        for (const specEdge of specEdges) {
            if (cy.getElementById(specEdge.id).length > 0) {
                const existing: CollectionReturnValue = cy.getElementById(specEdge.id)
                existing.data('label', truncatedEdgeLabel(specEdge.label))
                existing.data('kind', specEdge.kind)
                if (specEdge.kind === 'synthetic') {
                    existing.data('isSyntheticEdge', true)
                } else {
                    existing.removeData('isSyntheticEdge')
                }
                if (specEdge.edgeCount !== undefined) {
                    existing.data('edgeCount', specEdge.edgeCount)
                } else {
                    existing.removeData('edgeCount')
                }
                existing.classes(specEdge.classes ? [...specEdge.classes].join(' ') : '')
                continue
            }
            const sourceExists: boolean = cy.getElementById(specEdge.source).length > 0
            const targetExists: boolean = cy.getElementById(specEdge.target).length > 0
            if (!sourceExists || !targetExists) continue

            const edgeData: Record<string, unknown> = {
                id: specEdge.id,
                source: specEdge.source,
                target: specEdge.target,
                label: truncatedEdgeLabel(specEdge.label),
                kind: specEdge.kind,
                ...(specEdge.kind === 'synthetic' ? { isSyntheticEdge: true } : {}),
                ...(specEdge.edgeCount !== undefined ? { edgeCount: specEdge.edgeCount } : {}),
            }
            cy.add({
                group: 'edges' as const,
                data: edgeData,
                ...(specEdge.classes ? { classes: [...specEdge.classes].join(' ') } : {}),
            })

            if (specEdge.kind === 'real') {
                const sourceId: string = specEdge.source
                const targetId: string = specEdge.target
                scheduleIdleWork(() => {
                    markTerminalActivityForContextNode(sourceId)
                    markTerminalActivityForContextNode(targetId)
                }, 500)
            }
        }
    })

    // POST-RECONCILE SIDE-EFFECTS — preserved from the legacy delta path
    for (const nodeId of newNodeIds) {
        repairTerminalAnchorsForNode(cy, nodeId)
    }

    // Terminal→node indicator edges driven by agent_name YAML on new nodes.
    for (const [nodeId, agentName] of agentNameByNewNodeId) {
        createTerminalIndicatorEdge(cy, nodeId, agentName)
    }

    // Pan / performance / engagement — unchanged semantics from legacy path.
    const newNodeCount: number = newNodeIds.length
    const totalNodes: number = cy.nodes().length
    syncLargeGraphPerformanceMode(cy)
    const changeRatio: number = totalNodes > 0 ? newNodeCount / totalNodes : 1

    if (changeRatio > 0.3) {
        setPendingPan('large-batch', newNodeIds, totalNodes)
    } else if (newNodeCount >= 1 && totalNodes <= 4) {
        setPendingPan('small-graph', newNodeIds, totalNodes)
    } else if (newNodeCount >= 1) {
        const userCreatedNodeId: string | undefined = newNodeIds.find(id =>
            pendingManualPinNodeIds.has(id),
        )
        if (userCreatedNodeId) setPendingPanToNode(userCreatedNodeId)
    }

    // Auto-pin nodes explicitly requested by manual UI creation (Cmd+N, radial
    // menu). Only pins nodes registered via requestAutoPinOnCreation().
    for (const nodeId of newNodeIds) {
        if (pendingManualPinNodeIds.has(nodeId)) {
            pendingManualPinNodeIds.delete(nodeId)
            void createAnchoredFloatingEditor(cy, nodeId as NodeIdAndFilePath, true, true)
            break
        }
    }

    scheduleIdleWork(() => {
        posthog.capture('graphDelta')
        if (newNodeCount) checkEngagementPrompts()
    }, 2000)

    void nodesWithoutPositions // retained for future use; placeNewNodes runs elsewhere

    return { newNodeIds }
}
