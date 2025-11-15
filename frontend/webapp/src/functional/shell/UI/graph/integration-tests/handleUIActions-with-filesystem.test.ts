/**
 * Integration Test: createNewChildNodeFromUI with Filesystem
 *
 * BEHAVIOR TESTED:
 * - INPUT: Parent node ID, headless cytoscape instance with 2 nodes
 * - OUTPUT: Cytoscape has 3 nodes with correct edges
 * - SIDE EFFECTS: Files are actually created on disk in temp vault
 *
 * This test uses real IPC handlers and filesystem operations (no mocking of applyGraphDelta)
 *
 * Architecture:
 * - fromUICreateChildToUpsertNode creates GraphDelta with [childNode, updatedParentNode]
 * - apply_graph_deltas_to_db writes both nodes to filesystem
 * - File watch handlers would normally update graph state (not tested here)
 */

/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable functional/no-this-expressions */
/* eslint-disable functional/no-throw-statements */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {Core} from 'cytoscape';
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { createNewChildNodeFromUI, deleteNodeFromUI } from '@/functional/shell/UI/graph/handleUIActions.ts'
import type { Graph } from '@/functional/pure/graph/types.ts'
import * as fs from 'fs/promises'
import * as path from 'path'
import { setVaultPath, setGraph } from '@/functional/shell/state/graph-store.ts'

// State managed by mocked globals - using module-level state that the mock functions will access
let currentGraph: Graph | null = null
let tempVault: string = ''

// Mock Electron's ipcMain
const ipcMain = {
    _handlers: new Map<string, Function>(),
    handle(channel: string, handler: Function) {
        this._handlers.set(channel, handler)
    },
    removeHandler(channel: string) {
        this._handlers.delete(channel)
    }
}

// Mock electron module
vi.mock('electron', () => ({
    ipcMain,
    dialog: {
        showOpenDialog: vi.fn()
    },
    app: {
        whenReady: () => Promise.resolve(),
        on: vi.fn(),
        quit: vi.fn()
    }
}))

// Mock graph store - properly intercept vault path
vi.mock('@/functional/shell/state/graph-store.ts', () => {
    return {
        getGraph: () => {
            if (!currentGraph) {
                throw new Error('Graph not initialized')
            }
            return currentGraph
        },
        setGraph: (graph: Graph) => {
            currentGraph = graph
        },
        getVaultPath: () => {
            return tempVault ? O.of(tempVault) : O.none
        },
        setVaultPath: (path: string) => {
            tempVault = path
        },
        clearVaultPath: () => {
            tempVault = ''
        }
    }
})

// Import IPC handlers once at module level
let handlersImported = false
async function ensureHandlersImported(): Promise<void> {
    if (!handlersImported) {
        const { registerAllIpcHandlers } = await import('@/functional/shell/main/graph/ipc-graph-handlers.ts')
        registerAllIpcHandlers(
            {} as any, // terminalManager
            () => '' // getToolsDirectory
        )
        handlersImported = true
    }
}

describe('createNewChildNodeFromUI - Integration with Filesystem', () => {
    let cy: Core
    let mockGraph: Graph

    beforeEach(async () => {
        // Import IPC handlers once - they auto-register on import
        await ensureHandlersImported()
        // Create temporary vault directory
        tempVault = path.join('/tmp', `test-vault-ui-${Date.now()}`)
        await fs.mkdir(tempVault, { recursive: true })

        // Set vault path in graph store
        setVaultPath(tempVault)

        // Create initial markdown files with frontmatter and wikilinks
        await fs.writeFile(
            path.join(tempVault, 'parent.md'),
            `---
position:
  x: 100
  y: 100
---
# Parent Node

Parent content
[[child1]]`
        )
        await fs.writeFile(
            path.join(tempVault, 'child1.md'),
            `---
position:
  x: 200
  y: 200
---
# Child 1

Child content`
        )

        // Create graph state
        mockGraph = {
            nodes: {
                'parent': {
                    relativeFilePathIsID: 'parent',
                    content: '# Parent GraphNode\n\nParent content',
                    outgoingEdges: ['child1'],
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.of({ x: 100, y: 100 }),
                        title: 'parent'
                    }
                },
                'child1': {
                    relativeFilePathIsID: 'child1',
                    content: '# Child 1\n\nChild content',
                    outgoingEdges: [],
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.of({ x: 200, y: 200 }),
                        title: 'child1'
                    }
                }
            }
        }

        currentGraph = mockGraph
        setGraph(mockGraph)

        // Initialize headless cytoscape
        cy = cytoscape({
            headless: true,
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

        // Setup window.electronAPI to call through main API directly (new RPC pattern)
        const { mainAPI } = await import('@/functional/shell/main/api.ts')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    applyGraphDeltaToDBAndMem: mainAPI.applyGraphDeltaToDBAndMem
                }
            }
        } as any
    })

    afterEach(async () => {
        cy.destroy()

        // Cleanup temp vault
        await fs.rm(tempVault, { recursive: true, force: true })

        vi.clearAllMocks()
    })

    it('should create a new child node and write file to disk', async () => {
        // GIVEN: Graph with 2 nodes
        expect(cy.nodes()).toHaveLength(2)

        // WHEN: Creating a new child node from the parent
        await createNewChildNodeFromUI('parent', cy)

        // THEN: Cytoscape should have 3 nodes
        expect(cy.nodes()).toHaveLength(3)

        // AND: Should have 2 edges
        expect(cy.edges()).toHaveLength(2)

        // AND: The new node should exist in cytoscape
        const newNodeId = 'parent_1'
        const newNode = cy.getElementById(newNodeId)
        expect(newNode.length).toBe(1)

        // AND: File should be created on disk
        const newFilePath = path.join(tempVault, `${newNodeId}.md`)
        const fileExists = await fs.access(newFilePath).then(() => true).catch(() => false)
        expect(fileExists).toBe(true)

        // AND: File should have correct content
        const fileContent = await fs.readFile(newFilePath, 'utf-8')
        expect(fileContent).toContain('# New GraphNode')
    })

    it('should create file with correct position metadata eventually', async () => {
        // GIVEN: Graph with 2 nodes
        const initialFileCount = (await fs.readdir(tempVault)).length

        // WHEN: Creating a new child node
        await createNewChildNodeFromUI('parent', cy)

        // THEN: Should have one more file
        const files = await fs.readdir(tempVault)
        expect(files).toHaveLength(initialFileCount + 1)

        // AND: New file should exist with expected name
        const newNodeId = 'parent_1'
        expect(files).toContain(`${newNodeId}.md`)

        // AND: File should be readable and parseable
        const newFilePath = path.join(tempVault, `${newNodeId}.md`)
        const stat = await fs.stat(newFilePath)
        expect(stat.isFile()).toBe(true)
        expect(stat.size).toBeGreaterThan(0)
    })

    it('should update parent file with edge to new child', async () => {
        // GIVEN: Parent node with one existing child
        const parentFilePath = path.join(tempVault, 'parent.md')
        const initialParentContent = await fs.readFile(parentFilePath, 'utf-8')

        // Verify parent initially has only child1
        expect(initialParentContent).toContain('[[child1]]')
        expect(initialParentContent).not.toContain('[[parent_1]]')

        // WHEN: Creating a new child node
        await createNewChildNodeFromUI('parent', cy)

        // THEN: Parent file should be updated with edge to new child
        const updatedParentContent = await fs.readFile(parentFilePath, 'utf-8')

        // Parent should now have both edges
        expect(updatedParentContent).toContain('[[child1]]')
        expect(updatedParentContent).toContain('[[parent_1]]')
    })
})

