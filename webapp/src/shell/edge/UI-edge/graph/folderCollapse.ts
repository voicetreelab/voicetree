import type { Core, CollectionReturnValue } from 'cytoscape'
import type { Graph, GraphNode } from '@vt/graph-model/pure/graph'
import type { Position } from '@vt/graph-model/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import { getFolderChildNodeIds, getSubFolderPaths, getFolderParent } from '@vt/graph-model/pure/graph/folderCollapse'
import { getNodeTitle } from '@vt/graph-model/pure/graph/markdown-parsing'
import type {} from '@/shell/electron'
import { syncGraphCollapsedFolders } from '@/shell/edge/UI-edge/state/FolderTreeStore'

// ── Ephemeral UI state ──
const collapsedFolders: Set<string> = new Set()
const expandingFolders: Set<string> = new Set() // H1 guard: prevents collapse during async expand

// ── Synthetic edge tracking ──
interface OriginalEdge {
    sourceId: string
    targetId: string
    label?: string
}

interface SyntheticEdgeRecord {
    syntheticEdgeId: string
    direction: 'incoming' | 'outgoing'
    externalNodeId: string
    originalEdges: OriginalEdge[]
}

const syntheticEdgeRegistry: Map<string, SyntheticEdgeRecord[]> = new Map<string, SyntheticEdgeRecord[]>()

export const isFolderCollapsed: (folderId: string) => boolean = (folderId) =>
    collapsedFolders.has(folderId)

// ── Collapse ──
export function collapseFolder(cy: Core, folderId: string): void {
    if (expandingFolders.has(folderId)) return // H1: skip if expand is in-flight
    const folder: CollectionReturnValue = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return

    collapsedFolders.add(folderId)
    folder.data('collapsed', true)

    // Count children before removing (for badge)
    const childCount: number = folder.children().length
    folder.data('childCount', childCount)

    // Compute synthetic edges BEFORE removing children (D1: scan Cytoscape state)
    const synthetics: SyntheticEdgeRecord[] = computeSyntheticEdges(cy, folderId)

    cy.batch(() => {
        // Create synthetic edges for cross-boundary connections
        for (const rec of synthetics) {
            const [source, target]: [string, string] = rec.direction === 'incoming'
                ? [rec.externalNodeId, folderId] : [folderId, rec.externalNodeId]
            cy.add({
                group: 'edges' as const,
                data: {
                    id: rec.syntheticEdgeId,
                    source,
                    target,
                    isSyntheticEdge: true,
                    edgeCount: rec.originalEdges.length > 1 ? rec.originalEdges.length : undefined,
                    label: rec.originalEdges.length === 1 ? rec.originalEdges[0].label : undefined
                },
                classes: 'synthetic-folder-edge'
            })
        }
        syntheticEdgeRegistry.set(folderId, synthetics)

        // Remove all children (nodes + connected edges removed automatically)
        // Also removes nested sub-folder compound nodes
        folder.children().remove()
    })

    syncGraphCollapsedFolders(new Set(collapsedFolders))
}

