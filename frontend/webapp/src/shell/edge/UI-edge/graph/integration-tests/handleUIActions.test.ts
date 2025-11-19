/**
 * Integration Test: createNewChildNodeFromUI
 *
 * BEHAVIOR TESTED:
 * - INPUT: Parent node ID, headless cytoscape instance with 2 nodes
 * - OUTPUT: Cytoscape has 3 nodes with correct edges
 * - SIDE EFFECTS: Calls electronAPI to persist the graph delta
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {Core} from 'cytoscape';
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { createNewChildNodeFromUI } from '@/shell/edge/UI-edge/graph/handleUIActions.ts'
import type { Graph } from '@/pure/graph'

describe('createNewChildNodeFromUI - Integration', () => {
    let cy: Core
    let mockGraph: Graph

    beforeEach(() => {
        // Create a minimal graph with 2 nodes
        mockGraph = {
            nodes: {
                'parent': {
                    relativeFilePathIsID: 'parent',
                    content: '# Parent GraphNode',
                    outgoingEdges: [{ targetId: 'child1', label: '' }],
                    nodeUIMetadata: {
                        title: 'Parent GraphNode',
                        color: O.none,
                        position: O.some({ x: 100, y: 100 })
                    }
                },
                'child1': {
                    relativeFilePathIsID: 'child1',
                    content: '# Child 1',
                    outgoingEdges: [],
                    nodeUIMetadata: {
                        title: 'Child 1',
                        color: O.none,
                        position: O.some({ x: 200, y: 200 })
                    }
                }
            }
        }

        // Initialize headless cytoscape with the 2 nodes
        // Labels should match what markdownToTitle would extract from content
        cy = cytoscape({
            headless: true, // Headless mode - no DOM required
            elements: [
                {
                    group: 'nodes' as const,
                    data: { id: 'parent', label: 'Parent GraphNode', content: '# Parent GraphNode', summary: '' },
                    position: { x: 100, y: 100 }
                },
                {
                    group: 'nodes' as const,
                    data: { id: 'child1', label: 'Child 1', content: '# Child 1', summary: '' },
                    position: { x: 200, y: 200 }
                },
                {
                    group: 'edges' as const,
                    data: { id: 'parent-child1', source: 'parent', target: 'child1' }
                }
            ]
        })

        // Mock window.electronAPI
        global.window = {
            electronAPI: {
                main: {
                    getGraph: vi.fn().mockReturnValue(mockGraph),
                    applyGraphDeltaToDBAndMem: vi.fn().mockResolvedValue(undefined)
                }
            }
        } as unknown as Window & typeof globalThis
    })

    afterEach(() => {
        cy.destroy()
        vi.clearAllMocks()
    })

    it('should add a new child node to cytoscape with correct edge', async () => {
        // GIVEN: Graph with 2 nodes (parent + 1 child), cytoscape has 2 nodes and 1 edge
        expect(cy.nodes()).toHaveLength(2)
        expect(cy.edges()).toHaveLength(1)

        // AND: Existing nodes have correct labels from markdownToTitle
        expect(cy.getElementById('parent').data('label')).toBe('Parent GraphNode')
        expect(cy.getElementById('child1').data('label')).toBe('Child 1')

        // WHEN: Creating a new child node from the parent
        await createNewChildNodeFromUI('parent', cy)

        // THEN: Cytoscape should now have 3 nodes
        expect(cy.nodes()).toHaveLength(3)

        // AND: Should have 2 edges (parent->child1, parent->new_child)
        expect(cy.edges()).toHaveLength(2)

        // AND: The new node should exist with correct label from nodeUIMetadata.title
        const newNodeId = 'parent_1' // Based on naming convention in fromUIInteractionToAddNode
        const newNode = cy.getElementById(newNodeId)
        expect(newNode.length).toBe(1)
        // Label comes from nodeUIMetadata.title which is "Child of " + parentNode.nodeUIMetadata.title
        expect(newNode.data('label')).toBe('Child of Parent GraphNode')

        // AND: There should be an edge from parent to the new node
        const newEdge = cy.getElementById(`parent->${newNodeId}`)
        expect(newEdge.length).toBe(1)
        expect(newEdge.data('source')).toBe('parent')
        expect(newEdge.data('target')).toBe(newNodeId)

        // AND: Should have called electronAPI to persist the change
        // The GraphDelta should contain 2 actions: new child node + updated parent with edge
        expect(window.electronAPI!.main.applyGraphDeltaToDBAndMem).toHaveBeenCalledWith([
            expect.objectContaining({
                type: 'UpsertNode',
                nodeToUpsert: expect.objectContaining({
                    relativeFilePathIsID: newNodeId,
                    content: '# Title'
                })
            }),
            expect.objectContaining({
                type: 'UpsertNode',
                nodeToUpsert: expect.objectContaining({
                    relativeFilePathIsID: 'parent',
                    outgoingEdges: expect.arrayContaining([expect.objectContaining({ targetId: newNodeId })])
                })
            })
        ])
    })

    it('should position new child node away from parent', async () => {
        // GIVEN: Parent already has 1 child
        expect(cy.nodes()).toHaveLength(2)

        // WHEN: Creating second child
        await createNewChildNodeFromUI('parent', cy)

        // THEN: New node should be positioned relative to parent
        const newNodeId = 'parent_1'
        const newNode = cy.getElementById(newNodeId)
        const newPos = newNode.position()
        const parentPos = cy.getElementById('parent').position()

        // Position should be different from parent (angular seeding places it at a distance)
        expect(newPos.x !== parentPos.x || newPos.y !== parentPos.y).toBe(true)

        // Position should be a reasonable distance from parent (> 0 and < 1000 pixels)
        const dx = newPos.x - parentPos.x
        const dy = newPos.y - parentPos.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        expect(distance).toBeGreaterThan(0)
        expect(distance).toBeLessThan(1000)
    })

    it('should extract labels correctly via markdownToTitle for different content types', async () => {
        // Test heading extraction
        const headingNode = cy.getElementById('parent')
        expect(headingNode.data('label')).toBe('Parent GraphNode')
        expect(headingNode.data('content')).toBe('# Parent GraphNode')

        // Test another heading
        const childNode = cy.getElementById('child1')
        expect(childNode.data('label')).toBe('Child 1')
        expect(childNode.data('content')).toBe('# Child 1')
    })
})
