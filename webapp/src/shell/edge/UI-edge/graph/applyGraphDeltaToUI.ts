import type {Core, NodeSingular, CollectionReturnValue} from "cytoscape";
import type {NodeIdAndFilePath} from "@vt/graph-model/pure/graph";
import type {EdgeElement, ElementSpec, NodeElement} from '@vt/graph-state'
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
import {hasActualContentChanged} from "@vt/graph-model/pure/graph/contentChangeDetection";
import {getNodeTitle} from "@vt/graph-model/pure/graph/markdown-parsing";

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

// Node IDs that should be auto-pinned when they appear in the next delta.
const pendingManualPinNodeIds: Set<string> = new Set();

export function requestAutoPinOnCreation(nodeId: string): void {
    pendingManualPinNodeIds.add(nodeId);
}

export interface ApplyGraphDeltaResult {
    newNodeIds: string[];
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
}

function getAgentNameFromNodeElement(node: NodeElement): string | undefined {
    const props: unknown = node.data['additionalYAMLProps']
    if (!Array.isArray(props)) return undefined
    for (const entry of props) {
        if (Array.isArray(entry) && entry.length === 2 && entry[0] === 'agent_name') {
            return asString(entry[1])
        }
    }
    return undefined
}

function nodeDisplayLabel(node: NodeElement): string {
    // Derive from markdown content when available — matches legacy getNodeTitle(node)
    // semantics (H1 / first-line fallback to filename).
    const content: string | undefined = asString(node.data['content'])
    if (typeof content === 'string') {
        const synthetic: { absoluteFilePathIsID: string; contentWithoutYamlOrLinks: string } = {
            absoluteFilePathIsID: node.id,
            contentWithoutYamlOrLinks: content,
        }
        // getNodeTitle reads absoluteFilePathIsID + contentWithoutYamlOrLinks only.
        const title: string = getNodeTitle(synthetic as never)
        if (title.length > 0) return title
    }
    if (typeof node.label === 'string' && node.label.length > 0) return node.label
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

function colorForNode(node: NodeElement): string | undefined {
    const frontmatter: string | undefined = asString(node.data['color'])
    if (frontmatter && isValidCSSColor(frontmatter)) return frontmatter
    return generateVaultColor(getVaultPrefixFromNodeId(node.id))
}

function isFolderSpecNode(node: NodeElement): boolean {
    return node.kind === 'folder' || node.kind === 'folder-collapsed'
}

function isContextSpecNode(node: NodeElement): boolean {
    return node.data['isContextNode'] === true
}

function getSpecNodeContent(node: NodeElement): string | undefined {
    return asString(node.data['content'])
}

function createTerminalIndicatorEdge(cy: Core, nodeId: string, agentName: string): void {
    const terminals: Map<string, import('@/shell/edge/UI-edge/floating-windows/types').TerminalData> = getTerminals()
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

/**
 * Apply an ElementSpec to the Cytoscape UI-edge.
 *
 * BF-L5-202b: `applyGraphDeltaToUI` is now a true projection-reconciler.
 * The spec comes from `project(state)` — the cytoscape representation is
 * reconciled to exactly match the spec (`projectionVsRendered.equal = true`),
 * with VoiceTree-specific post-reconcile side-effects preserved.
 */
export function applyGraphDeltaToUI(cy: Core, spec: ElementSpec): ApplyGraphDeltaResult {
    const specNodes: readonly NodeElement[] = spec.nodes
    const specEdges: readonly EdgeElement[] = spec.edges

    const specNodeIds: Set<string> = new Set(specNodes.map((node: NodeElement) => node.id))
    const specEdgeIds: Set<string> = new Set(specEdges.map((edge: EdgeElement) => edge.id))

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
            if (isContextSpecNode(specNode)) continue

            const existing: CollectionReturnValue = cy.getElementById(specNode.id)
            const isFolder: boolean = isFolderSpecNode(specNode)

            if (existing.length === 0) {
                const baseData: Record<string, unknown> = {
                    id: specNode.id,
                    ...(specNode.parent ? { parent: specNode.parent } : {}),
                }

                if (isFolder) {
                    const collapsed: boolean = specNode.kind === 'folder-collapsed'
                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            ...baseData,
                            isFolderNode: true,
                            folderLabel: asString(specNode.data['folderLabel']) ?? nodeDisplayLabel(specNode),
                            ...(collapsed
                                ? {
                                      collapsed: true,
                                      childCount: specNode.data['childCount'] ?? 0,
                                  }
                                : {}),
                        },
                    })
                    continue
                }

                // file-node
                newNodeIds.push(specNode.id)
                const agentName: string | undefined = getAgentNameFromNodeElement(specNode)
                if (agentName) agentNameByNewNodeId.set(specNode.id, agentName)

                const content: string | undefined = getSpecNodeContent(specNode)
                const color: string | undefined = colorForNode(specNode)
                const position: { x: number; y: number } = specNode.position
                    ? { x: specNode.position.x, y: specNode.position.y }
                    : { x: 0, y: 0 }
                const hasPosition: boolean = specNode.position !== undefined

                cy.add({
                    group: 'nodes' as const,
                    data: {
                        ...baseData,
                        label: nodeDisplayLabel(specNode),
                        content: content ?? '',
                        summary: '',
                        color,
                        isContextNode: false,
                    },
                    position,
                    ...(specNode.classes ? { classes: [...specNode.classes].join(' ') } : {}),
                })

                if (!hasPosition) nodesWithoutPositions.push(specNode.id)
                continue
            }

            if (isFolder) {
                const collapsed: boolean = specNode.kind === 'folder-collapsed'
                existing.data('isFolderNode', true)
                existing.data(
                    'folderLabel',
                    asString(specNode.data['folderLabel']) ?? nodeDisplayLabel(specNode),
                )
                if (collapsed) {
                    existing.data('collapsed', true)
                    existing.data('childCount', specNode.data['childCount'] ?? 0)
                } else {
                    if (existing.data('collapsed')) existing.removeData('collapsed')
                    if (existing.data('childCount') !== undefined) existing.removeData('childCount')
                }
                continue
            }

            // file-node update path — preserve the previous content-changed
            // animation trigger by comparing existing cy data vs spec content.
            const previousContent: string = (existing.data('content') as string | undefined) ?? ''
            const nextContent: string = getSpecNodeContent(specNode) ?? ''
            existing.data('label', nodeDisplayLabel(specNode))
            existing.data('content', nextContent)
            existing.data('summary', '')
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
                ...specEdge.data,
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
