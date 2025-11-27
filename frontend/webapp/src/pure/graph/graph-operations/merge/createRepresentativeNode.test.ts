import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { createRepresentativeNode } from './createRepresentativeNode'
import type { GraphNode } from '@/pure/graph'

describe('createRepresentativeNode', () => {
    it('should calculate centroid position from two nodes with positions', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node Two',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 200 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(O.isSome(result.nodeUIMetadata.position)).toBe(true)
        if (O.isSome(result.nodeUIMetadata.position)) {
            expect(result.nodeUIMetadata.position.value).toEqual({ x: 50, y: 100 })
        }
    })

    it('should combine node titles in content', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# First Node\nSome content',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Second Node\nMore content',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node3.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Third Node',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(result.contentWithoutYamlOrLinks).toBe('# Merged: First Node, Second Node, Third Node')
    })

    it('should exclude nodes without positions from centroid calculation', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node Two',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node3.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node Three',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 200 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(O.isSome(result.nodeUIMetadata.position)).toBe(true)
        if (O.isSome(result.nodeUIMetadata.position)) {
            expect(result.nodeUIMetadata.position.value).toEqual({ x: 50, y: 100 })
        }
    })

    it('should handle single node', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Single Node',
                nodeUIMetadata: {
                    color: O.some('#ff0000'),
                    position: O.some({ x: 50, y: 75 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(result.contentWithoutYamlOrLinks).toBe('# Merged: Single Node')
        expect(O.isSome(result.nodeUIMetadata.position)).toBe(true)
        if (O.isSome(result.nodeUIMetadata.position)) {
            expect(result.nodeUIMetadata.position.value).toEqual({ x: 50, y: 75 })
        }
    })

    it('should handle nodes with and without headers', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Titled Node',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: 'Just some content without a header',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(result.contentWithoutYamlOrLinks).toBe('# Merged: Titled Node, Untitled')
    })

    it('should create representative with no outgoing edges', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [{ targetId: 'target1.md', label: 'link1' }],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [{ targetId: 'target2.md', label: 'link2' }],
                contentWithoutYamlOrLinks: '# Node Two',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(result.outgoingEdges).toEqual([])
    })

    it('should use new node ID as relativeFilePathIsID', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'my-merged-node.md')

        expect(result.relativeFilePathIsID).toBe('my-merged-node.md')
    })

    it('should use first nodes color if it has one', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.some('#ff0000'),
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node Two',
                nodeUIMetadata: {
                    color: O.some('#00ff00'),
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(O.isSome(result.nodeUIMetadata.color)).toBe(true)
        if (O.isSome(result.nodeUIMetadata.color)) {
            expect(result.nodeUIMetadata.color.value).toBe('#ff0000')
        }
    })

    it('should set isContextNode to false and containedNodeIds to undefined', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        expect(result.nodeUIMetadata.isContextNode).toBe(false)
        expect(result.nodeUIMetadata.containedNodeIds).toBeUndefined()
    })
})
