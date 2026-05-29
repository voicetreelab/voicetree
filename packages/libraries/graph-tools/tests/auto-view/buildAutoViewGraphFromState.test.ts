import {describe, expect, it} from 'vitest'
import type {Graph} from '@vt/graph-model'
import * as O from 'fp-ts/lib/Option.js'
import {buildAutoViewGraphFromState} from '../../src/view/autoView'

function makeGraph(nodes: Record<string, {content: string; edges?: string[]; kind?: 'leaf' | 'folder'}>): Graph {
    const graphNodes: Graph['nodes'] = {}
    for (const [id, spec] of Object.entries(nodes)) {
        graphNodes[id] = {
            absoluteFilePathIsID: id,
            contentWithoutYamlOrLinks: spec.content,
            kind: spec.kind ?? 'leaf',
            outgoingEdges: (spec.edges ?? []).map(targetId => ({targetId, label: ''})),
            nodeUIMetadata: {
                color: O.none,
                position: O.none,
                additionalYAMLProps: {},
            },
        }
    }
    return {
        nodes: graphNodes,
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

function findNode(result: ReturnType<typeof buildAutoViewGraphFromState>, id: string) {
    return result.nodes.find(n => n.id === id)
}

describe('buildAutoViewGraphFromState', () => {
    const root = '/project'

    it('converts a single-node graph', () => {
        const graph = makeGraph({
            '/project/note.md': {content: '# Hello World'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.rootPath).toBe(root)
        expect(result.nodes).toHaveLength(1)
        expect(result.nodes[0]!.id).toBe('/project/note.md')
        expect(result.nodes[0]!.label).toBe('Hello World')
        expect(result.nodes[0]!.relPath).toBe('note.md')
        expect(result.nodes[0]!.folderPath).toBe('')
        expect(result.nodes[0]!.basename).toBe('note.md')
        expect(result.nodes[0]!.kind).toBe('file')
        expect(result.edges).toHaveLength(0)
    })

    it('derives labels from H1 headings', () => {
        const graph = makeGraph({
            '/project/a.md': {content: '# First Note\nSome body text'},
            '/project/b.md': {content: 'No heading here'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const nodeA = findNode(result, '/project/a.md')
        const nodeB = findNode(result, '/project/b.md')
        expect(nodeA!.label).toBe('First Note')
        expect(nodeB!.label).toBe('No heading here')
    })

    it('computes folder paths from nested structure', () => {
        const graph = makeGraph({
            '/project/sub/deep/note.md': {content: '# Deep'},
            '/project/top.md': {content: '# Top'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const deep = findNode(result, '/project/sub/deep/note.md')
        const top = findNode(result, '/project/top.md')
        expect(deep!.folderPath).toBe('sub/deep')
        expect(deep!.relPath).toBe('sub/deep/note.md')
        expect(top!.folderPath).toBe('')
        expect(top!.relPath).toBe('top.md')
    })

    it('builds edges from outgoingEdges', () => {
        const graph = makeGraph({
            '/project/a.md': {content: '# A', edges: ['/project/b.md']},
            '/project/b.md': {content: '# B', edges: ['/project/a.md']},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.edges).toHaveLength(2)
        expect(result.edges).toContainEqual(expect.objectContaining({source: '/project/a.md', target: '/project/b.md'}))
        expect(result.edges).toContainEqual(expect.objectContaining({source: '/project/b.md', target: '/project/a.md'}))
    })

    it('filters self-referencing edges', () => {
        const graph = makeGraph({
            '/project/a.md': {content: '# A', edges: ['/project/a.md', '/project/b.md']},
            '/project/b.md': {content: '# B'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.edges).toHaveLength(1)
        expect(result.edges[0]).toEqual(expect.objectContaining({source: '/project/a.md', target: '/project/b.md'}))
    })

    it('sets kind to folder for folder nodes', () => {
        const graph = makeGraph({
            '/project/folder/': {content: '', kind: 'folder'},
            '/project/leaf.md': {content: '# Leaf', kind: 'leaf'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folder = findNode(result, '/project/folder/')
        const leaf = findNode(result, '/project/leaf.md')
        expect(folder!.kind).toBe('folder')
        expect(leaf!.kind).toBe('file')
    })

    it('computes arboricity', () => {
        const graph = makeGraph({
            '/project/a.md': {content: '# A', edges: ['/project/b.md', '/project/c.md']},
            '/project/b.md': {content: '# B', edges: ['/project/c.md']},
            '/project/c.md': {content: '# C'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.arboricity).toBeGreaterThanOrEqual(1)
        expect(result.forests.length).toBeGreaterThanOrEqual(1)
    })

    it('returns empty graph for empty state', () => {
        const graph = makeGraph({})

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.nodes).toHaveLength(0)
        expect(result.edges).toHaveLength(0)
        expect(result.arboricity).toBe(0)
    })

    it('synthesizes folder nodes from file paths', () => {
        const graph = makeGraph({
            '/project/sub/deep/note.md': {content: '# Deep'},
            '/project/sub/other.md': {content: '# Other'},
            '/project/top.md': {content: '# Top'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folderNodes = result.nodes.filter(n => n.kind === 'folder')
        expect(folderNodes).toHaveLength(2)

        const sub = findNode(result, '/project/sub')
        expect(sub).toBeDefined()
        expect(sub!.kind).toBe('folder')
        expect(sub!.relPath).toBe('sub')
        expect(sub!.folderPath).toBe('')

        const deep = findNode(result, '/project/sub/deep')
        expect(deep).toBeDefined()
        expect(deep!.kind).toBe('folder')
        expect(deep!.relPath).toBe('sub/deep')
        expect(deep!.folderPath).toBe('sub')
    })

    it('does not synthesize folders for root-level files', () => {
        const graph = makeGraph({
            '/project/a.md': {content: '# A'},
            '/project/b.md': {content: '# B'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folderNodes = result.nodes.filter(n => n.kind === 'folder')
        expect(folderNodes).toHaveLength(0)
    })

    it('does not duplicate existing folder nodes from graph', () => {
        const graph = makeGraph({
            '/project/sub/note.md': {content: '# Note'},
            '/project/sub': {content: '', kind: 'folder'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folderNodes = result.nodes.filter(n => n.kind === 'folder')
        expect(folderNodes).toHaveLength(1)
        expect(folderNodes[0]!.id).toBe('/project/sub')
    })
})
