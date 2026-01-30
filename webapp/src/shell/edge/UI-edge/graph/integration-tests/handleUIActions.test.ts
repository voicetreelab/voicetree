/**
 * Integration Test: createNewChildNodeFromUI
 *
 * BEHAVIOR TESTED:
 * - INPUT: Parent node ID, headless cytoscape instance with 2 nodes
 * - OUTPUT: Cytoscape has 3 nodes with correct edges
 * - SIDE EFFECTS: Calls electronAPI to persist the graph delta
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {Core} from 'cytoscape';
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { createNewChildNodeFromUI } from '@/shell/edge/UI-edge/graph/handleUIActions'
import type { Graph, GraphNode, GraphDelta } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'
import {modifyNodeContentFromUI} from "@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor";

// Mock posthog
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
        get_distinct_id: vi.fn(() => 'test-user-id')
    }
}))

// Mock AgentTabsBar
vi.mock('@/shell/UI/views/AgentTabsBar', async () => {
    const actual: typeof import('@/shell/UI/views/AgentTabsBar') = await vi.importActual('@/shell/UI/views/AgentTabsBar')
    return {
        ...actual,
        markTerminalActivityForContextNode: vi.fn()
    }
})

// Mock FloatingEditorCRUD
vi.mock('@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD', async () => {
    const actual: typeof import('@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD') = await vi.importActual('@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD')
    return {
        ...actual,
        updateFloatingEditors: vi.fn()
    }
})

describe('createNewChildNodeFromUI - Integration', () => {
    let cy: Core
    let mockGraph: Graph

    beforeEach(() => {
        // Create a minimal graph with 2 nodes
        // NOTE: title is derived via getNodeTitle from contentWithoutYamlOrLinks
        mockGraph = createGraph({
            'parent.md': {
                absoluteFilePathIsID: 'parent.md',
                contentWithoutYamlOrLinks: '# Parent GraphNode',
                outgoingEdges: [{ targetId: 'child1.md', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            },
            'child1.md': {
                absoluteFilePathIsID: 'child1.md',
                contentWithoutYamlOrLinks: '# Child 1',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }
        })

        // Initialize headless cytoscape with the 2 nodes
        // Labels should match what markdownToTitle would extract from content
        cy = cytoscape({
            headless: true, // Headless mode - no DOM required
            elements: [
                {
                    group: 'nodes' as const,
                    data: { id: 'parent.md', label: 'Parent GraphNode', content: '# Parent GraphNode', summary: '' },
                    position: { x: 100, y: 100 }
                },
                {
                    group: 'nodes' as const,
                    data: { id: 'child1.md', label: 'Child 1', content: '# Child 1', summary: '' },
                    position: { x: 200, y: 200 }
                },
                {
                    group: 'edges' as const,
                    data: { id: 'parent-child1', source: 'parent.md', target: 'child1.md' }
                }
            ]
        })

        // Mock window.electronAPI
        // Mock applyGraphDeltaToDBThroughMem to also update the cytoscape UI and mockGraph
        const mockApplyDelta: (delta: GraphDelta) => Promise<void> = vi.fn().mockImplementation(async (delta: GraphDelta) => {
            // Apply the delta to the cytoscape instance to simulate the UI update
            applyGraphDeltaToUI(cy, delta)
            // Also update mockGraph so getNode works for newly created nodes
            delta.forEach((action) => {
                if (action.type === 'UpsertNode') {
                    mockGraph.nodes[action.nodeToUpsert.absoluteFilePathIsID] = action.nodeToUpsert
                }
            })
            return undefined
        })

        // Ensure window is defined
        if (!global.window) {
            global.window = {} as Window & typeof globalThis
        }

        (global.window as any).electronAPI = {
            main: {
                getGraph: vi.fn(() => mockGraph),
                getNode: vi.fn((nodeId: string) => mockGraph.nodes[nodeId]),
                applyGraphDeltaToDBThroughMemUIAndEditorExposed: mockApplyDelta
            }
        }
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
        expect(cy.getElementById('parent.md').data('label')).toBe('Parent GraphNode')
        expect(cy.getElementById('child1.md').data('label')).toBe('Child 1')

        // WHEN: Creating a new child node from the parent
        const result: string = await createNewChildNodeFromUI('parent.md', cy)

        // THEN: Should return the new node ID (parent.md -> parent_1.md by stripping .md and adding _1.md)
        expect(result).toBe('parent_1.md')

        // THEN: applyGraphDeltaToDBThroughMem should have been called
        expect((global.window as any).electronAPI.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed).toHaveBeenCalledTimes(1)

        // THEN: Cytoscape should now have 3 nodes
        expect(cy.nodes()).toHaveLength(3)

        // AND: Should have 2 edges (parent->child1, parent->new_child)
        expect(cy.edges()).toHaveLength(2)

        // AND: The new node should exist with correct label derived via getNodeTitle
        const newNodeId: string = result // Use the actual returned ID
        const newNode: cytoscape.CollectionReturnValue = cy.getElementById(newNodeId)
        expect(newNode.length).toBe(1)
        // New nodes are created with "# " content. After trimming, first non-empty line is "#"
        // (the heading regex requires text after "# ", which "# " lacks)
        expect(newNode.data('label')).toBe('#')

        // AND: There should be an edge from parent to the new node
        const newEdge: cytoscape.CollectionReturnValue = cy.getElementById(`parent.md->${newNodeId}`)
        expect(newEdge.length).toBe(1)
        expect(newEdge.data('source')).toBe('parent.md')
        expect(newEdge.data('target')).toBe(newNodeId)

        // AND: Should have called electronAPI to persist the change
        // The GraphDelta should contain 2 actions: new child node + updated parent with edge
        const graphDeltaCall: any[] = (window as any).electronAPI!.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed.mock.calls[0]?.[0] as any[];
        expect(graphDeltaCall).toHaveLength(2)

        // First action: UpsertNode for new child
        expect(graphDeltaCall[0].type).toBe('UpsertNode')
        expect(graphDeltaCall[0].nodeToUpsert.absoluteFilePathIsID).toBe(newNodeId)

        // Second action: UpsertNode for parent with edge to new child
        expect(graphDeltaCall[1].type).toBe('UpsertNode')
        expect(graphDeltaCall[1].nodeToUpsert.absoluteFilePathIsID).toBe('parent.md')
        const hasEdgeToNewNode: boolean = graphDeltaCall[1].nodeToUpsert.outgoingEdges.some(
            (edge: { targetId: string }) => edge.targetId === newNodeId
        ) as boolean;
        expect(hasEdgeToNewNode).toBe(true)
    })

    it('should position new child node away from parent', async () => {
        // GIVEN: Parent already has 1 child
        expect(cy.nodes()).toHaveLength(2)

        // WHEN: Creating second child
        const newNodeId: string = await createNewChildNodeFromUI('parent.md', cy)

        // THEN: New node should be positioned relative to parent
        const newNode: cytoscape.CollectionReturnValue = cy.getElementById(newNodeId)
        const newPos: cytoscape.Position = newNode.position()
        const parentPos: cytoscape.Position = cy.getElementById('parent.md').position()

        // Position should be different from parent (angular seeding places it at a distance)
        expect(newPos.x !== parentPos.x || newPos.y !== parentPos.y).toBe(true)

        // Position should be a reasonable distance from parent (> 0 and < 1000 pixels)
        const dx: number = newPos.x - parentPos.x
        const dy: number = newPos.y - parentPos.y
        const distance: number = Math.sqrt(dx * dx + dy * dy)

        expect(distance).toBeGreaterThan(0)
        expect(distance).toBeLessThan(1000)
    })

    it('should extract labels correctly via markdownToTitle for different content types', async () => {
        // Test heading extraction
        const headingNode: cytoscape.CollectionReturnValue = cy.getElementById('parent.md')
        expect(headingNode.data('label')).toBe('Parent GraphNode')
        expect(headingNode.data('content')).toBe('# Parent GraphNode')

        // Test another heading
        const childNode: cytoscape.CollectionReturnValue = cy.getElementById('child1.md')
        expect(childNode.data('label')).toBe('Child 1')
        expect(childNode.data('content')).toBe('# Child 1')
    })
})

describe('modifyNodeContentFromUI - Integration', () => {
    let cy: Core
    let mockGraph: Graph

    beforeEach(() => {
        // Create a minimal graph with 1 node
        // NOTE: title is derived via getNodeTitle from contentWithoutYamlOrLinks
        mockGraph = createGraph({
            'test.md': {
                absoluteFilePathIsID: 'test.md',
                contentWithoutYamlOrLinks: '# Old Title\n\nSome content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('#FF0000'),
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }
        })

        // Initialize headless cytoscape with the node
        cy = cytoscape({
            headless: true,
            elements: [
                {
                    group: 'nodes' as const,
                    data: { id: 'test.md', label: 'Old Title', content: '# Old Title\n\nSome content', summary: '' },
                    position: { x: 100, y: 100 }
                }
            ]
        })

        // Mock window.electronAPI
        global.window = {
            electronAPI: {
                main: {
                    getGraph: vi.fn().mockReturnValue(mockGraph),
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: vi.fn().mockImplementation(async (delta: GraphDelta) => {
                        // Apply the delta to the cytoscape instance to simulate the UI update
                        applyGraphDeltaToUI(cy, delta)
                        return undefined
                    }),
                    applyGraphDeltaToDBThroughMemAndUIExposed: vi.fn().mockImplementation(async (delta: GraphDelta) => {
                        // Apply the delta to the cytoscape instance to simulate the UI update
                        applyGraphDeltaToUI(cy, delta)
                        return undefined
                    }),
                    getNode: vi.fn().mockImplementation((nodeId: string) => mockGraph.nodes[nodeId])
                }
            }
        } as unknown as Window & typeof globalThis
    })

    afterEach(() => {
        cy.destroy()
        vi.clearAllMocks()
    })

    it('should update node title in cytoscape when content heading changes', async () => {
        // GIVEN: Node with title "Old Title"
        expect(cy.getElementById('test.md').data('label')).toBe('Old Title')

        // WHEN: Modifying content with a new heading
        const newContent: string = '# New Title\n\nSome content'
        await modifyNodeContentFromUI('test.md', newContent, cy)

        // THEN: Cytoscape node label should be updated to new title
        expect(cy.getElementById('test.md').data('label')).toBe('New Title')
    })

    it('should preserve position in GraphDelta when updating content', async () => {
        // GIVEN: Node with position (100, 100) in metadata

        // WHEN: Modifying content (which doesn't include position in frontmatter)
        const newContent: string = '# New Title\n\nSome content'
        await modifyNodeContentFromUI('test.md', newContent, cy)

        // THEN: GraphDelta should contain node with preserved position from old metadata
        const graphDeltaCall: any[] = (window as any).electronAPI!.main.applyGraphDeltaToDBThroughMemAndUIExposed.mock.calls[0]?.[0] as any[]
        const upsertedNode: GraphNode = graphDeltaCall[0].nodeToUpsert as GraphNode

        // Position should be preserved from old metadata (O.some({x: 100, y: 100}))
        expect(O.isSome(upsertedNode.nodeUIMetadata.position)).toBe(true)
        if (O.isSome(upsertedNode.nodeUIMetadata.position)) {
            expect(upsertedNode.nodeUIMetadata.position.value.x).toBe(100)
            expect(upsertedNode.nodeUIMetadata.position.value.y).toBe(100)
        }
    })

    it('should call applyGraphDeltaToDBThroughMem with updated node - title derived from content', async () => {
        // GIVEN: Node with old title (derived from content heading)
        expect(cy.getElementById('test.md').data('label')).toBe('Old Title')

        // WHEN: Modifying content with new title
        const newContent: string = '# Updated Title\n\nNew content here'
        await modifyNodeContentFromUI('test.md', newContent, cy)

        // THEN: GraphDelta should contain node with content that derives the new title
        const graphDeltaCall: any[] = (window as any).electronAPI!.main.applyGraphDeltaToDBThroughMemAndUIExposed.mock.calls[0]?.[0] as any[]
        expect(graphDeltaCall).toHaveLength(1)
        expect(graphDeltaCall[0].type).toBe('UpsertNode')

        const upsertedNode: GraphNode = graphDeltaCall[0].nodeToUpsert as GraphNode
        // Title is derived from content via getNodeTitle, not stored in metadata
        expect(getNodeTitle(upsertedNode)).toBe('Updated Title')
    })
})
