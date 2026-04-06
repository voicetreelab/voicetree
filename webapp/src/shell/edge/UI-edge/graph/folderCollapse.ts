import type { Core, CollectionReturnValue } from 'cytoscape'
import type { Graph } from '@vt/graph-model/pure/graph'
import type { Position } from '@vt/graph-model/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import { computeSyntheticEdgeSpecs, computeExpandPlan } from '@vt/graph-model/pure/graph/folderCollapse'
import type { SyntheticEdgeSpec, ExpandPlan } from '@vt/graph-model/pure/graph/folderCollapse'
import { getNodeTitle } from '@vt/graph-model/pure/graph/markdown-parsing'
import type {} from '@/shell/electron'
import { addCollapsedFolder, removeCollapsedFolder, isGraphFolderCollapsed, getFolderTreeState } from '@/shell/edge/UI-edge/state/FolderTreeStore'

// ── Ephemeral UI state ──
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
    isGraphFolderCollapsed(folderId)

// ── Collapse ──
export function collapseFolder(cy: Core, folderId: string): void {
    if (expandingFolders.has(folderId)) return // H1: skip if expand is in-flight
    const folder: CollectionReturnValue = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return

    folder.data('collapsed', true)

    // Count children before removing (for badge)
    const childCount: number = folder.children().length
    folder.data('childCount', childCount)

    // D1: Extract data from cy, then compute synthetics via pure function
    const descendants: CollectionReturnValue = cy.getElementById(folderId).descendants()
    const descendantIds: Set<string> = new Set(descendants.map(n => n.id()))
    descendantIds.add(folderId)
    const connectedEdges: { sourceId: string; targetId: string; label: string | undefined }[] = descendants.connectedEdges().map(e => ({
        sourceId: e.source().id(),
        targetId: e.target().id(),
        label: e.data('label') as string | undefined
    }))
    const specs: readonly SyntheticEdgeSpec[] = computeSyntheticEdgeSpecs(folderId, descendantIds, connectedEdges)
    const synthetics: SyntheticEdgeRecord[] = specs.map(s => ({
        syntheticEdgeId: s.syntheticEdgeId,
        direction: s.direction,
        externalNodeId: s.externalNodeId,
        originalEdges: [...s.originalEdges]
    }))

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

    addCollapsedFolder(folderId)
}

// ── Expand ──
export async function expandFolder(cy: Core, folderId: string): Promise<void> {
    const folder: CollectionReturnValue = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return
    if (expandingFolders.has(folderId)) return // H1: already expanding

    expandingFolders.add(folderId) // H1: mark as expanding

    folder.data('collapsed', false)
    folder.removeData('childCount')

    // Re-derive children from Graph (source of truth)
    let graph: Graph | undefined
    try {
        graph = await window.electronAPI?.main.getGraph()
    } catch {
        // M3: rollback state on IPC failure (store still has folder as collapsed)
        folder.data('collapsed', true)
        expandingFolders.delete(folderId)
        return
    }
    if (!graph) {
        expandingFolders.delete(folderId)
        return
    }

    // Collect visible node IDs from cy
    const visibleNodeIds: Set<string> = new Set(cy.nodes().map(n => n.id()))

    // Pure computation: expand plan from graph data
    const { graphCollapsedFolders } = getFolderTreeState()
    const plan: ExpandPlan = computeExpandPlan(graph, folderId, graphCollapsedFolders, visibleNodeIds)

    cy.batch(() => {
        // Remove old synthetic edges for this folder
        const oldSynthetics: SyntheticEdgeRecord[] | undefined = syntheticEdgeRegistry.get(folderId)
        if (oldSynthetics) {
            for (const rec of oldSynthetics) cy.getElementById(rec.syntheticEdgeId).remove()
            syntheticEdgeRegistry.delete(folderId)
        }

        // Add sub-folder compound nodes
        for (const sf of plan.subFolders) {
            if (!cy.getElementById(sf).length) {
                cy.add({
                    group: 'nodes' as const,
                    data: { id: sf, folderLabel: sf.replace(/\/$/, '').split('/').pop()!, isFolderNode: true, parent: folderId }
                })
            }
        }

        // Add child nodes
        for (const { id, node, parentFolder } of plan.childNodes) {
            if (cy.getElementById(id).length) continue
            const pos: Position = O.getOrElse(() => ({ x: 0, y: 0 }))(node.nodeUIMetadata.position)
            const colorValue: string | undefined = O.isSome(node.nodeUIMetadata.color) ? node.nodeUIMetadata.color.value : undefined
            cy.add({
                group: 'nodes' as const,
                data: { id, label: getNodeTitle(node), content: node.contentWithoutYamlOrLinks, summary: '', color: colorValue, isContextNode: false, parent: parentFolder ?? undefined },
                position: { x: pos.x, y: pos.y }
            })
        }

        // Add real edges
        for (const { id, source, target, label } of plan.realEdges) {
            if (!cy.getElementById(id).length) {
                cy.add({ group: 'edges' as const, data: { id, source, target, label } })
            }
        }

        // Add synthetic edges for still-collapsed folders
        for (const se of plan.syntheticEdges) {
            addOrUpdateSyntheticEdge(cy, se.folderId, se.direction, se.externalId, se.original)
        }
    })

    removeCollapsedFolder(folderId)
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
