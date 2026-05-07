import { describe, expect, it } from 'vitest'

import type { FolderTreeNode } from '@vt/graph-model'

import { applyCommand } from '../src/applyCommand'
import type { FolderId, ProjectedGraph, State } from '../src/contract'
import { listSnapshotDocuments } from '../src/fixtures'
import { project } from '../src/project'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAllFolderIds(tree: readonly FolderTreeNode[]): FolderId[] {
    const ids: FolderId[] = []
    for (const node of tree) {
        ids.push(`${node.absolutePath}/`)
        for (const child of node.children) {
            if ('children' in child) {
                ids.push(...collectAllFolderIds([child as FolderTreeNode]))
            }
        }
    }
    return ids
}

function deriveStatesWithCollapseVariations(state: State): State[] {
    const folderIds = collectAllFolderIds(state.roots.folderTree)
    if (folderIds.length === 0) return [state]

    const variants: State[] = [state]

    for (const folderId of folderIds) {
        let s = state
        s = applyCommand(s, { type: 'Collapse', folder: folderId })
        variants.push(s)
    }

    if (folderIds.length >= 2) {
        let allCollapsed = state
        for (const folderId of folderIds) {
            allCollapsed = applyCommand(allCollapsed, { type: 'Collapse', folder: folderId })
        }
        variants.push(allCollapsed)
    }

    return variants
}

function assertProjectionProperties(spec: ProjectedGraph, state: State, label: string): void {
    const nodeIds = new Set(spec.nodes.map((n) => n.id))
    const folderNodeIds = new Set(
        spec.nodes.filter((n) => n.kind === 'folder' || n.kind === 'folder-collapsed').map((n) => n.id),
    )

    // P1: Node ID uniqueness
    expect(nodeIds.size, `[${label}] P1: duplicate node IDs`).toBe(spec.nodes.length)

    // P2: Edge ID uniqueness
    const edgeIds = new Set(spec.edges.map((e) => e.id))
    expect(edgeIds.size, `[${label}] P2: duplicate edge IDs`).toBe(spec.edges.length)

    // P3: Edge endpoints reference existing nodes
    for (const edge of spec.edges) {
        expect(nodeIds.has(edge.source), `[${label}] P3: edge ${edge.id} source "${edge.source}" not in nodes`).toBe(true)
        expect(nodeIds.has(edge.target), `[${label}] P3: edge ${edge.id} target "${edge.target}" not in nodes`).toBe(true)
    }

    // P4: Node kind is valid
    const validKinds = new Set(['file', 'folder', 'folder-collapsed'])
    for (const node of spec.nodes) {
        expect(validKinds.has(node.kind), `[${label}] P4: invalid kind "${node.kind}" on ${node.id}`).toBe(true)
    }

    // P5: Edge kind is valid
    const validEdgeKinds = new Set(['real', 'synthetic'])
    for (const edge of spec.edges) {
        expect(validEdgeKinds.has(edge.kind), `[${label}] P5: invalid edge kind "${edge.kind}" on ${edge.id}`).toBe(true)
    }

    // P6: Parent references a visible folder
    for (const node of spec.nodes) {
        if (node.parent) {
            expect(
                folderNodeIds.has(node.parent),
                `[${label}] P6: node ${node.id} parent "${node.parent}" not a visible folder`,
            ).toBe(true)
        }
    }

    // P7: No self-edges
    for (const edge of spec.edges) {
        expect(edge.source, `[${label}] P7: self-edge on ${edge.id}`).not.toBe(edge.target)
    }

    // P8: Revision matches state
    expect(spec.revision, `[${label}] P8: revision mismatch`).toBe(state.meta.revision)

    // P9: Nodes are sorted by ID
    for (let i = 1; i < spec.nodes.length; i++) {
        expect(
            spec.nodes[i - 1].id.localeCompare(spec.nodes[i].id) <= 0,
            `[${label}] P9: nodes not sorted — "${spec.nodes[i - 1].id}" > "${spec.nodes[i].id}"`,
        ).toBe(true)
    }

    // P10: Edges are sorted (source, then target, then label, then id)
    for (let i = 1; i < spec.edges.length; i++) {
        const prev = spec.edges[i - 1]
        const curr = spec.edges[i]
        const cmp = prev.source.localeCompare(curr.source)
            || prev.target.localeCompare(curr.target)
            || (prev.label ?? '').localeCompare(curr.label ?? '')
            || prev.id.localeCompare(curr.id)
        expect(cmp <= 0, `[${label}] P10: edges not sorted at index ${i}`).toBe(true)
    }

    // P11: Synthetic edges reference at least one collapsed folder endpoint
    for (const edge of spec.edges) {
        if (edge.kind === 'synthetic') {
            const collapsedIds = new Set(
                spec.nodes.filter((n) => n.kind === 'folder-collapsed').map((n) => n.id),
            )
            const touchesCollapsed = collapsedIds.has(edge.source) || collapsedIds.has(edge.target)
            expect(
                touchesCollapsed,
                `[${label}] P11: synthetic edge ${edge.id} doesn't touch a collapsed folder`,
            ).toBe(true)
        }
    }
}

