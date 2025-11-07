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
import * as O from 'fp-ts/lib/Option.js'
import { createNewChildNodeFromUI } from '@/functional_graph/shell/UI/handleUIActions'
import type { Graph } from '@/functional_graph/pure/types'

describe('createNewChildNodeFromUI - Integration', () => {
    let cy: Core
    let mockGraph: Graph

    beforeEach(() => {
        // Create a minimal graph with 2 nodes
        mockGraph = {
            nodes: {
                'parent': {
                    id: 'parent',
                    content: '# Parent GraphNode',
                    outgoingEdges: ['child1'],
                    nodeUIMetadata: {
                        color: O.none,
                        position: { x: 100, y: 100 }
                    }
                },
                'child1': {
                    id: 'child1',
                    content: '# Child 1',
                    outgoingEdges: [],
                    nodeUIMetadata: {
                        color: O.none,
                        position: { x: 200, y: 200 }
                    }
                }
            }
        }

        // Initialize headless cytoscape with the 2 nodes
        cy = cytoscape({
            headless: true, // Headless mode - no DOM required
            elements: [
                {
                    group: 'nodes' as const,
                    data: { id: 'parent', label: 'parent', content: '# Parent GraphNode', summary: '' },
                    position: { x: 100, y: 100 }
                },
                {
                    group: 'nodes' as const,
                    data: { id: 'child1', label: 'child1', content: '# Child 1', summary: '' },
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
                graph: {
                    getState: vi.fn().mockResolvedValue(mockGraph),
                    applyGraphDelta: vi.fn().mockResolvedValue({ success: true })
                }
            }
        } as any
    })

    afterEach(() => {
        cy.destroy()
        vi.clearAllMocks()
    })

    it('should add a new child node to cytoscape with correct edge', async () => {
        // GIVEN: Graph with 2 nodes (parent + 1 child), cytoscape has 2 nodes and 1 edge
        expect(cy.nodes()).toHaveLength(2)
        expect(cy.edges()).toHaveLength(1)

        // WHEN: Creating a new child node from the parent
        await createNewChildNodeFromUI('parent', cy)

        // THEN: Cytoscape should now have 3 nodes
        expect(cy.nodes()).toHaveLength(3)

        // AND: Should have 2 edges (parent->child1, parent->new_child)
        expect(cy.edges()).toHaveLength(2)

        // AND: The new node should exist
        const newNodeId = 'parent_1' // Based on naming convention in fromUIInteractionToAddNode
        const newNode = cy.getElementById(newNodeId)
        expect(newNode.length).toBe(1)
        expect(newNode.data('label')).toBe(newNodeId)

        // AND: There should be an edge from parent to the new node
        const newEdge = cy.getElementById(`parent-${newNodeId}`)
        expect(newEdge.length).toBe(1)
        expect(newEdge.data('source')).toBe('parent')
        expect(newEdge.data('target')).toBe(newNodeId)

        // AND: Should have called electronAPI to persist the change
        expect(window.electronAPI.graph.applyGraphDelta).toHaveBeenCalledWith([
            expect.objectContaining({
                nodeToUpsert: expect.objectContaining({
                    id: newNodeId,
                    content: '# New GraphNode'
                }),
                createsIncomingEdges: ['parent']
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
})
