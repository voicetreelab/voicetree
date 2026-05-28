// @vitest-environment jsdom
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
import { createNewChildNodeFromUI } from '@/shell/edge/UI-edge/graph/actions/handleUIActions'
import type { Graph, GraphNode, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph'
import { mapNewGraphToDelta } from '@vt/graph-model/graph'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI'
import {
    applyDeltaToTestProjectionState,
    projectDelta,
    resetTestProjectionState
} from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import {
    WORKFLOW_INJECTION_WRITER_ID,
    writeMarkdownFileFromUI
} from "@/shell/edge/UI-edge/floating-windows/editors/writeMarkdownFileFromUI";

// Mock posthog
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
        get_distinct_id: vi.fn(() => 'test-user-id')
    }
}))

// Mock agentTabsActivity
vi.mock('@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity', async (importOriginal) => {
    const actual: Record<string, unknown> = await importOriginal() as Record<string, unknown>
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

function applyDeltaToUI(cy: Core, delta: GraphDelta): ReturnType<typeof applyGraphDeltaToUI> {
    return applyGraphDeltaToUI(cy, projectDelta(delta))
}

describe('createNewChildNodeFromUI - Integration', () => {
    let cy: Core
    let mockGraph: Graph

    beforeEach(() => {
        resetTestProjectionState()
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }
        })
        applyDeltaToTestProjectionState(mapNewGraphToDelta(mockGraph))

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
            mockGraph = applyGraphDeltaToGraph(mockGraph, delta)
            // Apply the delta to the cytoscape instance after getNode can see the new graph state.
            applyDeltaToUI(cy, delta)
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

    it('should create a child when the graph snapshot is missing the parent but getNode can load it', async () => {
        // GIVEN: The renderer has a selected parent, but the graph snapshot is stale/missing it
        const parentNode: GraphNode = mockGraph.nodes['parent.md']
        const staleGraph: Graph = createGraph({
            'child1.md': mockGraph.nodes['child1.md']
        })
        mockGraph = staleGraph
        ;(global.window as any).electronAPI.main.getNode = vi.fn((nodeId: string) =>
            nodeId === 'parent.md' ? parentNode : mockGraph.nodes[nodeId]
        )

        // WHEN: Creating a child from the selected parent
        const result: string = await createNewChildNodeFromUI('parent.md', cy)

        // THEN: The UI path should recover instead of passing undefined into child creation
        expect(result).toBe('parent_1.md')
        expect((global.window as any).electronAPI.main.getNode).toHaveBeenCalledWith('parent.md')
        expect((global.window as any).electronAPI.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed).toHaveBeenCalledTimes(1)
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

describe('writeMarkdownFileFromUI - Integration', () => {
    type MarkdownWriteRequest = {
        readonly absolutePath: string
        readonly body: string
        readonly editorId: string
    }

    let writtenFiles: Map<string, string>
    let daemonRequests: MarkdownWriteRequest[]

    beforeEach(() => {
        writtenFiles = new Map<string, string>()
        daemonRequests = []

        global.window = {
            electronAPI: {
                main: {
                    writeMarkdownFile: async (
                        absolutePath: string,
                        body: string,
                        editorId: string,
                    ): Promise<void> => {
                        daemonRequests.push({ absolutePath, body, editorId })
                        const targetPath: string = absolutePath.endsWith('/')
                            ? `${absolutePath}index.md`
                            : absolutePath
                        writtenFiles.set(targetPath, body)
                    },
                }
            }
        } as unknown as Window & typeof globalThis
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('writes file body through the daemon endpoint', async () => {
        const newContent: string = '# New Title\n\nSome content'

        await writeMarkdownFileFromUI('test.md', newContent, 'editor:test')

        expect(writtenFiles.get('test.md')).toBe(newContent)
        expect(daemonRequests).toEqual([{
            absolutePath: 'test.md',
            body: newContent,
            editorId: 'editor:test',
        }])
    })

    it('lets the daemon resolve folder node saves to index.md', async () => {
        const newContent: string = '# Folder Body\n'

        await writeMarkdownFileFromUI('folder/' as NodeIdAndFilePath, newContent, 'editor:folder')

        expect(writtenFiles.get('folder/index.md')).toBe(newContent)
        expect(daemonRequests[0]).toEqual({
            absolutePath: 'folder/',
            body: newContent,
            editorId: 'editor:folder',
        })
    })

    it('uses a non-editor writer id for workflow injection writes', async () => {
        const appended: string = '# Existing\n\nWorkflow summary'

        await writeMarkdownFileFromUI('test.md', appended, WORKFLOW_INJECTION_WRITER_ID)

        expect(writtenFiles.get('test.md')).toBe(appended)
        expect(daemonRequests[0]?.editorId).toBe(WORKFLOW_INJECTION_WRITER_ID)
    })
})