// ── Expand ──
export async function expandFolder(cy: Core, folderId: string): Promise<void> {
    const folder: CollectionReturnValue = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return
    if (expandingFolders.has(folderId)) return // H1: already expanding

    expandingFolders.add(folderId) // H1: mark as expanding

    collapsedFolders.delete(folderId)
    folder.data('collapsed', false)
    folder.removeData('childCount')

    syncGraphCollapsedFolders(new Set(collapsedFolders))

    // Re-derive children from Graph (source of truth)
    let graph: Graph | undefined
    try {
        graph = await window.electronAPI?.main.getGraph()
    } catch {
        // M3: rollback state on IPC failure
        collapsedFolders.add(folderId)
        folder.data('collapsed', true)
        syncGraphCollapsedFolders(new Set(collapsedFolders))
        expandingFolders.delete(folderId)
        return
    }
    if (!graph) {
        expandingFolders.delete(folderId)
        return
    }

    const childIds: readonly string[] = getFolderChildNodeIds(graph.nodes, folderId)
    const subFolders: readonly string[] = getSubFolderPaths(graph.nodes, folderId)

    cy.batch(() => {
        // Remove synthetic edges for this folder
        const oldSynthetics: SyntheticEdgeRecord[] | undefined = syntheticEdgeRegistry.get(folderId)
        if (oldSynthetics) {
            for (const rec of oldSynthetics) {
                cy.getElementById(rec.syntheticEdgeId).remove()
            }
            syntheticEdgeRegistry.delete(folderId)
        }

        // Re-create sub-folder compound nodes
        for (const sf of subFolders) {
            if (!cy.getElementById(sf).length) {
                cy.add({
                    group: 'nodes' as const,
                    data: {
                        id: sf,
                        folderLabel: sf.replace(/\/$/, '').split('/').pop()!,
                        isFolderNode: true,
                        parent: folderId
                    }
                })
            }
        }

        // Re-create child nodes from Graph data
        for (const nodeId of childIds) {
            if (cy.getElementById(nodeId).length) continue  // already exists
            const node: GraphNode = graph.nodes[nodeId]

            const pos: Position = O.getOrElse(() => ({ x: 0, y: 0 }))(node.nodeUIMetadata.position)
            const colorValue: string | undefined = O.isSome(node.nodeUIMetadata.color)
                ? node.nodeUIMetadata.color.value : undefined
            const folderPath: string | null = getFolderParent(nodeId)

            cy.add({
                group: 'nodes' as const,
                data: {
                    id: nodeId,
                    label: getNodeTitle(node),
                    content: node.contentWithoutYamlOrLinks,
                    summary: '',
                    color: colorValue,
                    isContextNode: false,
                    parent: folderPath ?? undefined
                },
                position: { x: pos.x, y: pos.y }
            })
        }

        // Re-create edges from Graph data
        for (const nodeId of childIds) {
            const node: GraphNode = graph.nodes[nodeId]
            for (const edge of node.outgoingEdges) {
                const edgeId: string = `${nodeId}->${edge.targetId}`
                if (cy.getElementById(edgeId).length) continue
                if (!cy.getElementById(edge.targetId).length) {
                    const targetCollapsedFolder: string | null = findCollapsedAncestorFolder(edge.targetId)
                    if (targetCollapsedFolder) {
                        addOrUpdateSyntheticEdge(cy, targetCollapsedFolder, 'incoming', nodeId, {
                            sourceId: nodeId, targetId: edge.targetId, label: edge.label ?? undefined
                        })
                    }
                    continue
                }
                cy.add({
                    group: 'edges' as const,
                    data: {
                        id: edgeId,
                        source: nodeId,
                        target: edge.targetId,
                        label: edge.label ?? undefined
                    }
                })
            }
            // Also restore incoming edges from visible nodes
            for (const incomingId of (graph.incomingEdgesIndex.get(nodeId) ?? [])) {
                if (!cy.getElementById(incomingId).length) {
                    const srcCollapsedFolder: string | null = findCollapsedAncestorFolder(incomingId)
                    if (srcCollapsedFolder) {
                        const srcNodeForEdge: GraphNode | undefined = graph.nodes[incomingId]
                        const edgeDataForSynthetic: { readonly targetId: string; readonly label: string } | undefined = srcNodeForEdge?.outgoingEdges.find(e => e.targetId === nodeId)
                        addOrUpdateSyntheticEdge(cy, srcCollapsedFolder, 'outgoing', nodeId, {
                            sourceId: incomingId, targetId: nodeId, label: edgeDataForSynthetic?.label ?? undefined
                        })
                    }
                    continue
                }
                const edgeId: string = `${incomingId}->${nodeId}`
                if (cy.getElementById(edgeId).length) continue
                const srcNode: GraphNode | undefined = graph.nodes[incomingId]
                const edgeData: { readonly targetId: string; readonly label: string } | undefined = srcNode?.outgoingEdges.find(e => e.targetId === nodeId)
                cy.add({
                    group: 'edges' as const,
                    data: {
                        id: edgeId,
                        source: incomingId,
                        target: nodeId,
                        label: edgeData?.label ?? undefined
                    }
                })
            }
        }
    })

    expandingFolders.delete(folderId) // H1: clear expanding guard
}

