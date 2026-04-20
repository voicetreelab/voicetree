import {describe, expect, it} from 'vitest'
import {
    findCollapseBoundary,
    type CollapseBoundaryGraph,
    type CollapseBoundaryNode,
} from '../src/collapseBoundary'

function makeGraph(nodes: readonly CollapseBoundaryNode[]): CollapseBoundaryGraph {
    return {rootName: 'fixture', nodes}
}

describe('findCollapseBoundary folder-aware scoring', () => {
    it('uses explicit folder nodes to seed folder-first candidates when kind metadata is present', () => {
        const graph = makeGraph([
            {id: 'projects', title: 'Projects', relPath: 'projects', folderPath: '', outgoingIds: [], kind: 'folder'},
            {id: 'projects/a', title: 'A', relPath: 'projects/a.md', folderPath: 'projects', outgoingIds: ['projects/b'], kind: 'file'},
            {id: 'projects/b', title: 'B', relPath: 'projects/b.md', folderPath: 'projects', outgoingIds: ['projects/a'], kind: 'file'},
            {id: 'archive/x', title: 'X', relPath: 'archive/x.md', folderPath: 'archive', outgoingIds: ['archive/y'], kind: 'file'},
            {id: 'archive/y', title: 'Y', relPath: 'archive/y.md', folderPath: 'archive', outgoingIds: ['archive/x'], kind: 'file'},
        ])

        const [cluster] = findCollapseBoundary(graph, 4)

        expect(cluster?.strategy).toBe('folder-first')
        expect(cluster?.alignedFolderPath).toBe('projects')
        expect(cluster?.nodeIds).toEqual(['projects/a', 'projects/b'])
    })

    it('falls back to folder-path seeding when kind metadata is absent', () => {
        const graph = makeGraph([
            {id: 'notes/a', title: 'A', relPath: 'notes/a.md', folderPath: 'notes', outgoingIds: ['notes/b']},
            {id: 'notes/b', title: 'B', relPath: 'notes/b.md', folderPath: 'notes', outgoingIds: ['notes/a']},
            {id: 'root', title: 'Root', relPath: 'root.md', folderPath: '', outgoingIds: []},
        ])

        const [cluster] = findCollapseBoundary(graph, 2)

        expect(cluster?.strategy).toBe('folder-first')
        expect(cluster?.alignedFolderPath).toBe('notes')
        expect(cluster?.nodeIds).toEqual(['notes/a', 'notes/b'])
    })

    it('prefers an aligned louvain cluster over an equal-cohesion non-aligned cluster', () => {
        const graph = makeGraph([
            {id: 'projects/a', title: 'PA', relPath: 'projects/a.md', folderPath: 'projects', outgoingIds: ['projects/b', 'projects/c'], kind: 'file'},
            {id: 'projects/b', title: 'PB', relPath: 'projects/b.md', folderPath: 'projects', outgoingIds: ['projects/a', 'projects/c'], kind: 'file'},
            {id: 'projects/c', title: 'PC', relPath: 'projects/c.md', folderPath: 'projects', outgoingIds: ['projects/a', 'projects/b'], kind: 'file'},
            {id: 'alpha/q1', title: 'Q1', relPath: 'alpha/q1.md', folderPath: 'alpha', outgoingIds: ['beta/q2', 'gamma/q3'], kind: 'file'},
            {id: 'beta/q2', title: 'Q2', relPath: 'beta/q2.md', folderPath: 'beta', outgoingIds: ['alpha/q1', 'gamma/q3'], kind: 'file'},
            {id: 'gamma/q3', title: 'Q3', relPath: 'gamma/q3.md', folderPath: 'gamma', outgoingIds: ['alpha/q1', 'beta/q2'], kind: 'file'},
        ])

        const [cluster] = findCollapseBoundary(graph, 4)

        expect(cluster?.strategy).toBe('louvain')
        expect(cluster?.alignedFolderPath).toBe('projects')
        expect(cluster?.nodeIds).toEqual(['projects/a', 'projects/b', 'projects/c'])
    })

    it('does not let the folder bonus outrank a meaningfully stronger non-aligned louvain cut', () => {
        const graph = makeGraph([
            {id: 'projects/a', title: 'PA', relPath: 'projects/a.md', folderPath: 'projects', outgoingIds: ['projects/b', 'alpha/q1'], kind: 'file'},
            {id: 'projects/b', title: 'PB', relPath: 'projects/b.md', folderPath: 'projects', outgoingIds: ['projects/a', 'projects/c'], kind: 'file'},
            {id: 'projects/c', title: 'PC', relPath: 'projects/c.md', folderPath: 'projects', outgoingIds: ['projects/b'], kind: 'file'},
            {id: 'alpha/q1', title: 'Q1', relPath: 'alpha/q1.md', folderPath: 'alpha', outgoingIds: ['beta/q2', 'gamma/q3'], kind: 'file'},
            {id: 'beta/q2', title: 'Q2', relPath: 'beta/q2.md', folderPath: 'beta', outgoingIds: ['alpha/q1', 'gamma/q3'], kind: 'file'},
            {id: 'gamma/q3', title: 'Q3', relPath: 'gamma/q3.md', folderPath: 'gamma', outgoingIds: ['alpha/q1', 'beta/q2'], kind: 'file'},
        ])

        const [cluster] = findCollapseBoundary(graph, 4)

        expect(cluster?.strategy).toBe('louvain')
        expect(cluster?.alignedFolderPath).toBeUndefined()
        expect(cluster?.nodeIds).toEqual(['alpha/q1', 'beta/q2', 'gamma/q3'])
    })
})
