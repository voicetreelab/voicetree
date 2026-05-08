import {describe, expect, it} from 'vitest'
import {
    countVisibleEntities,
    findCollapseBoundary,
    type CollapseBoundaryGraph,
} from '../src/collapseBoundary'

function makeGraph(nodes: readonly {
    readonly id: string
    readonly title: string
    readonly relPath: string
    readonly folderPath: string
    readonly outgoingIds: readonly string[]
}[]): CollapseBoundaryGraph {
    return {rootName: 'fixture', nodes}
}

describe('findCollapseBoundary', () => {
    it('returns no clusters when the full graph already fits the budget', () => {
        const graph = makeGraph([
            {id: 'a', title: 'A', relPath: 'a.md', folderPath: '', outgoingIds: ['b']},
            {id: 'b', title: 'B', relPath: 'b.md', folderPath: '', outgoingIds: []},
        ])

        expect(findCollapseBoundary(graph, 10)).toHaveLength(0)
    })

    it('prefers folder-first over louvain when a folder partition fits the budget', () => {
        const graph = makeGraph([
            {id: 'notes/a', title: 'A', relPath: 'notes/a.md', folderPath: 'notes', outgoingIds: ['notes/b']},
            {id: 'notes/b', title: 'B', relPath: 'notes/b.md', folderPath: 'notes', outgoingIds: ['notes/a', 'root']},
            {id: 'root', title: 'Root', relPath: 'root.md', folderPath: '', outgoingIds: []},
        ])

        const clusters = findCollapseBoundary(graph, 2)

        expect(clusters.length).toBeGreaterThan(0)
        expect(clusters.every(c => c.strategy === 'folder-first')).toBe(true)
    })

    it('falls back to louvain when the graph is flat (no useful folder partition)', () => {
        const graph = makeGraph([
            {id: 'a', title: 'A', relPath: 'a.md', folderPath: '', outgoingIds: ['b', 'c']},
            {id: 'b', title: 'B', relPath: 'b.md', folderPath: '', outgoingIds: ['a', 'c']},
            {id: 'c', title: 'C', relPath: 'c.md', folderPath: '', outgoingIds: ['a', 'b', 'd']},
            {id: 'd', title: 'D', relPath: 'd.md', folderPath: '', outgoingIds: ['c', 'e', 'f']},
            {id: 'e', title: 'E', relPath: 'e.md', folderPath: '', outgoingIds: ['d', 'f']},
            {id: 'f', title: 'F', relPath: 'f.md', folderPath: '', outgoingIds: ['d', 'e']},
        ])

        const clusters = findCollapseBoundary(graph, 3)

        expect(clusters.length).toBeGreaterThan(0)
        expect(clusters.every(c => c.strategy === 'louvain')).toBe(true)
    })

    it('never collapses protected (selected) nodes', () => {
        const graph = makeGraph([
            {id: 'alpha/a1', title: 'A1', relPath: 'alpha/a1.md', folderPath: 'alpha', outgoingIds: ['alpha/a2']},
            {id: 'alpha/a2', title: 'A2', relPath: 'alpha/a2.md', folderPath: 'alpha', outgoingIds: ['alpha/a1']},
            {id: 'beta/b1', title: 'B1', relPath: 'beta/b1.md', folderPath: 'beta', outgoingIds: ['beta/b2']},
            {id: 'beta/b2', title: 'B2', relPath: 'beta/b2.md', folderPath: 'beta', outgoingIds: ['beta/b1']},
        ])

        const clusters = findCollapseBoundary(graph, 2, {selectedIds: ['alpha/a1.md']})

        const protectedInAnyCluster = clusters.some(c => c.nodeIds.includes('alpha/a1') || c.nodeIds.includes('alpha/a2'))
        expect(protectedInAnyCluster).toBe(false)
    })

    it('every returned cluster reduces the visible-entity count below the starting point', () => {
        const graph = makeGraph([
            {id: 'x/a', title: 'A', relPath: 'x/a.md', folderPath: 'x', outgoingIds: ['x/b']},
            {id: 'x/b', title: 'B', relPath: 'x/b.md', folderPath: 'x', outgoingIds: ['x/a']},
            {id: 'y/c', title: 'C', relPath: 'y/c.md', folderPath: 'y', outgoingIds: ['y/d']},
            {id: 'y/d', title: 'D', relPath: 'y/d.md', folderPath: 'y', outgoingIds: ['y/c']},
            {id: 'root', title: 'Root', relPath: 'root.md', folderPath: '', outgoingIds: []},
        ])

        const clusters = findCollapseBoundary(graph, 3)

        expect(countVisibleEntities(graph.nodes.length, clusters)).toBeLessThan(graph.nodes.length)
    })
})