// ── Toggle ──
export async function toggleFolderCollapse(cy: Core, folderId: string): Promise<void> {
    if (isFolderCollapsed(folderId)) {
        await expandFolder(cy, folderId)
    } else {
        collapseFolder(cy, folderId)
    }
}

// ── Synthetic edge helpers ──

function computeSyntheticEdges(cy: Core, folderId: string): SyntheticEdgeRecord[] {
    const descendants: CollectionReturnValue = cy.getElementById(folderId).descendants()
    const descendantIds: Set<string> = new Set(descendants.map(n => n.id()))
    descendantIds.add(folderId)

    const crossEdges: CollectionReturnValue = descendants.connectedEdges().filter(e =>
        !descendantIds.has(e.source().id()) || !descendantIds.has(e.target().id())
    )

    type EdgeGroup = { direction: 'incoming' | 'outgoing'; edges: OriginalEdge[] }
    const groups: Map<string, EdgeGroup> = new Map<string, EdgeGroup>()
    crossEdges.forEach(e => {
        const srcInside: boolean = descendantIds.has(e.source().id())
        if (srcInside) {
            // Outgoing: child → external
            const key: string = `out:${e.target().id()}`
            const g: EdgeGroup = groups.get(key) ?? { direction: 'outgoing' as const, edges: [] }
            g.edges.push({ sourceId: e.source().id(), targetId: e.target().id(), label: e.data('label') })
            groups.set(key, g)
        } else {
            // Incoming: external → child
            const key: string = `in:${e.source().id()}`
            const g: EdgeGroup = groups.get(key) ?? { direction: 'incoming' as const, edges: [] }
            g.edges.push({ sourceId: e.source().id(), targetId: e.target().id(), label: e.data('label') })
            groups.set(key, g)
        }
    })

    return [...groups.entries()].map(([key, { direction, edges }]) => ({
        syntheticEdgeId: `synthetic:${folderId}:${key}`,
        direction,
        externalNodeId: key.slice(key.indexOf(':') + 1),
        originalEdges: edges
    }))
}

export function findCollapsedAncestorFolder(nodeId: string): string | null {
    let folderPath: string | null = getFolderParent(nodeId)
    while (folderPath) {
        if (isFolderCollapsed(folderPath)) return folderPath
        folderPath = getFolderParent(folderPath.slice(0, -1))
    }
    return null
}

export function addOrUpdateSyntheticEdge(
    cy: Core, folderId: string, direction: 'incoming' | 'outgoing',
    externalId: string, original: OriginalEdge
): void {
    // Filter self-loops (both endpoints in same folder)
    if (externalId === folderId) return

    const key: string = direction === 'incoming' ? `in:${externalId}` : `out:${externalId}`
    const edgeId: string = `synthetic:${folderId}:${key}`
    const existing: CollectionReturnValue = cy.getElementById(edgeId)

    if (existing.length) {
        // Update: increment count, clear label (now ambiguous)
        const count: number = (existing.data('edgeCount') ?? 1) + 1
        existing.data('edgeCount', count)
        existing.removeData('label')
    } else {
        const [source, target]: [string, string] = direction === 'incoming'
            ? [externalId, folderId] : [folderId, externalId]
        cy.add({
            group: 'edges' as const,
            data: {
                id: edgeId,
                source,
                target,
                isSyntheticEdge: true,
                label: original.label
            },
            classes: 'synthetic-folder-edge'
        })
    }

    // Update registry
    const recs: SyntheticEdgeRecord[] = syntheticEdgeRegistry.get(folderId) ?? []
    const rec: SyntheticEdgeRecord | undefined = recs.find(r => r.syntheticEdgeId === edgeId)
    if (rec) {
        rec.originalEdges.push(original)
    } else {
        recs.push({ syntheticEdgeId: edgeId, direction, externalNodeId: externalId, originalEdges: [original] })
    }
    syntheticEdgeRegistry.set(folderId, recs)
}
