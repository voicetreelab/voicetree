import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import { removeNodeMaintainingTransitiveEdges } from './removeNodeMaintainingTransitiveEdges'

function createNode(id: string, outgoingEdges: readonly { readonly targetId: string; readonly label: string }[] = []): GraphNode {
    return {
        relativeFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

describe('removeNodeMaintainingTransitiveEdges', () => {
    describe('simple chain: a -> b -> c', () => {
        it('should connect parent to children when middle node is removed', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = removeNodeMaintainingTransitiveEdges(graph, 'b.md')

            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('extends')
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('multiple children: a -> b -> {c, d}', () => {
        it('should connect parent to all children of removed node', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'parent-of' }]),
                    'b.md': createNode('b.md', [
                        { targetId: 'c.md', label: 'child1' },
                        { targetId: 'd.md', label: 'child2' }
                    ]),
                    'c.md': createNode('c.md', []),
                    'd.md': createNode('d.md', [])
                }
            }

            const result: Graph = removeNodeMaintainingTransitiveEdges(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(2)
            const targetIds: readonly NodeIdAndFilePath[] = result.nodes['a.md'].outgoingEdges.map(e => e.targetId)
            expect(targetIds).toContain('c.md')
            expect(targetIds).toContain('d.md')
            expect(result.nodes['a.md'].outgoingEdges.every(e => e.label === 'parent-of')).toBe(true)
        })
    })

    describe('multiple parents: {a, x} -> b -> c', () => {
        it('should connect all parents to children of removed node', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'label-a' }]),
                    'x.md': createNode('x.md', [{ targetId: 'b.md', label: 'label-x' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = removeNodeMaintainingTransitiveEdges(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('label-a')

            expect(result.nodes['x.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['x.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['x.md'].outgoingEdges[0].label).toBe('label-x')
        })
    })

    describe('edge cases', () => {
        it('should not create duplicate edges if parent already connects to child', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [
                        { targetId: 'b.md', label: 'via-b' },
                        { targetId: 'c.md', label: 'direct' }
                    ]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = removeNodeMaintainingTransitiveEdges(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('direct')
        })

        it('should handle removal of leaf node', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'to-b' }]),
                    'b.md': createNode('b.md', [])
                }
            }

            const result: Graph = removeNodeMaintainingTransitiveEdges(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })

        it('should handle removal of root node', () => {
            const graph: Graph = {
                nodes: {
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = removeNodeMaintainingTransitiveEdges(graph, 'b.md')

            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })

        it('should return unchanged graph if node does not exist', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'test' }]),
                    'b.md': createNode('b.md', [])
                }
            }

            const result: Graph = removeNodeMaintainingTransitiveEdges(graph, 'nonexistent.md')

            expect(result.nodes).toEqual(graph.nodes)
        })
    })
})