function assertCollapseFilteringProperties(spec: ProjectedGraph, state: State, label: string): void {
    const visibleCollapsedFolders = new Set(
        spec.nodes.filter((n) => n.kind === 'folder-collapsed').map((n) => n.id),
    )

    if (visibleCollapsedFolders.size === 0) return

    const graphNodeIds = Object.keys(state.graph.nodes)

    // P12: File nodes inside a collapsed folder are not individually visible
    for (const nodeId of graphNodeIds) {
        for (const collapsedFolder of visibleCollapsedFolders) {
            if (nodeId.startsWith(collapsedFolder)) {
                const appearsAsFileNode = spec.nodes.some(
                    (n) => n.id === nodeId && n.kind === 'file',
                )
                expect(
                    appearsAsFileNode,
                    `[${label}] P12: file "${nodeId}" visible despite collapsed ancestor "${collapsedFolder}"`,
                ).toBe(false)
            }
        }
    }

    // P13: Collapsed folder's childCount > 0
    for (const node of spec.nodes) {
        if (node.kind === 'folder-collapsed') {
            const childCount = node.childCount
            expect(
                typeof childCount === 'number' && childCount > 0,
                `[${label}] P13: collapsed folder "${node.id}" has invalid childCount: ${childCount}`,
            ).toBe(true)
        }
    }

    // P14: Subfolders of a collapsed folder are not individually visible
    for (const node of spec.nodes) {
        if (node.kind === 'folder' || node.kind === 'folder-collapsed') {
            for (const collapsedFolder of visibleCollapsedFolders) {
                if (node.id !== collapsedFolder && node.id.startsWith(collapsedFolder)) {
                    expect.unreachable(
                        `[${label}] P14: subfolder "${node.id}" visible despite collapsed ancestor "${collapsedFolder}"`,
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const snapshots = listSnapshotDocuments()

describe('project() property-based tests', () => {
    describe('determinism: same input → same output', () => {
        for (const { doc, state } of snapshots) {
            it(`deterministic for ${doc.id}`, () => {
                const first = project(state)
                const second = project(state)
                expect(first).toEqual(second)
            })
        }
    })

    describe('structural invariants across all fixtures', () => {
        for (const { doc, state } of snapshots) {
            it(`holds all structural properties for ${doc.id}`, () => {
                const spec = project(state)
                assertProjectionProperties(spec, state, doc.id)
            })
        }
    })

    describe('structural invariants with collapse variations', () => {
        for (const { doc, state } of snapshots) {
            const variants = deriveStatesWithCollapseVariations(state)
            if (variants.length <= 1) continue

            for (let i = 1; i < variants.length; i++) {
                it(`holds structural properties for ${doc.id} collapse-variant-${i}`, () => {
                    const spec = project(variants[i])
                    assertProjectionProperties(spec, variants[i], `${doc.id}/collapse-${i}`)
                })
            }
        }
    })

    describe('collapse filtering properties', () => {
        for (const { doc, state } of snapshots) {
            const variants = deriveStatesWithCollapseVariations(state)
            for (let i = 0; i < variants.length; i++) {
                const variantState = variants[i]
                if (variantState.collapseSet.size === 0) continue

                it(`collapse filtering for ${doc.id} variant-${i}`, () => {
                    const spec = project(variantState)
                    assertCollapseFilteringProperties(spec, variantState, `${doc.id}/v${i}`)
                })
            }
        }
    })

    describe('determinism with collapse variations', () => {
        for (const { doc, state } of snapshots) {
            const folderIds = collectAllFolderIds(state.roots.folderTree)
            if (folderIds.length === 0) continue
            if (state.collapseSet.size > 0) continue

            it(`deterministic after collapse/expand round-trip for ${doc.id}`, () => {
                const before = project(state)
                let s = state
                for (const folderId of folderIds) {
                    s = applyCommand(s, { type: 'Collapse', folder: folderId })
                }
                for (const folderId of folderIds) {
                    s = applyCommand(s, { type: 'Expand', folder: folderId })
                }
                const after = project(s)
                expect(after.nodes).toEqual(before.nodes)
                expect(after.edges).toEqual(before.edges)
            })
        }
    })

    describe('projection completeness: every graph node appears somewhere', () => {
        for (const { doc, state } of snapshots) {
            it(`all graph nodes accounted for in ${doc.id}`, () => {
                const spec = project(state)
                const visibleNodeIds = new Set(spec.nodes.map((n) => n.id))
                const visibleCollapsedFolders = new Set(
                    spec.nodes.filter((n) => n.kind === 'folder-collapsed').map((n) => n.id),
                )

                for (const nodeId of Object.keys(state.graph.nodes)) {
                    const directlyVisible = visibleNodeIds.has(nodeId)
                    const insideCollapsedFolder = [...visibleCollapsedFolders].some(
                        (folderId) => nodeId.startsWith(folderId),
                    )
                    expect(
                        directlyVisible || insideCollapsedFolder,
                        `node "${nodeId}" neither visible nor inside a collapsed folder`,
                    ).toBe(true)
                }
            })
        }
    })

    describe('edge conservation: collapsing reroutes cross-folder edges', () => {
        for (const { doc, state } of snapshots) {
            const hasEdges = Object.values(state.graph.nodes).some((n) => n.outgoingEdges.length > 0)
            if (!hasEdges) continue

            it(`cross-folder edges survive collapse for ${doc.id}`, () => {
                const uncollapsed = project(state)
                if (uncollapsed.edges.length === 0) return

                const hasCrossFolderEdges = uncollapsed.edges.some((e) => {
                    const sourceNode = uncollapsed.nodes.find((n) => n.id === e.source)
                    const targetNode = uncollapsed.nodes.find((n) => n.id === e.target)
                    if (!sourceNode || !targetNode) return false
                    const sourceFolder = sourceNode.parent ?? '__root__'
                    const targetFolder = targetNode.parent ?? '__root__'
                    return sourceFolder !== targetFolder
                })

                if (!hasCrossFolderEdges) return

                const folderIds = collectAllFolderIds(state.roots.folderTree)
                let s = state
                for (const folderId of folderIds) {
                    s = applyCommand(s, { type: 'Collapse', folder: folderId })
                }
                const collapsed = project(s)

                expect(
                    collapsed.edges.length,
                    `cross-folder edges disappeared after collapsing all folders`,
                ).toBeGreaterThan(0)
            })
        }
    })
})
