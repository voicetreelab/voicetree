/**
 * Unit tests for the pure folder-bounded component counter (BF-444).
 *
 * Black-box: build a synthetic graph, call countFolderBoundedComponent, assert
 * on the returned size. Covers undirected reachability, cross-folder cutoff,
 * folder-node-terminal, folder-note exemption, singleton, and an out-of-folder
 * seed (the worktree case where the parent lives above the destination folder).
 */

import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {countFolderBoundedComponent} from './subgraphComponent'

interface NodeSpec {
    readonly id: string
    readonly out?: readonly string[]
    readonly isContext?: boolean
}

/** Build a Graph from node specs, deriving the incoming-edge index from outgoing edges. */
function buildGraph(specs: readonly NodeSpec[]): Graph {
    const nodes: Record<NodeIdAndFilePath, GraphNode> = {}
    for (const spec of specs) {
        nodes[spec.id] = {
            kind: 'leaf',
            absoluteFilePathIsID: spec.id,
            outgoingEdges: (spec.out ?? []).map(target => ({targetId: target, label: ''})),
            contentWithoutYamlOrLinks: '',
            nodeUIMetadata: {
                color: O.none as O.Option<string>,
                position: O.none as O.Option<Position>,
                additionalYAMLProps: {},
                isContextNode: spec.isContext,
            },
        }
    }
    const incoming: Map<NodeIdAndFilePath, NodeIdAndFilePath[]> = new Map()
    for (const spec of specs) {
        for (const target of spec.out ?? []) {
            const sources: NodeIdAndFilePath[] = incoming.get(target) ?? []
            sources.push(spec.id)
            incoming.set(target, sources)
        }
    }
    return {nodes, incomingEdgesIndex: incoming, nodeByBaseName: new Map(), unresolvedLinksIndex: new Map()}
}

describe('countFolderBoundedComponent', () => {
    it('counts children reachable via incoming edges (undirected: child -> parent)', () => {
        // b, c, d each authored `- parent [[A]]` (edges point child -> A), all in f/.
        const graph: Graph = buildGraph([
            {id: 'f/A.md'},
            {id: 'f/b.md', out: ['f/A.md']},
            {id: 'f/c.md', out: ['f/A.md']},
            {id: 'f/d.md', out: ['f/A.md']},
        ])
        expect(countFolderBoundedComponent(graph, 'f/A.md', 'f/')).toBe(4)
    })

    it('does not count or enter a different folder via a cross-ref', () => {
        const graph: Graph = buildGraph([
            {id: 'f/A.md', out: ['g/B.md']},
            {id: 'g/B.md'},
        ])
        // Only A (in f/) is counted; B is neither counted nor traversed into.
        expect(countFolderBoundedComponent(graph, 'f/A.md', 'f/')).toBe(1)
    })

    it('counts a folder identity note once and does not expand its contents', () => {
        const graph: Graph = buildGraph([
            {id: 'f/A.md', out: ['g/g.md']},
            {id: 'g/g.md'}, // identity note of folder g/
            ...Array.from({length: 10}, (_, i) => ({id: `g/x${i}.md`, out: ['g/g.md']})),
        ])
        // A (1) + folder node g/g.md (1) = 2; the 10 children of g/ are not traversed.
        expect(countFolderBoundedComponent(graph, 'f/A.md', 'f/')).toBe(2)
    })

    it('excludes the destination folder own identity note from the count', () => {
        const graph: Graph = buildGraph([
            {id: 'f/f.md', out: ['root.md']}, // identity note of f/
            {id: 'f/A.md', out: ['f/f.md']},
            {id: 'f/b.md', out: ['f/A.md']},
            {id: 'root.md'},
        ])
        // A and b are counted; f/f.md (the folder's own note) is excluded.
        expect(countFolderBoundedComponent(graph, 'f/A.md', 'f/')).toBe(2)
    })

    it('returns 1 for a singleton folder (start node alone)', () => {
        const graph: Graph = buildGraph([{id: 'f/A.md'}])
        expect(countFolderBoundedComponent(graph, 'f/A.md', 'f/')).toBe(1)
    })

    it('does not count an out-of-folder seed parent (worktree case)', () => {
        // task.md is the parent (root, outside f/); the folder note + 3 nodes attach to it.
        const graph: Graph = buildGraph([
            {id: 'task.md'},
            {id: 'f/f.md', out: ['task.md']}, // folder identity note
            {id: 'f/n1.md', out: ['task.md']},
            {id: 'f/n2.md', out: ['task.md']},
            {id: 'f/n3.md', out: ['task.md']},
        ])
        // Only the 3 in-folder leaves count; the seed (task.md) and the folder note do not.
        expect(countFolderBoundedComponent(graph, 'task.md', 'f/')).toBe(3)
    })

    it('ignores context nodes during traversal', () => {
        const graph: Graph = buildGraph([
            {id: 'f/A.md'},
            {id: 'f/ctx.md', out: ['f/A.md'], isContext: true},
            {id: 'f/b.md', out: ['f/A.md']},
        ])
        // ctx is skipped; only A and b count.
        expect(countFolderBoundedComponent(graph, 'f/A.md', 'f/')).toBe(2)
    })
})
