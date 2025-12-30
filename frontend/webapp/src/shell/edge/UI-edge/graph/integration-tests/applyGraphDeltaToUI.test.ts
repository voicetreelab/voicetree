/**
 * Integration Test: applyGraphDeltaToUI
 *
 * BEHAVIOR TESTED:
 * - INPUT: GraphDelta with various node actions (UpsertNode, DeleteNode)
 * - OUTPUT: Cytoscape graph is updated correctly
 * - CASES: Add node with parent, add orphan node, delete node, bulk operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {Core} from 'cytoscape';
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'
import type { GraphDelta, GraphNode, UpsertNodeDelta, DeleteNode } from '@/pure/graph'
import { BreathingAnimationService, AnimationType } from '@/shell/UI/cytoscape-graph-ui/services/BreathingAnimationService'

// Mock engagement prompts to avoid jsdom's missing dialog.showModal()
vi.mock('@/shell/edge/UI-edge/graph/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn()
}))

// Helper functions to create delta actions with required Option fields
function upsert(node: GraphNode): UpsertNodeDelta {
    return { type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }
}

function del(nodeId: string): DeleteNode {
    return { type: 'DeleteNode', nodeId, deletedNode: O.none }
}

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
                contentWithoutYamlOrLinks: '# Parent GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const parentDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: parentNode,
                    previousNode: O.none
                }
            ]

            applyGraphDeltaToUI(cy, parentDelta)

            // Create child node with edge to parent
            const childNode: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            // Update parent to include edge to child
            const parentWithEdge: GraphNode = {
                ...parentNode,
                outgoingEdges: [{ targetId: 'child', label: '' }]
            }

            const childDelta: GraphDelta = [
                upsert(childNode),
                upsert(parentWithEdge)
            ]

            // WHEN: Applying the delta
            applyGraphDeltaToUI(cy, childDelta)

            // THEN: Both nodes should exist
            expect(cy.getElementById('parent').length).toBe(1)
            expect(cy.getElementById('child').length).toBe(1)

            // AND: Edge from parent to child should exist
            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('source')).toBe('parent')
            expect(edge.data('target')).toBe('child')

            // AND: Child node should have correct position
            const childPos: cytoscape.Position = cy.getElementById('child').position()
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
                contentWithoutYamlOrLinks: '# Orphan GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 300, y: 300 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: orphanNode,
                    previousNode: O.none
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
                contentWithoutYamlOrLinks: '# GraphNode to Delete',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const addDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: node,
                    previousNode: O.none
                }
            ]

            applyGraphDeltaToUI(cy, addDelta)
            expect(cy.getElementById('to-delete').length).toBe(1)

            // WHEN: Deleting the node
            const deleteDelta: GraphDelta = [
                {
                    type: 'DeleteNode',
                    nodeId: 'to-delete',
                    deletedNode: O.none
                }
            ]

            applyGraphDeltaToUI(cy, deleteDelta)

            // THEN: GraphNode should be removed
            expect(cy.getElementById('to-delete').length).toBe(0)
        })
    })

    describe('Update existing node metadata', () => {
        it('should update title, content and color but preserve position', () => {
            // GIVEN: Graph with a node
            const originalNode: GraphNode = {
                relativeFilePathIsID: 'node-to-update',
                contentWithoutYamlOrLinks: '# Original Content',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const addDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: originalNode,
                    previousNode: O.none
                }
            ]

            applyGraphDeltaToUI(cy, addDelta)

            const originalPos: cytoscape.Position = cy.getElementById('node-to-update').position()
            expect(originalPos.x).toBe(100)
            expect(originalPos.y).toBe(100)

            // WHEN: Updating the node with new title and color
            const updatedNode: GraphNode = {
                relativeFilePathIsID: 'node-to-update',
                contentWithoutYamlOrLinks: '# Updated Content',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.some('#ff0000'),
                    position: O.some({ x: 500, y: 500 }), // Different position
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const updateDelta: GraphDelta = [
                {
                    type: 'UpsertNode',
                    nodeToUpsert: updatedNode,
                    previousNode: O.none
                }
            ]

            applyGraphDeltaToUI(cy, updateDelta)

            // THEN: Content should be updated
            const node: cytoscape.CollectionReturnValue = cy.getElementById('node-to-update')
            expect(node.data('content')).toBe('# Updated Content')

            // AND: Title (label) should be updated
            expect(node.data('label')).toBe('Updated Content')

            // AND: Color should be updated
            expect(node.data('color')).toBe('#ff0000')

            // BUT: Position should remain unchanged (preserved from original)
            const newPos: cytoscape.Position = node.position()
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
                contentWithoutYamlOrLinks: '# Bulk GraphNode 1',
                outgoingEdges: [{ targetId: 'bulk-2', label: '' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const node2: GraphNode = {
                relativeFilePathIsID: 'bulk-2',
                contentWithoutYamlOrLinks: '# Bulk GraphNode 2',
                outgoingEdges: [{ targetId: 'bulk-3', label: '' }],
                nodeUIMetadata: {

                    color: O.some('#00ff00'),
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const node3: GraphNode = {
                relativeFilePathIsID: 'bulk-3',
                contentWithoutYamlOrLinks: '# Bulk GraphNode 3',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 300, y: 300 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const bulkDelta: GraphDelta = [
                upsert(node1),
                upsert(node2),
                upsert(node3)
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
                contentWithoutYamlOrLinks: '# Existing',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const nodeToDelete: GraphNode = {
                relativeFilePathIsID: 'to-delete',
                contentWithoutYamlOrLinks: '# Will be deleted',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const setupDelta: GraphDelta = [
                upsert(existingNode),
                upsert(nodeToDelete)
            ]

            applyGraphDeltaToUI(cy, setupDelta)

            expect(cy.nodes()).toHaveLength(2)

            // WHEN: Applying mixed delta (add new, update existing, delete one)
            const newNode: GraphNode = {
                relativeFilePathIsID: 'new',
                contentWithoutYamlOrLinks: '# New GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 300, y: 300 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const updatedExisting: GraphNode = {
                ...existingNode,
                contentWithoutYamlOrLinks: '# Updated Existing',
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const mixedDelta: GraphDelta = [
                upsert(newNode),
                upsert(updatedExisting),
                del('to-delete')
            ]

            applyGraphDeltaToUI(cy, mixedDelta)

            // THEN: Should have 2 nodes (existing updated + new, deleted removed)
            expect(cy.nodes()).toHaveLength(2)

            // AND: New node should exist
            expect(cy.getElementById('new').length).toBe(1)

            // AND: Existing node content should be updated
            expect(cy.getElementById('existing').data('content')).toBe('# Updated Existing')

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
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: '' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta1: GraphDelta = [
                upsert(parent),
                upsert(child)
            ]

            applyGraphDeltaToUI(cy, delta1)

            // WHEN: Applying the same delta again (upsert parent again)
            applyGraphDeltaToUI(cy, delta1)

            // THEN: Should only have one edge
            const edges: cytoscape.EdgeCollection = cy.edges(`[id = "parent->child"]`)
            expect(edges.length).toBe(1)
        })

        it('should not throw when same node appears twice in delta (healing scenario)', () => {
            // This test reproduces the bug where addNodeToGraph returns a delta with the same
            // node appearing twice (once as the new node, once as a "healed" node), causing
            // duplicate edge creation that throws Cytoscape error.
            // Example: parent has edge to child, when child is added, parent is also "healed"
            // and re-added to the delta. If both entries have the same edge, it would throw.

            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'test-label' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            // WHEN: Same parent node appears twice in the same delta (simulates healing scenario)
            const deltaWithDuplicateNode: GraphDelta = [
                upsert(child),
                upsert(parent),
                upsert(parent)  // Parent appears again (healed)
            ]

            // THEN: Should not throw "Can not create second element with ID" error
            expect(() => applyGraphDeltaToUI(cy, deltaWithDuplicateNode)).not.toThrow()

            // AND: Should only have one edge
            const edges: cytoscape.EdgeCollection = cy.edges(`[id = "parent->child"]`)
            expect(edges.length).toBe(1)
        })

        it('should not throw when same edge is in two consecutive deltas (file watcher race)', () => {
            // This simulates the scenario where two file changes trigger two deltas
            // and both include the same parent node with edge to child (due to healing)

            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: '' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            // Delta 1: Child arrives with parent (healed) included
            const delta1: GraphDelta = [
                upsert(child),
                upsert(parent)
            ]
            applyGraphDeltaToUI(cy, delta1)

            // Delta 2: Parent file change causes parent to be re-sent
            const delta2: GraphDelta = [
                upsert(parent)
            ]

            // THEN: Should not throw "Can not create second element with ID" error
            expect(() => applyGraphDeltaToUI(cy, delta2)).not.toThrow()

            // AND: Should only have one edge
            const edges: cytoscape.EdgeCollection = cy.edges(`[id = "parent->child"]`)
            expect(edges.length).toBe(1)
        })

        it('should set edge label when creating edges with non-empty labels', () => {
            // GIVEN: Two nodes
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'is parent of' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [
                upsert(parent),
                upsert(child)
            ]

            // WHEN: Creating nodes with labeled edge
            applyGraphDeltaToUI(cy, delta)

            // THEN: Edge should have the label
            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('is parent of')
        })

        it('should not set label when edge has empty label', () => {
            // GIVEN: Two nodes with empty label edge
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: '' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [
                upsert(parent),
                upsert(child)
            ]

            // WHEN: Creating nodes with empty label edge
            applyGraphDeltaToUI(cy, delta)

            // THEN: Edge should not have label set (undefined)
            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBeUndefined()
        })

        it('should replace underscores with spaces in edge labels', () => {
            // GIVEN: Two nodes with edge label containing underscores
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'is_a_prerequisite_for' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [
                upsert(parent),
                upsert(child)
            ]

            // WHEN: Creating edge with underscores in label
            applyGraphDeltaToUI(cy, delta)

            // THEN: Edge label should have underscores replaced with spaces
            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('is a prerequisite for')
        })

        it('should handle edge labels with multiple underscores', () => {
            // GIVEN: Two nodes with complex label
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'this_is_a_complex_relationship_label' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [
                upsert(parent),
                upsert(child)
            ]

            // WHEN: Creating edge with multiple underscores
            applyGraphDeltaToUI(cy, delta)

            // THEN: All underscores should be replaced with spaces
            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('this is a complex relationship label')
        })

        it('should handle edge labels without underscores', () => {
            // GIVEN: Two nodes with label without underscores
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'simple label' }],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [
                upsert(parent),
                upsert(child)
            ]

            // WHEN: Creating edge without underscores
            applyGraphDeltaToUI(cy, delta)

            // THEN: Label should remain unchanged
            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('simple label')
        })

        it('should update edge label when relationship label changes in markdown', () => {
            // GIVEN: Two nodes with an edge labeled "parent_of"
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'parent_of' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                relativeFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyGraphDeltaToUI(cy, [upsert(parent), upsert(child)])

            // Verify initial label
            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.data('label')).toBe('parent of')

            // WHEN: Updating the parent node with a new edge label
            const updatedParent: GraphNode = {
                ...parent,
                outgoingEdges: [{ targetId: 'child', label: 'is_prerequisite_for' }]
            }

            applyGraphDeltaToUI(cy, [upsert(updatedParent)])

            // THEN: Edge label should be updated to the new value
            expect(edge.data('label')).toBe('is prerequisite for')
        })

        // todo, we might not be handling the case where the shadow node has been closed/removed?
        // human: DO NOT REMOVE THIS TEST - it catches a critical bug where edges to floating
        // human: windows (terminals/editors) were incorrectly deleted during graph sync.
        // human: Shadow nodes are UI-only anchors not tracked in the graph model.
        it('should NOT remove edges to shadow nodes (floating terminals/editors)', () => {
            // GIVEN: A parent node in the graph
            const parent: GraphNode = {
                relativeFilePathIsID: 'parent.md',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyGraphDeltaToUI(cy, [upsert(parent)])

            // AND: A shadow node (floating window anchor) with edge from parent
            // This simulates what anchorToNode() creates for terminals/editors
            cy.add({
                group: 'nodes',
                data: {
                    id: 'shadow-child-parent.md-parent.md-terminal-0',
                    isShadowNode: true,
                    isFloatingWindow: true,
                    windowType: 'Terminal'
                },
                position: { x: 150, y: 150 }
            })

            cy.add({
                group: 'edges',
                data: {
                    id: 'edge-parent.md-shadow-child-parent.md-parent.md-terminal-0',
                    source: 'parent.md',
                    target: 'shadow-child-parent.md-parent.md-terminal-0'
                }
            })

            expect(cy.edges().length).toBe(1)

            // WHEN: Parent is updated (e.g., file changed on disk)
            // The graph model knows nothing about shadow nodes, so outgoingEdges is empty
            applyGraphDeltaToUI(cy, [upsert(parent)])

            // THEN: Edge to shadow node should be preserved (not removed)
            expect(cy.edges().length).toBe(1)
            expect(cy.getElementById('edge-parent.md-shadow-child-parent.md-parent.md-terminal-0').length).toBe(1)
        })

        it('should handle edge lifecycle: creation after target exists, persistence on update, removal on link delete', () => {
            // Helper to create node with minimal boilerplate
            const makeNode: (id: string, edges?: Array<{ targetId: string; label: string; }>) => GraphNode = (id: string, edges: Array<{targetId: string, label: string}> = []): GraphNode => ({
                relativeFilePathIsID: id,
                contentWithoutYamlOrLinks: `# ${id}`,
                outgoingEdges: edges,
                nodeUIMetadata: { color: O.none, position: O.some({ x: 0, y: 0 }), additionalYAMLProps: new Map(), isContextNode: false }
            })

            // CASE 1: Edge created when child arrives in same delta as parent update (race condition fix)
            // Simulates: parent delta arrived first (edge skipped), now child delta includes parent
            applyGraphDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: makeNode('parent', [{ targetId: 'child', label: '' }]), previousNode: O.none }])
            expect(cy.edges().length).toBe(0) // Edge skipped - child doesn't exist yet

            applyGraphDeltaToUI(cy, [
                { type: 'UpsertNode', nodeToUpsert: makeNode('child'), previousNode: O.none },
                { type: 'UpsertNode', nodeToUpsert: makeNode('parent', [{ targetId: 'child', label: '' }]), previousNode: O.none } // Parent re-sent with child
            ])
            expect(cy.edges().length).toBe(1) // Edge now created
            expect(cy.getElementById('parent->child').length).toBe(1)

            // CASE 2: Edge persists when node updated but link remains (what old "race condition protection" tried to cover)
            applyGraphDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: { ...makeNode('parent', [{ targetId: 'child', label: '' }]), contentWithoutYamlOrLinks: '# Parent Updated' }, previousNode: O.none }])
            expect(cy.edges().length).toBe(1) // Edge still exists
            expect(cy.getElementById('parent').data('label')).toBe('Parent Updated') // Label derived from updated content

            // CASE 3: Edge removed when wikilink deleted from markdown
            applyGraphDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: makeNode('parent', []), previousNode: O.none }]) // No more edges
            expect(cy.edges().length).toBe(0) // Edge removed
            expect(cy.getElementById('parent').length).toBe(1) // Parent still exists
            expect(cy.getElementById('child').length).toBe(1) // Child still exists
        })
    })

    describe('Color validation', () => {
        it('should apply valid CSS colors to nodes', () => {
            // GIVEN: Empty graph
            expect(cy.nodes()).toHaveLength(0)

            // WHEN: Adding nodes with valid CSS colors
            const validColors: string[] = ['#ff0000', 'rgb(0, 255, 0)', 'blue', 'cyan', 'hsl(120, 100%, 50%)']

            const nodes: GraphNode[] = validColors.map((color, i) => ({
                relativeFilePathIsID: `node-${i}`,
                contentWithoutYamlOrLinks: `# Node ${i}`,
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.some(color),
                    position: O.some({ x: i * 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }))

            const delta: GraphDelta = nodes.map(node => ({
                type: 'UpsertNode' as const,
                nodeToUpsert: node,
                previousNode: O.none
            }))

            applyGraphDeltaToUI(cy, delta)

            // THEN: All nodes should have their colors applied
            validColors.forEach((color, i) => {
                const node: cytoscape.CollectionReturnValue = cy.getElementById(`node-${i}`)
                expect(node.data('color')).toBe(color)
            })
        })

        it('should filter out invalid CSS colors', () => {
            // GIVEN: Empty graph
            expect(cy.nodes()).toHaveLength(0)

            // WHEN: Adding nodes with invalid CSS colors
            const invalidColors: string[] = ['cyancyan', 'notacolor', '###', 'rgb(999,999,999)', '']

            const nodes: GraphNode[] = invalidColors.map((color, i) => ({
                relativeFilePathIsID: `invalid-${i}`,
                contentWithoutYamlOrLinks: `# Invalid ${i}`,
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.some(color),
                    position: O.some({ x: i * 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }))

            const delta: GraphDelta = nodes.map(node => ({
                type: 'UpsertNode' as const,
                nodeToUpsert: node,
                previousNode: O.none
            }))

            applyGraphDeltaToUI(cy, delta)

            // THEN: All nodes should have undefined color (invalid colors filtered out)
            invalidColors.forEach((_, i) => {
                const node: cytoscape.CollectionReturnValue = cy.getElementById(`invalid-${i}`)
                expect(node.data('color')).toBeUndefined()
            })
        })

        it('should filter out invalid colors when updating existing nodes', () => {
            // GIVEN: Graph with a node with valid color
            const originalNode: GraphNode = {
                relativeFilePathIsID: 'color-update',
                contentWithoutYamlOrLinks: '# Original',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.some('#ff0000'),
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const createDelta: GraphDelta = [
                upsert(originalNode)
            ]

            applyGraphDeltaToUI(cy, createDelta)
            expect(cy.getElementById('color-update').data('color')).toBe('#ff0000')

            // WHEN: Updating with invalid color
            const updatedNode: GraphNode = {
                relativeFilePathIsID: 'color-update',
                contentWithoutYamlOrLinks: '# Updated',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.some('cyancyan'),
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const updateDelta: GraphDelta = [
                upsert(updatedNode)
            ]

            applyGraphDeltaToUI(cy, updateDelta)

            // THEN: Color should be set to undefined (invalid color filtered)
            expect(cy.getElementById('color-update').data('color')).toBeUndefined()
        })
    })

    describe('Scientific notation position parsing', () => {
        it('should correctly position node with scientific notation coordinates from real example file', () => {
            // GIVEN: Empty graph
            expect(cy.nodes()).toHaveLength(0)

            // WHEN: Adding a node with scientific notation position (from real example file)
            // Content modeled after: example_folder_fixtures/example_real_large/2025-09-30/14_1_Victor_Append_Agent_Extraction_Analysis_Complete.md
            const nodeWithScientificNotation: GraphNode = {
                relativeFilePathIsID: '14_1_Victor_Append_Agent_Extraction_Analysis_Complete.md',
                contentWithoutYamlOrLinks: '# Victor Append Agent Extraction Analysis Complete',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('orange'),
                    position: O.some({ x: -9.184850993605149e-14, y: -500 }),
                    additionalYAMLProps: new Map([['agent_name', 'Victor'], ['node_id', '141']]),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [upsert(nodeWithScientificNotation)]
            applyGraphDeltaToUI(cy, delta)

            // THEN: Node should exist
            const node: cytoscape.CollectionReturnValue = cy.getElementById('14_1_Victor_Append_Agent_Extraction_Analysis_Complete.md')
            expect(node.length).toBe(1)

            // AND: Position should be correctly parsed (scientific notation ~= 0)
            const pos: cytoscape.Position = node.position()
            expect(pos.x).toBeCloseTo(0, 10) // -9.18e-14 is effectively 0
            expect(pos.y).toBe(-500)

            // AND: Color should be set
            expect(node.data('color')).toBe('orange')
        })

        it('should correctly position node with small positive scientific notation', () => {
            // Content modeled after: example_folder_fixtures/example_small/5_Immediate_Test_Observation_No_Output.md
            const nodeWithSmallScientificNotation: GraphNode = {
                relativeFilePathIsID: '5_Immediate_Test_Observation_No_Output.md',
                contentWithoutYamlOrLinks: '# Speaker observes no output',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 3.061616997868383e-14, y: 500 }),
                    additionalYAMLProps: new Map([['node_id', '5']]),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [upsert(nodeWithSmallScientificNotation)]
            applyGraphDeltaToUI(cy, delta)

            // THEN: Position should be correctly parsed
            const node: cytoscape.CollectionReturnValue = cy.getElementById('5_Immediate_Test_Observation_No_Output.md')
            const pos: cytoscape.Position = node.position()
            expect(pos.x).toBeCloseTo(0, 10) // 3.06e-14 is effectively 0
            expect(pos.y).toBe(500)
        })

        it('should handle very large scientific notation values', () => {
            const nodeWithLargeNotation: GraphNode = {
                relativeFilePathIsID: 'large-notation.md',
                contentWithoutYamlOrLinks: '# Large Notation',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 1.5e6, y: -2.5e5 }), // 1,500,000 and -250,000
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [upsert(nodeWithLargeNotation)]
            applyGraphDeltaToUI(cy, delta)

            const node: cytoscape.CollectionReturnValue = cy.getElementById('large-notation.md')
            const pos: cytoscape.Position = node.position()
            expect(pos.x).toBe(1500000)
            expect(pos.y).toBe(-250000)
        })
    })

    describe('Append animation behavior', () => {
        it.skip('should trigger append animation when updating an existing node and stop after timeout', () => {
            vi.useFakeTimers()

            // Create breathing animation service to listen for events
            const breathingService: BreathingAnimationService = new BreathingAnimationService(cy)

            // GIVEN: Graph with an existing node
            const originalNode: GraphNode = {
                relativeFilePathIsID: 'test-node',
                contentWithoutYamlOrLinks: '# Original Content',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const createDelta: GraphDelta = [
                upsert(originalNode)
            ]

            applyGraphDeltaToUI(cy, createDelta)

            const node: cytoscape.CollectionReturnValue = cy.getElementById('test-node')
            expect(node.length).toBe(1)

            // New node should have green breathing animation
            expect(node.data('breathingActive')).toBe(true)
            expect(node.data('animationType')).toBe(AnimationType.NEW_NODE)

            // Clear the new node animation for testing the update animation
            breathingService.stopAnimationForNode(node)
            expect(node.data('breathingActive')).toBe(false)

            // WHEN: Updating the existing node with new content
            const updatedNode: GraphNode = {
                relativeFilePathIsID: 'test-node',
                contentWithoutYamlOrLinks: '# Updated Content\n\nNew paragraph added',
                outgoingEdges: [],
                nodeUIMetadata: {

                    color: O.some('#ff0000'),
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const updateDelta: GraphDelta = [
                upsert(updatedNode)
            ]

            applyGraphDeltaToUI(cy, updateDelta)

            // THEN: Node should have breathing animation (cyan/appended content animation)
            expect(node.data('breathingActive')).toBe(true)
            expect(node.data('animationType')).toBe(AnimationType.APPENDED_CONTENT)

            // Should have the appended content animation class
            expect(node.hasClass('breathing-appended-expand')).toBe(true)

            // WHEN: Advancing time by 15 seconds (the timeout for APPENDED_CONTENT)
            vi.advanceTimersByTime(15000)

            // THEN: Animation should stop
            expect(node.data('breathingActive')).toBe(false)
            expect(node.hasClass('breathing-appended-expand')).toBe(false)
            expect(node.hasClass('breathing-appended-contract')).toBe(false)

            breathingService.destroy()
            vi.useRealTimers()
        })
    })
})