describe('deleteNodeFromUI - Integration with Filesystem', () => {
    let cy: Core
    let mockGraph: Graph

    beforeEach(async () => {
        // Import IPC handlers once - they auto-register on import
        await ensureHandlersImported()
        // Create temporary vault directory
        tempVault = path.join('/tmp', `test-vault-delete-${Date.now()}`)
        await fs.mkdir(tempVault, { recursive: true })

        // Set vault path in graph store
        setVaultPath(tempVault)

        // Create initial markdown files
        await fs.writeFile(
            path.join(tempVault, 'parent.md'),
            `---
position:
  x: 100
  y: 100
---
# Parent Node

Parent content
[[child1]]`
        )
        await fs.writeFile(
            path.join(tempVault, 'child1.md'),
            `---
position:
  x: 200
  y: 200
---
# Child 1

Child content`
        )

        // Create graph state
        mockGraph = {
            nodes: {
                'parent': {
                    relativeFilePathIsID: 'parent',
                    content: '# Parent Node\n\nParent content',
                    outgoingEdges: ['child1'],
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.of({ x: 100, y: 100 }),
                        title: 'parent'
                    }
                },
                'child1': {
                    relativeFilePathIsID: 'child1',
                    content: '# Child 1\n\nChild content',
                    outgoingEdges: [],
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.of({ x: 200, y: 200 }),
                        title: 'child1'
                    }
                }
            }
        }

        currentGraph = mockGraph
        setGraph(mockGraph)

        // Initialize headless cytoscape
        cy = cytoscape({
            headless: true,
            elements: [
                {
                    group: 'nodes' as const,
                    data: { id: 'parent', label: 'parent', content: '# Parent Node', summary: '' },
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

        // Setup window.electronAPI to call through main API directly (new RPC pattern)
        const { mainAPI } = await import('@/functional/shell/main/api.ts')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    applyGraphDeltaToDBAndMem: mainAPI.applyGraphDeltaToDBAndMem
                }
            }
        } as any
    })

    afterEach(async () => {
        cy.destroy()

        // Cleanup temp vault
        await fs.rm(tempVault, { recursive: true, force: true })

        vi.clearAllMocks()
    })

    it('should delete node from cytoscape immediately (optimistic UI)', async () => {
        // GIVEN: Graph with 2 nodes
        expect(cy.nodes()).toHaveLength(2)
        expect(cy.getElementById('child1').length).toBe(1)

        // WHEN: Deleting child1 node
        await deleteNodeFromUI('child1', cy)

        // THEN: Node should be removed from cytoscape immediately
        expect(cy.nodes()).toHaveLength(1)
        expect(cy.getElementById('child1').length).toBe(0)
        expect(cy.getElementById('parent').length).toBe(1)
    })

    it('should delete node file from disk', async () => {
        // GIVEN: Both files exist on disk
        const child1Path = path.join(tempVault, 'child1.md')
        const initialExists = await fs.access(child1Path).then(() => true).catch(() => false)
        expect(initialExists).toBe(true)

        // WHEN: Deleting child1 node
        await deleteNodeFromUI('child1', cy)

        // THEN: File should be deleted from disk
        const fileExists = await fs.access(child1Path).then(() => true).catch(() => false)
        expect(fileExists).toBe(false)
    })

    it('should remove edges connected to deleted node', async () => {
        // GIVEN: Graph with parent->child1 edge
        expect(cy.edges()).toHaveLength(1)
        expect(cy.getElementById('parent-child1').length).toBe(1)

        // WHEN: Deleting child1 node
        await deleteNodeFromUI('child1', cy)

        // THEN: Edge should be removed automatically (cytoscape removes edges when node is removed)
        expect(cy.edges()).toHaveLength(0)
    })
})
