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
    const root = '/vault'

    it('converts a single-node graph', () => {
        const graph = makeGraph({
            '/vault/note.md': {content: '# Hello World'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.rootPath).toBe(root)
        expect(result.nodes).toHaveLength(1)
        expect(result.nodes[0]!.id).toBe('/vault/note.md')
        expect(result.nodes[0]!.label).toBe('Hello World')
        expect(result.nodes[0]!.relPath).toBe('note.md')
        expect(result.nodes[0]!.folderPath).toBe('')
        expect(result.nodes[0]!.basename).toBe('note.md')
        expect(result.nodes[0]!.kind).toBe('file')
        expect(result.edges).toHaveLength(0)
    })

    it('derives labels from H1 headings', () => {
        const graph = makeGraph({
            '/vault/a.md': {content: '# First Note\nSome body text'},
            '/vault/b.md': {content: 'No heading here'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const nodeA = findNode(result, '/vault/a.md')
        const nodeB = findNode(result, '/vault/b.md')
        expect(nodeA!.label).toBe('First Note')
        expect(nodeB!.label).toBe('No heading here')
    })

    it('computes folder paths from nested structure', () => {
        const graph = makeGraph({
            '/vault/sub/deep/note.md': {content: '# Deep'},
            '/vault/top.md': {content: '# Top'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const deep = findNode(result, '/vault/sub/deep/note.md')
        const top = findNode(result, '/vault/top.md')
        expect(deep!.folderPath).toBe('sub/deep')
        expect(deep!.relPath).toBe('sub/deep/note.md')
        expect(top!.folderPath).toBe('')
        expect(top!.relPath).toBe('top.md')
    })

    it('builds edges from outgoingEdges', () => {
        const graph = makeGraph({
            '/vault/a.md': {content: '# A', edges: ['/vault/b.md']},
            '/vault/b.md': {content: '# B', edges: ['/vault/a.md']},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.edges).toHaveLength(2)
        expect(result.edges).toContainEqual(expect.objectContaining({source: '/vault/a.md', target: '/vault/b.md'}))
        expect(result.edges).toContainEqual(expect.objectContaining({source: '/vault/b.md', target: '/vault/a.md'}))
    })

    it('filters self-referencing edges', () => {
        const graph = makeGraph({
            '/vault/a.md': {content: '# A', edges: ['/vault/a.md', '/vault/b.md']},
            '/vault/b.md': {content: '# B'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        expect(result.edges).toHaveLength(1)
        expect(result.edges[0]).toEqual(expect.objectContaining({source: '/vault/a.md', target: '/vault/b.md'}))
    })

    it('sets kind to folder for folder nodes', () => {
        const graph = makeGraph({
            '/vault/folder/': {content: '', kind: 'folder'},
            '/vault/leaf.md': {content: '# Leaf', kind: 'leaf'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folder = findNode(result, '/vault/folder/')
        const leaf = findNode(result, '/vault/leaf.md')
        expect(folder!.kind).toBe('folder')
        expect(leaf!.kind).toBe('file')
    })

    it('computes arboricity', () => {
        const graph = makeGraph({
            '/vault/a.md': {content: '# A', edges: ['/vault/b.md', '/vault/c.md']},
            '/vault/b.md': {content: '# B', edges: ['/vault/c.md']},
            '/vault/c.md': {content: '# C'},
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
            '/vault/sub/deep/note.md': {content: '# Deep'},
            '/vault/sub/other.md': {content: '# Other'},
            '/vault/top.md': {content: '# Top'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folderNodes = result.nodes.filter(n => n.kind === 'folder')
        expect(folderNodes).toHaveLength(2)

        const sub = findNode(result, '/vault/sub')
        expect(sub).toBeDefined()
        expect(sub!.kind).toBe('folder')
        expect(sub!.relPath).toBe('sub')
        expect(sub!.folderPath).toBe('')

        const deep = findNode(result, '/vault/sub/deep')
        expect(deep).toBeDefined()
        expect(deep!.kind).toBe('folder')
        expect(deep!.relPath).toBe('sub/deep')
        expect(deep!.folderPath).toBe('sub')
    })

    it('does not synthesize folders for root-level files', () => {
        const graph = makeGraph({
            '/vault/a.md': {content: '# A'},
            '/vault/b.md': {content: '# B'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folderNodes = result.nodes.filter(n => n.kind === 'folder')
        expect(folderNodes).toHaveLength(0)
    })

    it('does not duplicate existing folder nodes from graph', () => {
        const graph = makeGraph({
            '/vault/sub/note.md': {content: '# Note'},
            '/vault/sub': {content: '', kind: 'folder'},
        })

        const result = buildAutoViewGraphFromState(graph, root)

        const folderNodes = result.nodes.filter(n => n.kind === 'folder')
        expect(folderNodes).toHaveLength(1)
        expect(folderNodes[0]!.id).toBe('/vault/sub')
    })
})
