/**
 * RED TEAM: Shell-level tests that SHOULD pass but DON'T.
 * Tests the full cy-based collapse/expand flow for nested folder scenarios.
 *
 * Bugs found:
 * 1. Expanding parent doesn't restore synthetic edges for still-collapsed child folders
 * 2. Re-created subfolder compound node loses collapsed visual state (collapsed, childCount)
 * 3. cy node.data('collapsed') and store-based isFolderCollapsed() disagree after re-creation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import cytoscape from 'cytoscape'
import type { Core, CollectionReturnValue } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'

const mockGetGraph: Mock = vi.fn()
vi.stubGlobal('electronAPI', undefined)
// @ts-expect-error — setting electronAPI on window for test
window.electronAPI = { main: { getGraph: mockGetGraph } }

import {
    collapseFolder,
    expandFolder,
    isFolderCollapsed,
} from '@/shell/edge/UI-edge/graph/folderCollapse'

// ── Helper to build mock Graph for expandFolder ──

function mockGraph(nodes: Record<string, {
    outgoingEdges?: { targetId: string; label?: string }[]
}>): {
    nodes: Record<string, unknown>
    incomingEdgesIndex: Map<string, string[]>
    nodeByBaseName: Map<string, string>
    unresolvedLinksIndex: Map<string, string[]>
} {
    const graphNodes: Record<string, unknown> = {}
    const incoming: Map<string, string[]> = new Map()

    for (const [id, config] of Object.entries(nodes)) {
        graphNodes[id] = {
            absoluteFilePathIsID: id,
            contentWithoutYamlOrLinks: `# ${id}`,
            outgoingEdges: (config.outgoingEdges ?? []).map(e => ({ targetId: e.targetId, label: e.label ?? '' })),
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: Math.random() * 200, y: Math.random() * 200 }),
                additionalYAMLProps: new Map(),
                isContextNode: false
            }
        }
        for (const edge of config.outgoingEdges ?? []) {
            const list: string[] = incoming.get(edge.targetId) ?? []
            list.push(id)
            incoming.set(edge.targetId, list)
        }
    }

    return {
        nodes: graphNodes,
        incomingEdgesIndex: incoming,
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

describe('RED TEAM: Nested folder collapse/expand — synthetic edge loss', () => {
    let cy: Core

    beforeEach(() => {
        cy = cytoscape({ headless: true, elements: [] })
        mockGetGraph.mockReset()
    })

    afterEach(() => {
        cy.destroy()
    })

    it('BUG: collapse A, collapse B, expand B — synthetic X→A should be restored but is NOT', async () => {
        // Setup: External X, folder B/ containing subfolder A/ containing child.md
        // Edge: X → A/child.md
        cy.add([
            { group: 'nodes', data: { id: 'rt1-X', label: 'External' }, position: { x: 0, y: 0 } },
            { group: 'nodes', data: { id: 'rt1-B/', isFolderNode: true, folderLabel: 'B' } },
            { group: 'nodes', data: { id: 'rt1-B/A/', isFolderNode: true, folderLabel: 'A', parent: 'rt1-B/' } },
            { group: 'nodes', data: { id: 'rt1-B/A/child.md', label: 'Child', parent: 'rt1-B/A/' }, position: { x: 100, y: 100 } },
            { group: 'edges', data: { id: 'rt1-X->rt1-B/A/child.md', source: 'rt1-X', target: 'rt1-B/A/child.md', label: 'ref' } },
        ])

        // 1. Collapse inner folder A/
        collapseFolder(cy, 'rt1-B/A/')
        expect(isFolderCollapsed('rt1-B/A/')).toBe(true)
        // Synthetic X → A/ exists
        expect(cy.getElementById('synthetic:rt1-B/A/:in:rt1-X').length).toBe(1)

        // 2. Collapse outer folder B/
        collapseFolder(cy, 'rt1-B/')
        // A/ removed from cy → synthetic X→A/ auto-removed
        expect(cy.getElementById('rt1-B/A/').length).toBe(0)
        // But synthetic X→B/ should exist (B/ picked up the cross-boundary edge)
        expect(cy.getElementById('synthetic:rt1-B/:in:rt1-X').length).toBe(1)

        // 3. Expand B/
        mockGetGraph.mockResolvedValue(mockGraph({
            'rt1-B/A/child.md': {
                outgoingEdges: []
            },
            'rt1-X': {
                outgoingEdges: [{ targetId: 'rt1-B/A/child.md', label: 'ref' }]
            }
        }))
        await expandFolder(cy, 'rt1-B/')

        // B/ expanded, A/ re-created as compound node
        expect(cy.getElementById('rt1-B/A/').length).toBe(1)
        expect(isFolderCollapsed('rt1-B/')).toBe(false)
        expect(isFolderCollapsed('rt1-B/A/')).toBe(true) // A/ still collapsed in store

        // BUG: synthetic X→A/ should be restored since A/ is still collapsed
        // but computeExpandPlan doesn't process edges for subfolder descendants
        const restoredSynth: CollectionReturnValue = cy.edges('[?isSyntheticEdge]').filter(
            e => e.data('target') === 'rt1-B/A/'
        )
        expect(restoredSynth.length).toBe(1) // FAILS — no synthetic edge to A/
    })

    it('BUG: collapse A, collapse B, expand B — outgoing synthetic from A/ also lost', async () => {
        // Reverse direction: A/child.md → X
        cy.add([
            { group: 'nodes', data: { id: 'rt2-X', label: 'External' }, position: { x: 200, y: 0 } },
            { group: 'nodes', data: { id: 'rt2-B/', isFolderNode: true, folderLabel: 'B' } },
            { group: 'nodes', data: { id: 'rt2-B/A/', isFolderNode: true, folderLabel: 'A', parent: 'rt2-B/' } },
            { group: 'nodes', data: { id: 'rt2-B/A/child.md', label: 'Child', parent: 'rt2-B/A/' }, position: { x: 100, y: 100 } },
            { group: 'edges', data: { id: 'rt2-B/A/child.md->rt2-X', source: 'rt2-B/A/child.md', target: 'rt2-X', label: 'dep' } },
        ])

        collapseFolder(cy, 'rt2-B/A/')
        expect(cy.getElementById('synthetic:rt2-B/A/:out:rt2-X').length).toBe(1)

        collapseFolder(cy, 'rt2-B/')
        expect(cy.getElementById('synthetic:rt2-B/:out:rt2-X').length).toBe(1)

        mockGetGraph.mockResolvedValue(mockGraph({
            'rt2-B/A/child.md': {
                outgoingEdges: [{ targetId: 'rt2-X', label: 'dep' }]
            }
        }))
        await expandFolder(cy, 'rt2-B/')

        // BUG: outgoing synthetic A/→X should be restored
        const restoredSynth: CollectionReturnValue = cy.edges('[?isSyntheticEdge]').filter(
            e => e.data('source') === 'rt2-B/A/'
        )
        expect(restoredSynth.length).toBe(1) // FAILS
    })
})

describe('RED TEAM: Re-created subfolder visual state', () => {
    let cy: Core

    beforeEach(() => {
        cy = cytoscape({ headless: true, elements: [] })
        mockGetGraph.mockReset()
    })

    afterEach(() => {
        cy.destroy()
    })

    it('BUG: re-created subfolder should have collapsed=true for CSS styling', async () => {
        // The Cytoscape stylesheet uses selector 'node[?isFolderNode][?collapsed]'
        // to render collapsed folders as compact 40x40 boxes with child count.
        // Without collapsed=true, the re-created subfolder renders as an empty compound node.
        cy.add([
            { group: 'nodes', data: { id: 'rt3-B/', isFolderNode: true, folderLabel: 'B' } },
            { group: 'nodes', data: { id: 'rt3-B/A/', isFolderNode: true, folderLabel: 'A', parent: 'rt3-B/' } },
            { group: 'nodes', data: { id: 'rt3-B/A/child.md', label: 'Child', parent: 'rt3-B/A/' }, position: { x: 50, y: 50 } },
        ])

        // Collapse A/ — sets collapsed=true, childCount=1
        collapseFolder(cy, 'rt3-B/A/')
        expect(cy.getElementById('rt3-B/A/').data('collapsed')).toBe(true)
        expect(cy.getElementById('rt3-B/A/').data('childCount')).toBe(1)

        // Collapse B/ — removes A/
        collapseFolder(cy, 'rt3-B/')

        // Expand B/
        mockGetGraph.mockResolvedValue(mockGraph({
            'rt3-B/A/child.md': { outgoingEdges: [] }
        }))
        await expandFolder(cy, 'rt3-B/')

        // A/ should be re-created
        const restoredA: CollectionReturnValue = cy.getElementById('rt3-B/A/')
        expect(restoredA.length).toBe(1)
        expect(restoredA.data('isFolderNode')).toBe(true)

        // BUG: The expand code adds subfolders without checking if they're still collapsed.
        // collapsed is undefined → Cytoscape 'node[?collapsed]' selector won't match →
        // no collapsed visual style (40x40 box, child count badge)
        expect(restoredA.data('collapsed')).toBe(true) // FAILS — undefined
    })

    it('BUG: re-created subfolder should have childCount for badge display', async () => {
        // The collapsed folder label shows "folderLabel (childCount)".
        // Without childCount, it shows "A (?)" — confusing to the user.
        cy.add([
            { group: 'nodes', data: { id: 'rt4-B/', isFolderNode: true, folderLabel: 'B' } },
            { group: 'nodes', data: { id: 'rt4-B/A/', isFolderNode: true, folderLabel: 'A', parent: 'rt4-B/' } },
            { group: 'nodes', data: { id: 'rt4-B/A/c1.md', label: 'C1', parent: 'rt4-B/A/' }, position: { x: 50, y: 50 } },
            { group: 'nodes', data: { id: 'rt4-B/A/c2.md', label: 'C2', parent: 'rt4-B/A/' }, position: { x: 80, y: 50 } },
        ])

        collapseFolder(cy, 'rt4-B/A/')
        expect(cy.getElementById('rt4-B/A/').data('childCount')).toBe(2)

        collapseFolder(cy, 'rt4-B/')

        mockGetGraph.mockResolvedValue(mockGraph({
            'rt4-B/A/c1.md': { outgoingEdges: [] },
            'rt4-B/A/c2.md': { outgoingEdges: [] }
        }))
        await expandFolder(cy, 'rt4-B/')

        const restoredA: CollectionReturnValue = cy.getElementById('rt4-B/A/')
        expect(restoredA.length).toBe(1)

        // BUG: childCount is lost. The graph model has 2 children for A/
        // but the expand code doesn't compute this for still-collapsed subfolders.
        expect(restoredA.data('childCount')).toBe(2) // FAILS — undefined
    })

    it('BUG: menu text and action disagree — "Collapse" shown but expand executes', async () => {
        // VerticalMenuService reads node.data('collapsed') for menu text.
        // toggleFolderCollapse reads isFolderCollapsed() (store-based) for action.
        // After re-creation: data('collapsed')=undefined → menu says "Collapse"
        // But isFolderCollapsed()=true → toggle calls expandFolder.
        // User sees "Collapse" but clicking it EXPANDS. Confusing UX.
        cy.add([
            { group: 'nodes', data: { id: 'rt5-B/', isFolderNode: true, folderLabel: 'B' } },
            { group: 'nodes', data: { id: 'rt5-B/A/', isFolderNode: true, folderLabel: 'A', parent: 'rt5-B/' } },
            { group: 'nodes', data: { id: 'rt5-B/A/child.md', label: 'Child', parent: 'rt5-B/A/' }, position: { x: 50, y: 50 } },
        ])

        collapseFolder(cy, 'rt5-B/A/')
        collapseFolder(cy, 'rt5-B/')

        mockGetGraph.mockResolvedValue(mockGraph({
            'rt5-B/A/child.md': { outgoingEdges: [] }
        }))
        await expandFolder(cy, 'rt5-B/')

        const restoredA: CollectionReturnValue = cy.getElementById('rt5-B/A/')

        // These two should agree but DON'T:
        const cyThinksFolderIsCollapsed: boolean = !!restoredA.data('collapsed') // false (undefined)
        const storeThinksFolderIsCollapsed: boolean = isFolderCollapsed('rt5-B/A/') // true

        // BUG: cy and store disagree on whether A/ is collapsed
        expect(cyThinksFolderIsCollapsed).toBe(storeThinksFolderIsCollapsed) // FAILS — false !== true
    })
})
