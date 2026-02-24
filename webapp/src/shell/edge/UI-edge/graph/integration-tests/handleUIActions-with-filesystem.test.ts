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
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {Core} from 'cytoscape';
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { createNewChildNodeFromUI, deleteNodesFromUI } from '@/shell/edge/UI-edge/graph/handleUIActions'
import type { Graph, GraphDelta } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import * as fs from 'fs/promises'
import * as path from 'path'
import { setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'

// State managed by mocked globals - using module-level state that the mock functions will access
let currentGraph: Graph | null = null
let tempVault: string = ''

// Use vi.hoisted() for values that need to be available when vi.mock factory runs
const { ipcMain } = vi.hoisted(() => {
    const ipcMain: { _handlers: Map<string, Function>; handle(channel: string, handler: Function): void; removeHandler(channel: string): void; } = {
        _handlers: new Map<string, Function>(),
        handle(channel: string, handler: Function) {
            this._handlers.set(channel, handler)
        },
        removeHandler(channel: string) {
            this._handlers.delete(channel)
        }
    }
    return { ipcMain }
})

// Mock electron module
vi.mock('electron', () => ({
    ipcMain,
    dialog: {
        showOpenDialog: vi.fn()
    },
    app: {
        getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now()),
        whenReady: () => Promise.resolve(),
        on: vi.fn(),
        quit: vi.fn()
    }
}))

// Mock posthog
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
        get_distinct_id: vi.fn(() => 'test-user-id')
    }
}))

// Mock agentTabsActivity
vi.mock('@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity', async (importOriginal) => {
    const actual: typeof import('@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity') = await importOriginal<typeof import('@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity')>()
    return {
        ...actual,
        markTerminalActivityForContextNode: vi.fn()
    }
})

// Mock graph store
vi.mock('@/shell/edge/main/state/graph-store', () => {
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
        getNode: (nodeId: string) => {
            if (!currentGraph) {
                throw new Error('Graph not initialized')
            }
            return currentGraph.nodes[nodeId]
        }
    }
})

// Mock watch-folder-store for watched directory state
vi.mock('@/shell/edge/main/state/watch-folder-store', () => {
    return {
        getWatcher: vi.fn(() => null),
        setWatcher: vi.fn(),
        getProjectRootWatchedDirectory: () => tempVault || null,
        setProjectRootWatchedDirectory: vi.fn(),
        getStartupFolderOverride: vi.fn(() => null),
        setStartupFolderOverride: vi.fn(),
        getOnFolderSwitchCleanup: vi.fn(() => null),
        setOnFolderSwitchCleanup: vi.fn(),
        clearWatchFolderState: vi.fn()
    }
})

// Mock watchFolder for vault path functions
vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', async (importOriginal) => {
    const actual: typeof import('@/shell/edge/main/graph/watch_folder/watchFolder') = await importOriginal<typeof import('@/shell/edge/main/graph/watch_folder/watchFolder')>()
    return {
        ...actual,
        getVaultPath: () => {
            return tempVault ? O.of(tempVault) : O.none
        },
        setVaultPath: (path: string) => {
            tempVault = path
        },
        clearVaultPath: () => {
            tempVault = ''
        },
        startFileWatching: vi.fn().mockResolvedValue({ success: true }),
        stopFileWatching: vi.fn().mockResolvedValue({ success: true }),
        initialLoad: vi.fn().mockResolvedValue(undefined),
        getWatchStatus: vi.fn(() => ({ isWatching: false, directory: undefined })),
        loadPreviousFolder: vi.fn().mockResolvedValue({ success: false }),
        isWatching: vi.fn(() => false),
        getWatchedDirectory: () => tempVault || null,
        loadFolder: vi.fn().mockResolvedValue(undefined),
        markFrontendReady: vi.fn().mockResolvedValue(undefined)
    }
})

