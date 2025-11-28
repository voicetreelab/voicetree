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

    it('should include ASCII tree and accumulate all content from nodes', () => {
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
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        // Should include header, ASCII tree in code block, and accumulated content
        expect(result.contentWithoutYamlOrLinks).toContain('# Merged Node')
        expect(result.contentWithoutYamlOrLinks).toContain('```')
        expect(result.contentWithoutYamlOrLinks).toContain('# First Node\nSome content')
        expect(result.contentWithoutYamlOrLinks).toContain('# Second Node\nMore content')
        expect(result.contentWithoutYamlOrLinks).toContain('---')
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

        expect(result.contentWithoutYamlOrLinks).toContain('# Merged Node')
        expect(result.contentWithoutYamlOrLinks).toContain('# Single Node')
        expect(O.isSome(result.nodeUIMetadata.position)).toBe(true)
        if (O.isSome(result.nodeUIMetadata.position)) {
            expect(result.nodeUIMetadata.position.value).toEqual({ x: 50, y: 75 })
        }
    })

    it('should show ASCII tree with internal edges only', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'parent.md',
                outgoingEdges: [
                    { targetId: 'child.md', label: 'has_child' },
                    { targetId: 'external.md', label: 'external_link' } // This should be filtered out
                ],
                contentWithoutYamlOrLinks: '# Parent Node',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'child.md',
                outgoingEdges: [],
                contentWithoutYamlOrLinks: '# Child Node',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        // ASCII tree should show parent -> child relationship
        expect(result.contentWithoutYamlOrLinks).toContain('Parent Node')
        expect(result.contentWithoutYamlOrLinks).toContain('Child Node')
        // The tree structure should show the hierarchy
        expect(result.contentWithoutYamlOrLinks).toContain('└──')
    })

    it('should include content from nodes with and without headers', () => {
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

        // Should include all content from both nodes
        expect(result.contentWithoutYamlOrLinks).toContain('# Titled Node')
        expect(result.contentWithoutYamlOrLinks).toContain('Just some content without a header')
    })

    it('should preserve external outgoing edges and discard internal ones', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [
                    { targetId: 'external1.md', label: 'external_link1' },
                    { targetId: 'node2.md', label: 'internal_link' } // internal - should be discarded
                ],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [{ targetId: 'external2.md', label: 'external_link2' }],
                contentWithoutYamlOrLinks: '# Node Two',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        // Should have both external edges, but not the internal one
        expect(result.outgoingEdges).toHaveLength(2)
        expect(result.outgoingEdges).toContainEqual({ targetId: 'external1.md', label: 'external_link1' })
        expect(result.outgoingEdges).toContainEqual({ targetId: 'external2.md', label: 'external_link2' })
    })

    it('should deduplicate external edges by targetId', () => {
        const nodes: readonly GraphNode[] = [
            {
                relativeFilePathIsID: 'node1.md',
                outgoingEdges: [{ targetId: 'shared-target.md', label: 'link_from_node1' }],
                contentWithoutYamlOrLinks: '# Node One',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 0, y: 0 }),
                    additionalYAMLProps: new Map()
                }
            },
            {
                relativeFilePathIsID: 'node2.md',
                outgoingEdges: [{ targetId: 'shared-target.md', label: 'link_from_node2' }],
                contentWithoutYamlOrLinks: '# Node Two',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map()
                }
            }
        ]

        const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

        // Should keep only first occurrence when multiple nodes link to same target
        expect(result.outgoingEdges).toHaveLength(1)
        expect(result.outgoingEdges[0].targetId).toBe('shared-target.md')
        expect(result.outgoingEdges[0].label).toBe('link_from_node1') // keeps first
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

    describe('merge title generation', () => {
        it('should use "Merged Node" title when no mergeTitleInfo provided', () => {
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
                        position: O.some({ x: 100, y: 100 }),
                        additionalYAMLProps: new Map()
                    }
                }
            ]

            const result: GraphNode = createRepresentativeNode(nodes, 'merged.md')

            expect(result.contentWithoutYamlOrLinks).toContain('# Merged Node')
        })

        it('should use representative parent title with "+ N other nodes" format', () => {
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
                        position: O.some({ x: 100, y: 100 }),
                        additionalYAMLProps: new Map()
                    }
                },
                {
                    relativeFilePathIsID: 'node3.md',
                    outgoingEdges: [],
                    contentWithoutYamlOrLinks: '# Node Three',
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.some({ x: 200, y: 200 }),
                        additionalYAMLProps: new Map()
                    }
                }
            ]

            const result: GraphNode = createRepresentativeNode(nodes, 'merged.md', {
                representativeTitle: 'Parent Node',
                otherNodesCount: 2
            })

            expect(result.contentWithoutYamlOrLinks).toContain('# Parent Node + 2 other nodes')
        })

        it('should use singular "node" when otherNodesCount is 1', () => {
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
                        position: O.some({ x: 100, y: 100 }),
                        additionalYAMLProps: new Map()
                    }
                }
            ]

            const result: GraphNode = createRepresentativeNode(nodes, 'merged.md', {
                representativeTitle: 'My Parent',
                otherNodesCount: 1
            })

            expect(result.contentWithoutYamlOrLinks).toContain('# My Parent + 1 other node')
            expect(result.contentWithoutYamlOrLinks).not.toContain('other nodes')
        })

        it('should use just the representative title when otherNodesCount is 0', () => {
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

            const result: GraphNode = createRepresentativeNode(nodes, 'merged.md', {
                representativeTitle: 'Solo Parent',
                otherNodesCount: 0
            })

            expect(result.contentWithoutYamlOrLinks).toContain('# Solo Parent')
            expect(result.contentWithoutYamlOrLinks).not.toContain('+ 0')
        })
    })
})
