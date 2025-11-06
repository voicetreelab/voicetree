/**
 * Integration Test: applyGraphDeltaToUI
 *
 * BEHAVIOR TESTED:
 * - INPUT: GraphDelta with various node actions (UpsertNode, DeleteNode)
 * - OUTPUT: Cytoscape graph is updated correctly
 * - CASES: Add node with parent, add orphan node, delete node, bulk operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {Core} from 'cytoscape';
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { applyGraphDeltaToUI } from '@/functional_graph/shell/UI/applyGraphDeltaToUI'
import type { GraphDelta, Node } from '@/functional_graph/pure/types'
import { GHOST_ROOT_ID } from '@/graph-core/constants'

describe('applyGraphDeltaToUI - Integration', () => {
    let cy: Core

    beforeEach(() => {
        // Initialize headless cytoscape with ghost root
        cy = cytoscape({
            headless: true,
            elements: [
                {
                    group: 'nodes' as const,
                    data: {
                        id: GHOST_ROOT_ID,
                        label: '',
                        linkedNodeIds: [],
                        isGhostRoot: true
                    },
                    position: { x: 0, y: 0 }
                }
            ]
        })
    })

    afterEach(() => {
        cy.destroy()
    })

    describe('Add new node with parent', () => {
        it('should add a new node with an edge to its parent', () => {
            // GIVEN: Empty graph with just ghost root
            expect(cy.nodes().filter(n => n.id() !== GHOST_ROOT_ID)).toHaveLength(0)

            // Create parent node first
            const parentNode: Node = {
                idAndFilePath: 'parent',
                content: '# Parent Node',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 100, y: 100 }
                }
            }

            const parentDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: parentNode
                }
            ]

            applyGraphDeltaToUI(cy, parentDelta)

            // Create child node with edge to parent
            const childNode: Node = {
                idAndFilePath: 'child',
                content: '# Child Node',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 200, y: 200 }
                }
            }

            // Update parent to include edge to child
            const parentWithEdge: Node = {
                ...parentNode,
                outgoingEdges: ['child']
            }

            const childDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: childNode
                },
                {
                    type: 'UpsertNode',
                    nodeToUpsert: parentWithEdge
                }
            ]

            // WHEN: Applying the delta
            applyGraphDeltaToUI(cy, childDelta)

            // THEN: Both nodes should exist
            expect(cy.getElementById('parent').length).toBe(1)
            expect(cy.getElementById('child').length).toBe(1)

            // AND: Edge from parent to child should exist
            const edge = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('source')).toBe('parent')
            expect(edge.data('target')).toBe('child')

            // AND: Child node should have correct position
            const childPos = cy.getElementById('child').position()
            expect(childPos.x).toBe(200)
            expect(childPos.y).toBe(200)
        })
    })

    describe('Add orphan node (no parent)', () => {
        it('should add orphan node and connect it to ghost root', () => {
            // GIVEN: Empty graph with ghost root
            expect(cy.nodes().filter(n => n.id() !== GHOST_ROOT_ID)).toHaveLength(0)

            // WHEN: Adding an orphan node (no outgoing edges)
            const orphanNode: Node = {
                idAndFilePath: 'orphan',
                content: '# Orphan Node',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 300, y: 300 }
                }
            }

            const delta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: orphanNode
                }
            ]

            applyGraphDeltaToUI(cy, delta)

            // THEN: Orphan node should exist
            expect(cy.getElementById('orphan').length).toBe(1)

            // AND: Should be connected to ghost root
            const ghostEdge = cy.getElementById(`${GHOST_ROOT_ID}->orphan`)
            expect(ghostEdge.length).toBe(1)
            expect(ghostEdge.data('source')).toBe(GHOST_ROOT_ID)
            expect(ghostEdge.data('target')).toBe('orphan')
            expect(ghostEdge.data('isGhostEdge')).toBe(true)
        })
    })

    describe('Delete node', () => {
        it('should remove a node from the graph', () => {
            // GIVEN: Graph with a node
            const node: Node = {
                idAndFilePath: 'to-delete',
                content: '# Node to Delete',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 100, y: 100 }
                }
            }

            const addDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: node
                }
            ]

            applyGraphDeltaToUI(cy, addDelta)
            expect(cy.getElementById('to-delete').length).toBe(1)

            // WHEN: Deleting the node
            const deleteDelta: GraphDelta = [
                {
                    type: 'DeleteNode',
                    nodeId: 'to-delete'
                }
            ]

            applyGraphDeltaToUI(cy, deleteDelta)

            // THEN: Node should be removed
            expect(cy.getElementById('to-delete').length).toBe(0)
        })
    })

    describe('Update existing node metadata', () => {
        it('should update content and color but preserve position', () => {
            // GIVEN: Graph with a node
            const originalNode: Node = {
                idAndFilePath: 'node-to-update',
                content: '# Original Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 100, y: 100 }
                }
            }

            const addDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: originalNode
                }
            ]

            applyGraphDeltaToUI(cy, addDelta)

            const originalPos = cy.getElementById('node-to-update').position()
            expect(originalPos.x).toBe(100)
            expect(originalPos.y).toBe(100)

            // WHEN: Updating the node with new content and color
            const updatedNode: Node = {
                idAndFilePath: 'node-to-update',
                content: '# Updated Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('#ff0000'),
                    position: { x: 500, y: 500 } // Different position
                }
            }

            const updateDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: updatedNode
                }
            ]

            applyGraphDeltaToUI(cy, updateDelta)

            // THEN: Content should be updated
            const node = cy.getElementById('node-to-update')
            expect(node.data('content')).toBe('# Updated Content')

            // AND: Color should be updated
            expect(node.data('color')).toBe('#ff0000')

            // BUT: Position should remain unchanged (preserved from original)
            const newPos = node.position()
            expect(newPos.x).toBe(100) // Original position preserved
            expect(newPos.y).toBe(100) // Original position preserved
        })
    })

    describe('Bulk operations', () => {
        it('should handle multiple node additions in one delta', () => {
            // GIVEN: Empty graph
            expect(cy.nodes().filter(n => n.id() !== GHOST_ROOT_ID)).toHaveLength(0)

            // WHEN: Adding multiple nodes at once
            const node1: Node = {
                idAndFilePath: 'bulk-1',
                content: '# Bulk Node 1',
                outgoingEdges: ['bulk-2'],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 100, y: 100 }
                }
            }

            const node2: Node = {
                idAndFilePath: 'bulk-2',
                content: '# Bulk Node 2',
                outgoingEdges: ['bulk-3'],
                nodeUIMetadata: {
                    color: O.some('#00ff00'),
                    position: { x: 200, y: 200 }
                }
            }

            const node3: Node = {
                idAndFilePath: 'bulk-3',
                content: '# Bulk Node 3',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 300, y: 300 }
                }
            }

            const bulkDelta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: node1 },
                { type: 'UpsertNode', nodeToUpsert: node2 },
                { type: 'UpsertNode', nodeToUpsert: node3 }
            ]

            applyGraphDeltaToUI(cy, bulkDelta)

            // THEN: All nodes should exist
            expect(cy.getElementById('bulk-1').length).toBe(1)
            expect(cy.getElementById('bulk-2').length).toBe(1)
            expect(cy.getElementById('bulk-3').length).toBe(1)

            // AND: Edges should be created
            expect(cy.getElementById('bulk-1->bulk-2').length).toBe(1)
            expect(cy.getElementById('bulk-2->bulk-3').length).toBe(1)

            // AND: Colors should be set
            expect(cy.getElementById('bulk-2').data('color')).toBe('#00ff00')
        })

        it('should handle mixed operations (add, update, delete) in one delta', () => {
            // GIVEN: Graph with 2 nodes
            const existingNode: Node = {
                idAndFilePath: 'existing',
                content: '# Existing',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 100, y: 100 }
                }
            }

            const nodeToDelete: Node = {
                idAndFilePath: 'to-delete',
                content: '# Will be deleted',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 200, y: 200 }
                }
            }

            const setupDelta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: existingNode },
                { type: 'UpsertNode', nodeToUpsert: nodeToDelete }
            ]

            applyGraphDeltaToUI(cy, setupDelta)

            expect(cy.nodes().filter(n => n.id() !== GHOST_ROOT_ID)).toHaveLength(2)

            // WHEN: Applying mixed delta (add new, update existing, delete one)
            const newNode: Node = {
                idAndFilePath: 'new',
                content: '# New Node',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 300, y: 300 }
                }
            }

            const updatedExisting: Node = {
                ...existingNode,
                content: '# Updated Existing'
            }

            const mixedDelta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: newNode },
                { type: 'UpsertNode', nodeToUpsert: updatedExisting },
                { type: 'DeleteNode', nodeId: 'to-delete' }
            ]

            applyGraphDeltaToUI(cy, mixedDelta)

            // THEN: Should have 2 nodes (existing updated + new, deleted removed)
            expect(cy.nodes().filter(n => n.id() !== GHOST_ROOT_ID)).toHaveLength(2)

            // AND: New node should exist
            expect(cy.getElementById('new').length).toBe(1)

            // AND: Existing node should be updated
            expect(cy.getElementById('existing').data('content')).toBe('# Updated Existing')

            // AND: Deleted node should be gone
            expect(cy.getElementById('to-delete').length).toBe(0)
        })
    })

    describe('Edge handling', () => {
        it('should not create duplicate edges', () => {
            // GIVEN: Two nodes with an edge
            const parent: Node = {
                idAndFilePath: 'parent',
                content: '# Parent',
                outgoingEdges: ['child'],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 100, y: 100 }
                }
            }

            const child: Node = {
                idAndFilePath: 'child',
                content: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: { x: 200, y: 200 }
                }
            }

            const delta1: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: parent },
                { type: 'UpsertNode', nodeToUpsert: child }
            ]

            applyGraphDeltaToUI(cy, delta1)

            // WHEN: Applying the same delta again (upsert parent again)
            applyGraphDeltaToUI(cy, delta1)

            // THEN: Should only have one edge
            const edges = cy.edges(`[id = "parent->child"]`)
            expect(edges.length).toBe(1)
        })
    })
})