// Import IPC handlers once at module level
let handlersImported: boolean = false
async function ensureHandlersImported(): Promise<void> {
    if (!handlersImported) {
        const { registerTerminalIpcHandlers } = await import('@/shell/edge/main/terminals/ipc-terminal-handlers')
        registerTerminalIpcHandlers(
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
[[child1.md]]`
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

        // Create graph state with correct node IDs including .md extension
        mockGraph = createGraph({
            'parent.md': {
                absoluteFilePathIsID: 'parent.md',
                contentWithoutYamlOrLinks: '# Parent Node\n\nParent content',
                outgoingEdges: [{ targetId: 'child1.md', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.of({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            },
            'child1.md': {
                absoluteFilePathIsID: 'child1.md',
                contentWithoutYamlOrLinks: '# Child 1\n\nChild content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.of({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }
        })

        currentGraph = mockGraph
        setGraph(mockGraph)

        // Initialize headless cytoscape
        cy = cytoscape({
            headless: true,
            elements: [
                {
                    group: 'nodes' as const,
                    data: { id: 'parent.md', label: 'parent', content: '# Parent GraphNode', summary: '' },
                    position: { x: 100, y: 100 }
                },
                {
                    group: 'nodes' as const,
                    data: { id: 'child1.md', label: 'child1', content: '# Child 1', summary: '' },
                    position: { x: 200, y: 200 }
                },
                {
                    group: 'edges' as const,
                    data: { id: 'parent.md-child1.md', source: 'parent.md', target: 'child1.md' }
                }
            ]
        })

        // Setup window.electronAPI to call through main API directly (new RPC pattern)
        // Wrap applyGraphDeltaToDBThroughMem to also update cytoscape UI
        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        // Also update cytoscape UI since file watching is mocked
                        applyGraphDeltaToUI(cy, delta)
                    }
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
        await createNewChildNodeFromUI('parent.md', cy)

        // THEN: Cytoscape should have 3 nodes
        expect(cy.nodes()).toHaveLength(3)

        // AND: Should have 2 edges
        expect(cy.edges()).toHaveLength(2)

        // AND: The new node should exist in cytoscape (parent.md -> parent_1.md by stripping .md and adding _1.md)
        const newNodeId: string = 'parent_1.md'
        const newNode: cytoscape.CollectionReturnValue = cy.getElementById(newNodeId)
        expect(newNode.length).toBe(1)

        // AND: File should be created on disk
        const newFilePath: string = path.join(tempVault, newNodeId)
        const fileExists: boolean = await fs.access(newFilePath).then(() => true).catch(() => false)
        expect(fileExists).toBe(true)

        // AND: File should have correct content (new nodes start with empty heading "# ")
        const fileContent: string = await fs.readFile(newFilePath, 'utf-8')
        expect(fileContent).toContain('#')
    })

    it('should create file with correct position metadata eventually', async () => {
        // GIVEN: Graph with 2 nodes
        const initialFileCount: number = (await fs.readdir(tempVault)).length

        // WHEN: Creating a new child node
        await createNewChildNodeFromUI('parent.md', cy)

        // THEN: Should have one more file
        const files: string[] = await fs.readdir(tempVault)
        expect(files).toHaveLength(initialFileCount + 1)

        // AND: New file should exist with expected name (parent.md -> parent_1.md by stripping .md and adding _1.md)
        const newNodeId: string = 'parent_1.md'
        expect(files).toContain(newNodeId)

        // AND: File should be readable and parseable
        const newFilePath: string = path.join(tempVault, `${newNodeId}`)
        const stat: import("fs").Stats = await fs.stat(newFilePath)
        expect(stat.isFile()).toBe(true)
        expect(stat.size).toBeGreaterThan(0)
    })

    it('should update parent file with edge to new child', async () => {
        // GIVEN: Parent node with one existing child
        const parentFilePath: string = path.join(tempVault, 'parent.md')
        const initialParentContent: string = await fs.readFile(parentFilePath, 'utf-8')

        // Verify parent initially has only child1
        expect(initialParentContent).toContain('[[child1.md]]')
        expect(initialParentContent).not.toContain('[[parent_1.md]]')

        // WHEN: Creating a new child node
        await createNewChildNodeFromUI('parent.md', cy)

        // THEN: Parent file should be updated with edge to new child
        const updatedParentContent: string = await fs.readFile(parentFilePath, 'utf-8')

        // Parent should now have both edges (wikilinks include node IDs with .md extension)
        expect(updatedParentContent).toContain('[[child1.md]]')
        expect(updatedParentContent).toContain('[[parent_1.md]]')
    })
})

describe('deleteNodesFromUI - Integration with Filesystem', () => {
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
[[child1.md]]`
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
        mockGraph = createGraph({
            'parent.md': {
                absoluteFilePathIsID: 'parent.md',
                contentWithoutYamlOrLinks: '# Parent Node\n\nParent content',
                outgoingEdges: [{ targetId: 'child1.md', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.of({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            },
            'child1.md': {
                absoluteFilePathIsID: 'child1.md',
                contentWithoutYamlOrLinks: '# Child 1\n\nChild content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.of({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }
        })

        currentGraph = mockGraph
        setGraph(mockGraph)

        // Initialize headless cytoscape
        cy = cytoscape({
            headless: true,
            elements: [
                {
                    group: 'nodes' as const,
                    data: { id: 'parent.md', label: 'parent', content: '# Parent Node', summary: '' },
                    position: { x: 100, y: 100 }
                },
                {
                    group: 'nodes' as const,
                    data: { id: 'child1.md', label: 'child1', content: '# Child 1', summary: '' },
                    position: { x: 200, y: 200 }
                },
                {
                    group: 'edges' as const,
                    data: { id: 'parent.md-child1.md', source: 'parent.md', target: 'child1.md' }
                }
            ]
        })

        // Setup window.electronAPI to call through main API directly (new RPC pattern)
        // Wrap applyGraphDeltaToDBThroughMem to also update cytoscape UI
        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        // Also update cytoscape UI since file watching is mocked
                        applyGraphDeltaToUI(cy, delta)
                    }
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

    it('should delete node from cytoscape immediately (optimistic UI-edge)', async () => {
        // GIVEN: Graph with 2 nodes
        expect(cy.nodes()).toHaveLength(2)
        expect(cy.getElementById('child1.md').length).toBe(1)

        // WHEN: Deleting child1 node
        await deleteNodesFromUI(['child1.md'], cy)

        // THEN: Node should be removed from cytoscape immediately
        expect(cy.nodes()).toHaveLength(1)
        expect(cy.getElementById('child1.md').length).toBe(0)
        expect(cy.getElementById('parent.md').length).toBe(1)
    })

    it('should delete node file from disk', async () => {
        // GIVEN: Both files exist on disk
        const child1Path: string = path.join(tempVault, 'child1.md')
        const initialExists: boolean = await fs.access(child1Path).then(() => true).catch(() => false)
        expect(initialExists).toBe(true)

        // WHEN: Deleting child1 node
        await deleteNodesFromUI(['child1.md'], cy)

        // THEN: File should be deleted from disk
        const fileExists: boolean = await fs.access(child1Path).then(() => true).catch(() => false)
        expect(fileExists).toBe(false)
    })

    it('should remove edges connected to deleted node', async () => {
        // GIVEN: Graph with parent->child1 edge
        expect(cy.edges()).toHaveLength(1)
        expect(cy.getElementById('parent.md-child1.md').length).toBe(1)

        // WHEN: Deleting child1 node
        await deleteNodesFromUI(['child1.md'], cy)

        // THEN: Edge should be removed automatically (cytoscape removes edges when node is removed)
        expect(cy.edges()).toHaveLength(0)
    })
})
