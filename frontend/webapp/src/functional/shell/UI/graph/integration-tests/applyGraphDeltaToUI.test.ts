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
import { applyGraphDeltaToUI } from '@/functional/shell/UI/graph/applyGraphDeltaToUI.ts'
import type { GraphDelta, GraphNode } from '@/functional/pure/graph/types.ts'

describe('applyGraphDeltaToUI - Integration', () => {
    let cy: Core

    beforeEach(() => {
        // Initialize headless cytoscape
        cy = cytoscape({
            headless: true,
            elements: []
        })
    })

    afterEach(() => {
        cy.destroy()
    })

    describe('Add new node with parent', () => {
        it('should add a new node with an edge to its parent', () => {
            // GIVEN: Empty graph
            expect(cy.nodes()).toHaveLength(0)

            // Create parent node first
            const parentNode: GraphNode = {
                relativeFilePathIsID: 'parent',
                content: '# Parent GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Parent GraphNode',
                    color: O.none,
                    position: O.some({ x: 100, y: 100 })
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
            const childNode: GraphNode = {
                relativeFilePathIsID: 'child',
                content: '# Child GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Child GraphNode',
                    color: O.none,
                    position: O.some({ x: 200, y: 200 })
                }
            }

            // Update parent to include edge to child
            const parentWithEdge: GraphNode = {
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
        it('should add orphan node without edges', () => {
            // GIVEN: Empty graph
            expect(cy.nodes()).toHaveLength(0)

            // WHEN: Adding an orphan node (no outgoing edges)
            const orphanNode: GraphNode = {
                relativeFilePathIsID: 'orphan',
                content: '# Orphan GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Orphan GraphNode',
                    color: O.none,
                    position: O.some({ x: 300, y: 300 })
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

            // AND: Should have no edges (orphan)
            expect(cy.edges().length).toBe(0)
        })
    })

    describe('Delete node', () => {
        it('should remove a node from the graph', () => {
            // GIVEN: Graph with a node
            const node: GraphNode = {
                relativeFilePathIsID: 'to-delete',
                content: '# GraphNode to Delete',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'GraphNode to Delete',
                    color: O.none,
                    position: O.some({ x: 100, y: 100 })
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

            // THEN: GraphNode should be removed
            expect(cy.getElementById('to-delete').length).toBe(0)
        })
    })

    describe('Update existing node metadata', () => {
        it('should update title and color but preserve position and content', () => {
            // GIVEN: Graph with a node
            const originalNode: GraphNode = {
                relativeFilePathIsID: 'node-to-update',
                content: '# Original Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Original Content',
                    color: O.none,
                    position: O.some({ x: 100, y: 100 })
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

            // WHEN: Updating the node with new title and color
            const updatedNode: GraphNode = {
                relativeFilePathIsID: 'node-to-update',
                content: '# Updated Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Updated Content',
                    color: O.some('#ff0000'),
                    position: O.some({ x: 500, y: 500 }) // Different position
                }
            }

            const updateDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: updatedNode
                }
            ]

            applyGraphDeltaToUI(cy, updateDelta)

            // THEN: Content should remain unchanged (not updated for existing nodes)
            const node = cy.getElementById('node-to-update')
            expect(node.data('content')).toBe('# Original Content')

            // AND: Title (label) should be updated
            expect(node.data('label')).toBe('Updated Content')

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
            expect(cy.nodes()).toHaveLength(0)

            // WHEN: Adding multiple nodes at once
            const node1: GraphNode = {
                relativeFilePathIsID: 'bulk-1',
                content: '# Bulk GraphNode 1',
                outgoingEdges: ['bulk-2'],
                nodeUIMetadata: {
                    title: 'Bulk GraphNode 1',
                    color: O.none,
                    position: O.some({ x: 100, y: 100 })
                }
            }

            const node2: GraphNode = {
                relativeFilePathIsID: 'bulk-2',
                content: '# Bulk GraphNode 2',
                outgoingEdges: ['bulk-3'],
                nodeUIMetadata: {
                    title: 'Bulk GraphNode 2',
                    color: O.some('#00ff00'),
                    position: O.some({ x: 200, y: 200 })
                }
            }

            const node3: GraphNode = {
                relativeFilePathIsID: 'bulk-3',
                content: '# Bulk GraphNode 3',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Bulk GraphNode 3',
                    color: O.none,
                    position: O.some({ x: 300, y: 300 })
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
            const existingNode: GraphNode = {
                relativeFilePathIsID: 'existing',
                content: '# Existing',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Existing',
                    color: O.none,
                    position: O.some({ x: 100, y: 100 })
                }
            }

            const nodeToDelete: GraphNode = {
                relativeFilePathIsID: 'to-delete',
                content: '# Will be deleted',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Will be deleted',
                    color: O.none,
                    position: O.some({ x: 200, y: 200 })
                }
            }

            const setupDelta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: existingNode },
                { type: 'UpsertNode', nodeToUpsert: nodeToDelete }
            ]

            applyGraphDeltaToUI(cy, setupDelta)

            expect(cy.nodes()).toHaveLength(2)

            // WHEN: Applying mixed delta (add new, update existing, delete one)
            const newNode: GraphNode = {
                relativeFilePathIsID: 'new',
                content: '# New GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'New GraphNode',
                    color: O.none,
                    position: O.some({ x: 300, y: 300 })
                }
            }

            const updatedExisting: GraphNode = {
                ...existingNode,
                content: '# Updated Existing',
                nodeUIMetadata: {
                    title: 'Updated Existing',
                    color: O.none,
                    position: O.some({ x: 100, y: 100 })
                }
            }

            const mixedDelta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: newNode },
                { type: 'UpsertNode', nodeToUpsert: updatedExisting },
                { type: 'DeleteNode', nodeId: 'to-delete' }
            ]

            applyGraphDeltaToUI(cy, mixedDelta)

            // THEN: Should have 2 nodes (existing updated + new, deleted removed)
            expect(cy.nodes()).toHaveLength(2)

            // AND: New node should exist
            expect(cy.getElementById('new').length).toBe(1)

            // AND: Existing node content should remain unchanged (content not updated for existing nodes)
            expect(cy.getElementById('existing').data('content')).toBe('# Existing')

            // AND: Existing node title (label) should be updated
            expect(cy.getElementById('existing').data('label')).toBe('Updated Existing')

            // AND: Deleted node should be gone
            expect(cy.getElementById('to-delete').length).toBe(0)
        })
    })

    describe('Edge handling', () => {
        it('should not create duplicate edges', () => {
            // GIVEN: Two nodes with an edge
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                content: '# Parent',
                outgoingEdges: ['child'],
                nodeUIMetadata: {
                    title: 'Parent',
                    color: O.none,
                    position: O.some({ x: 100, y: 100 })
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                content: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Child',
                    color: O.none,
                    position: O.some({ x: 200, y: 200 })
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

    describe('Color validation', () => {
        it('should apply valid CSS colors to nodes', () => {
            // GIVEN: Empty graph
            expect(cy.nodes()).toHaveLength(0)

            // WHEN: Adding nodes with valid CSS colors
            const validColors = ['#ff0000', 'rgb(0, 255, 0)', 'blue', 'cyan', 'hsl(120, 100%, 50%)']

            const nodes: GraphNode[] = validColors.map((color, i) => ({
                relativeFilePathIsID: `node-${i}`,
                content: `# Node ${i}`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: `Node ${i}`,
                    color: O.some(color),
                    position: O.some({ x: i * 100, y: 100 })
                }
            }))

            const delta: GraphDelta = nodes.map(node => ({
                type: 'UpsertNode' as const,
                nodeToUpsert: node
            }))

            applyGraphDeltaToUI(cy, delta)

            // THEN: All nodes should have their colors applied
            validColors.forEach((color, i) => {
                const node = cy.getElementById(`node-${i}`)
                expect(node.data('color')).toBe(color)
            })
        })

        it('should filter out invalid CSS colors', () => {
            // GIVEN: Empty graph
            expect(cy.nodes()).toHaveLength(0)

            // WHEN: Adding nodes with invalid CSS colors
            const invalidColors = ['cyancyan', 'notacolor', '###', 'rgb(999,999,999)', '']

            const nodes: GraphNode[] = invalidColors.map((color, i) => ({
                relativeFilePathIsID: `invalid-${i}`,
                content: `# Invalid ${i}`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: `Invalid ${i}`,
                    color: O.some(color),
                    position: O.some({ x: i * 100, y: 100 })
                }
            }))

            const delta: GraphDelta = nodes.map(node => ({
                type: 'UpsertNode' as const,
                nodeToUpsert: node
            }))

            applyGraphDeltaToUI(cy, delta)

            // THEN: All nodes should have undefined color (invalid colors filtered out)
            invalidColors.forEach((_, i) => {
                const node = cy.getElementById(`invalid-${i}`)
                expect(node.data('color')).toBeUndefined()
            })
        })

        it('should filter out invalid colors when updating existing nodes', () => {
            // GIVEN: Graph with a node with valid color
            const originalNode: GraphNode = {
                relativeFilePathIsID: 'color-update',
                content: '# Original',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Original',
                    color: O.some('#ff0000'),
                    position: O.some({ x: 100, y: 100 })
                }
            }

            const createDelta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: originalNode }
            ]

            applyGraphDeltaToUI(cy, createDelta)
            expect(cy.getElementById('color-update').data('color')).toBe('#ff0000')

            // WHEN: Updating with invalid color
            const updatedNode: GraphNode = {
                relativeFilePathIsID: 'color-update',
                content: '# Updated',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: 'Updated',
                    color: O.some('cyancyan'),
                    position: O.some({ x: 100, y: 100 })
                }
            }

            const updateDelta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: updatedNode }
            ]

            applyGraphDeltaToUI(cy, updateDelta)

            // THEN: Color should be set to undefined (invalid color filtered)
            expect(cy.getElementById('color-update').data('color')).toBeUndefined()
        })
    })
})
