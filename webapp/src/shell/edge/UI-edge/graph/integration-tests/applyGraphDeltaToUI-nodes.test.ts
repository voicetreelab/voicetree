// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import { syncVaultStateFromMain } from '@/shell/edge/UI-edge/state/stores/VaultPathStore'
import { resetTestProjectionState, setTestCollapseSet } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { O, upsert, del, applyDeltaToUI } from './applyGraphDeltaToUI.test-utils'

vi.mock('@/shell/edge/UI-edge/graph/popups/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn()
}))

describe('applyGraphDeltaToUI - Integration', () => {
    let cy: Core

    beforeEach(() => {
        resetTestProjectionState()
        cy = cytoscape({ headless: true, elements: [] })
    })

    afterEach(() => {
        cy.destroy()
        setTestCollapseSet(new Set())
        syncVaultStateFromMain({ readPaths: [], writeFolderPath: null, starredFolders: [] })
    })

    describe('Add new node with parent', () => {
        it('should add a new node with an edge to its parent', () => {
            expect(cy.nodes()).toHaveLength(0)

            const parentNode: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: parentNode, previousNode: O.none }])

            const childNode: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const parentWithEdge: GraphNode = {
                ...parentNode,
                outgoingEdges: [{ targetId: 'child', label: '' }]
            }

            applyDeltaToUI(cy, [upsert(childNode), upsert(parentWithEdge)])

            expect(cy.getElementById('parent').length).toBe(1)
            expect(cy.getElementById('child').length).toBe(1)

            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('source')).toBe('parent')
            expect(edge.data('target')).toBe('child')

            const childPos: cytoscape.Position = cy.getElementById('child').position()
            expect(childPos.x).toBe(200)
            expect(childPos.y).toBe(200)
        })
    })

    describe('Add orphan node (no parent)', () => {
        it('should add orphan node without edges', () => {
            expect(cy.nodes()).toHaveLength(0)

            const orphanNode: GraphNode = {
                absoluteFilePathIsID: 'orphan',
                contentWithoutYamlOrLinks: '# Orphan GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 300, y: 300 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: orphanNode, previousNode: O.none }])

            expect(cy.getElementById('orphan').length).toBe(1)
            expect(cy.edges().length).toBe(0)
        })
    })

    describe('Delete node', () => {
        it('should remove a node from the graph', () => {
            const node: GraphNode = {
                absoluteFilePathIsID: 'to-delete',
                contentWithoutYamlOrLinks: '# GraphNode to Delete',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }])
            expect(cy.getElementById('to-delete').length).toBe(1)

            applyDeltaToUI(cy, [{ type: 'DeleteNode', nodeId: 'to-delete', deletedNode: O.none }])

            expect(cy.getElementById('to-delete').length).toBe(0)
        })
    })

    describe('Update existing node metadata', () => {
        it('should update title, content and color, and apply spec position', () => {
            const originalNode: GraphNode = {
                absoluteFilePathIsID: 'node-to-update',
                contentWithoutYamlOrLinks: '# Original Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: originalNode, previousNode: O.none }])

            const originalPos: cytoscape.Position = cy.getElementById('node-to-update').position()
            expect(originalPos.x).toBe(100)
            expect(originalPos.y).toBe(100)

            const updatedNode: GraphNode = {
                absoluteFilePathIsID: 'node-to-update',
                contentWithoutYamlOrLinks: '# Updated Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('#ff0000'),
                    position: O.some({ x: 500, y: 500 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: updatedNode, previousNode: O.none }])

            const node: cytoscape.CollectionReturnValue = cy.getElementById('node-to-update')
            expect(node.data('content')).toBe('# Updated Content')
            expect(node.data('label')).toBe('Updated Content')
            expect(node.data('color')).toBe('#ff0000')

            // Position preserved — renderer owns positions after first apply (design decision 6)
            const newPos: cytoscape.Position = node.position()
            expect(newPos.x).toBe(100)
            expect(newPos.y).toBe(100)
        })
    })

    describe('Bulk operations', () => {
        it('should handle multiple node additions in one delta', () => {
            expect(cy.nodes()).toHaveLength(0)

            const node1: GraphNode = {
                absoluteFilePathIsID: 'bulk-1',
                contentWithoutYamlOrLinks: '# Bulk GraphNode 1',
                outgoingEdges: [{ targetId: 'bulk-2', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const node2: GraphNode = {
                absoluteFilePathIsID: 'bulk-2',
                contentWithoutYamlOrLinks: '# Bulk GraphNode 2',
                outgoingEdges: [{ targetId: 'bulk-3', label: '' }],
                nodeUIMetadata: {
                    color: O.some('#00ff00'),
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const node3: GraphNode = {
                absoluteFilePathIsID: 'bulk-3',
                contentWithoutYamlOrLinks: '# Bulk GraphNode 3',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 300, y: 300 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(node1), upsert(node2), upsert(node3)])

            expect(cy.getElementById('bulk-1').length).toBe(1)
            expect(cy.getElementById('bulk-2').length).toBe(1)
            expect(cy.getElementById('bulk-3').length).toBe(1)

            expect(cy.getElementById('bulk-1->bulk-2').length).toBe(1)
            expect(cy.getElementById('bulk-2->bulk-3').length).toBe(1)

            expect(cy.getElementById('bulk-2').data('color')).toBe('#00ff00')
        })

        it('should handle mixed operations (add, update, delete) in one delta', () => {
            const existingNode: GraphNode = {
                absoluteFilePathIsID: 'existing',
                contentWithoutYamlOrLinks: '# Existing',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const nodeToDelete: GraphNode = {
                absoluteFilePathIsID: 'to-delete',
                contentWithoutYamlOrLinks: '# Will be deleted',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(existingNode), upsert(nodeToDelete)])
            expect(cy.nodes()).toHaveLength(2)

            const newNode: GraphNode = {
                absoluteFilePathIsID: 'new',
                contentWithoutYamlOrLinks: '# New GraphNode',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 300, y: 300 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const updatedExisting: GraphNode = {
                ...existingNode,
                contentWithoutYamlOrLinks: '# Updated Existing',
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(newNode), upsert(updatedExisting), del('to-delete')])

            expect(cy.nodes()).toHaveLength(2)
            expect(cy.getElementById('new').length).toBe(1)
            expect(cy.getElementById('existing').data('content')).toBe('# Updated Existing')
            expect(cy.getElementById('existing').data('label')).toBe('Updated Existing')
            expect(cy.getElementById('to-delete').length).toBe(0)
        })
    })
})
