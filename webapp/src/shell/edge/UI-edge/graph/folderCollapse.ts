import type { Core, CollectionReturnValue } from 'cytoscape'
import type { Graph, GraphNode } from '@vt/graph-model/pure/graph'
import type { Position } from '@vt/graph-model/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import { getFolderChildNodeIds, getSubFolderPaths, getFolderParent } from '@vt/graph-model/pure/graph/folderCollapse'
import { getNodeTitle } from '@vt/graph-model/pure/graph/markdown-parsing'
import type {} from '@/shell/electron'

// ── Ephemeral UI state ──
const collapsedFolders: Set<string> = new Set()

export const isFolderCollapsed: (folderId: string) => boolean = (folderId) =>
    collapsedFolders.has(folderId)

// ── Collapse ──
export function collapseFolder(cy: Core, folderId: string): void {
    const folder: CollectionReturnValue = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return

    collapsedFolders.add(folderId)
    folder.data('collapsed', true)

    // Count children before removing (for badge)
    const childCount: number = folder.children().length
    folder.data('childCount', childCount)

    // Remove all children (nodes + connected edges removed automatically)
    // Also removes nested sub-folder compound nodes
    cy.batch(() => {
        folder.children().remove()
    })
}

// ── Expand ──
export async function expandFolder(cy: Core, folderId: string): Promise<void> {
    const folder: CollectionReturnValue = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return

    collapsedFolders.delete(folderId)
    folder.data('collapsed', false)
    folder.removeData('childCount')

    // Re-derive children from Graph (source of truth)
    const graph: Graph | undefined = await window.electronAPI?.main.getGraph()
    if (!graph) return

    const childIds: readonly string[] = getFolderChildNodeIds(graph.nodes, folderId)
    const subFolders: readonly string[] = getSubFolderPaths(graph.nodes, folderId)

    cy.batch(() => {
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
                if (!cy.getElementById(edge.targetId).length) continue
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
                if (!cy.getElementById(incomingId).length) continue
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
}

// ── Toggle ──
export async function toggleFolderCollapse(cy: Core, folderId: string): Promise<void> {
    if (isFolderCollapsed(folderId)) {
        await expandFolder(cy, folderId)
    } else {
        collapseFolder(cy, folderId)
    }
}
