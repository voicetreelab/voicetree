/**
 * Integration test for saveNodePositions
 *
 * BEHAVIOR TESTED:
 * - saveNodePositions updates in-memory graph with positions from Cytoscape
 * - Positions are preserved when node is written to disk via UpsertNode delta
 * - BUG DEMONSTRATION: Positions are LOST when FS event reloads node from disk
 *   (if positions weren't in the YAML frontmatter)
 *
 * ARCHITECTURE CONTEXT:
 * - saveNodePositions: Updates in-memory state only (no disk write)
 * - FS events: Parse markdown from disk, overwriting in-memory state
 * - This means: in-memory positions are lost when FS events reload nodes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveNodePositions } from '@/shell/edge/main/saveNodePositions'
import { getGraph, setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath, clearVaultPath } from '@/shell/edge/main/graph/watchFolder'
import { loadFolder, stopFileWatching, isWatching } from '@/shell/edge/main/graph/watchFolder'
import type { GraphNode, Graph, GraphDelta } from '@/pure/graph'
import type { NodeDefinition } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import { promises as fs } from 'fs'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths'
import { waitForFSEvent, waitForWatcherReady, waitForCondition } from '@/utils/test-utils/waitForCondition'
import { clearRecentDeltas } from '@/shell/edge/main/state/recent-deltas-store'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";

const TEST_NODE_ID: string = 'test-position-node.md'
const TEST_FILE_PATH: string = path.join(EXAMPLE_SMALL_PATH, TEST_NODE_ID)

// State for mocks
let mockMainWindow: { readonly webContents: { readonly send: (channel: string, data: GraphDelta) => void }, readonly isDestroyed: () => boolean }

// Mock electron app for settings path
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now())
    }
}))

// Mock app-electron-state
vi.mock('@/shell/edge/main/state/app-electron-state', () => ({
    getMainWindow: vi.fn(() => mockMainWindow),
    setMainWindow: vi.fn()
}))

describe('saveNodePositions - Integration Tests', () => {
    beforeEach(() => {
        // Initialize state with empty graph and example_small vault path
        setGraph({ nodes: {} })
        setVaultPath(EXAMPLE_SMALL_PATH)
        clearRecentDeltas()

        // Create mock BrowserWindow
        mockMainWindow = {
            webContents: {
                send: vi.fn()
            },
            isDestroyed: vi.fn(() => false)
        }
    })

    afterEach(async () => {
        // Stop file watching if active
        if (isWatching()) {
            await stopFileWatching()
        }

        // Clean up test file if it exists
        await fs.unlink(TEST_FILE_PATH).catch(() => {
            // File might not exist, that's ok
        })

        clearVaultPath()
        vi.clearAllMocks()
    })

    describe('BEHAVIOR: saveNodePositions updates in-memory graph state', () => {
        it('should update node positions in memory when called with Cytoscape node data', () => {
            // GIVEN: A graph with a node that has no position
            const testNode: GraphNode = {
                relativeFilePathIsID: TEST_NODE_ID,
                contentWithoutYamlOrLinks: '# Test Position Node\n\nContent here.',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            setGraph({ nodes: { [TEST_NODE_ID]: testNode } })

            // Verify initial state - no position
            const graphBefore: Graph = getGraph()
            expect(O.isNone(graphBefore.nodes[TEST_NODE_ID].nodeUIMetadata.position)).toBe(true)

            // WHEN: Call saveNodePositions with Cytoscape node data
            const cyNodes: readonly NodeDefinition[] = [
                {
                    data: { id: TEST_NODE_ID },
                    position: { x: 150, y: 250 }
                }
            ]

            saveNodePositions(cyNodes)

            // THEN: Position should be updated in memory
            const graphAfter: Graph = getGraph()
            const nodeAfter: GraphNode = graphAfter.nodes[TEST_NODE_ID]

            expect(O.isSome(nodeAfter.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(nodeAfter.nodeUIMetadata.position)) {
                expect(nodeAfter.nodeUIMetadata.position.value.x).toBe(150)
                expect(nodeAfter.nodeUIMetadata.position.value.y).toBe(250)
            }
        })

        it('should update positions for multiple nodes at once', () => {
            // GIVEN: A graph with multiple nodes without positions
            const node1: GraphNode = {
                relativeFilePathIsID: 'node1.md',
                contentWithoutYamlOrLinks: '# Node 1',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const node2: GraphNode = {
                relativeFilePathIsID: 'node2.md',
                contentWithoutYamlOrLinks: '# Node 2',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            setGraph({ nodes: { 'node1.md': node1, 'node2.md': node2 } })

            // WHEN: Call saveNodePositions with multiple nodes
            const cyNodes: readonly NodeDefinition[] = [
                { data: { id: 'node1.md' }, position: { x: 100, y: 200 } },
                { data: { id: 'node2.md' }, position: { x: 300, y: 400 } }
            ]

            saveNodePositions(cyNodes)

            // THEN: Both positions should be updated
            const graph: Graph = getGraph()

            expect(O.isSome(graph.nodes['node1.md'].nodeUIMetadata.position)).toBe(true)
            expect(O.isSome(graph.nodes['node2.md'].nodeUIMetadata.position)).toBe(true)

            if (O.isSome(graph.nodes['node1.md'].nodeUIMetadata.position)) {
                expect(graph.nodes['node1.md'].nodeUIMetadata.position.value).toEqual({ x: 100, y: 200 })
            }

            if (O.isSome(graph.nodes['node2.md'].nodeUIMetadata.position)) {
                expect(graph.nodes['node2.md'].nodeUIMetadata.position.value).toEqual({ x: 300, y: 400 })
            }
        })
    })

    describe('BEHAVIOR: Positions persist to disk when node is saved', () => {
        it('should write position to disk YAML when UpsertNode delta is applied', async () => {
            // GIVEN: A node with position in memory
            const testNode: GraphNode = {
                relativeFilePathIsID: TEST_NODE_ID,
                contentWithoutYamlOrLinks: '# Test Position Node\n\nContent here.',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 500, y: 600 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: testNode,
                previousNode: O.none
            }]

            // WHEN: Apply delta to write node to disk
            await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta, false)

            // THEN: File should contain position in YAML frontmatter
            const fileContent: string = await fs.readFile(TEST_FILE_PATH, 'utf-8')

            expect(fileContent).toContain('position:')
            expect(fileContent).toContain('x: 500')
            expect(fileContent).toContain('y: 600')
        })
    })

    describe('BEHAVIOR: Position preservation when FS event reloads node', () => {
        it('should PRESERVE in-memory position when file is modified externally (no position in YAML)', async () => {
            // GIVEN: Load folder with file watcher
            await loadFolder(EXAMPLE_SMALL_PATH, '')
            expect(isWatching()).toBe(true)
            await waitForWatcherReady()

            // Create a test file WITHOUT position in YAML
            const testFileContent: string = `---
---
# Test Position Node

Content here.`

            await fs.writeFile(TEST_FILE_PATH, testFileContent, 'utf-8')

            // Wait for file to be added to graph
            await waitForFSEvent()
            await waitForCondition(
                () => !!getGraph().nodes[TEST_NODE_ID],
                { maxWaitMs: 1000, errorMessage: 'test-position-node not added to graph' }
            )

            // Now the node is in memory with no position
            const graphAfterLoad: Graph = getGraph()
            expect(O.isNone(graphAfterLoad.nodes[TEST_NODE_ID].nodeUIMetadata.position)).toBe(true)

            // WHEN: Save positions from Cytoscape (simulating layout completion)
            const cyNodes: readonly NodeDefinition[] = [
                { data: { id: TEST_NODE_ID }, position: { x: 999, y: 888 } }
            ]
            saveNodePositions(cyNodes)

            // Verify position was saved in memory
            const graphAfterSave: Graph = getGraph()
            expect(O.isSome(graphAfterSave.nodes[TEST_NODE_ID].nodeUIMetadata.position)).toBe(true)
            if (O.isSome(graphAfterSave.nodes[TEST_NODE_ID].nodeUIMetadata.position)) {
                expect(graphAfterSave.nodes[TEST_NODE_ID].nodeUIMetadata.position.value).toEqual({ x: 999, y: 888 })
            }

            // WHEN: File is modified externally (without position in YAML)
            const updatedContent: string = `---
---
# Test Position Node

Content here. Updated externally.`

            await fs.writeFile(TEST_FILE_PATH, updatedContent, 'utf-8')

            // Wait for FS event to reload the node
            await waitForFSEvent()
            await waitForCondition(
                () => getGraph().nodes[TEST_NODE_ID]?.contentWithoutYamlOrLinks.includes('Updated externally'),
                { maxWaitMs: 1000, errorMessage: 'Node content not updated from FS event' }
            )

            // THEN: Position should be PRESERVED (merged from in-memory state)
            const graphAfterFSEvent: Graph = getGraph()
            const nodeAfterFSEvent: GraphNode = graphAfterFSEvent.nodes[TEST_NODE_ID]

            expect(O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)) {
                expect(nodeAfterFSEvent.nodeUIMetadata.position.value).toEqual({ x: 999, y: 888 })
            }
        }, 5000)

        it('should PRESERVE position when file has position in YAML frontmatter', async () => {
            // GIVEN: Load folder with file watcher
            await loadFolder(EXAMPLE_SMALL_PATH, '')
            expect(isWatching()).toBe(true)
            await waitForWatcherReady()

            // Create a test file WITH position in YAML
            const testFileContent: string = `---
position:
  x: 123
  y: 456
---
# Test Position Node

Content here.`

            await fs.writeFile(TEST_FILE_PATH, testFileContent, 'utf-8')

            // Wait for file to be added to graph
            await waitForFSEvent()
            await waitForCondition(
                () => !!getGraph().nodes[TEST_NODE_ID],
                { maxWaitMs: 1000, errorMessage: 'test-position-node not added to graph' }
            )

            // Verify position was loaded from YAML
            const graphAfterLoad: Graph = getGraph()
            expect(O.isSome(graphAfterLoad.nodes[TEST_NODE_ID].nodeUIMetadata.position)).toBe(true)

            // WHEN: File is modified (keeping position in YAML)
            const updatedContent: string = `---
position:
  x: 123
  y: 456
---
# Test Position Node

Content here. Updated externally.`

            await fs.writeFile(TEST_FILE_PATH, updatedContent, 'utf-8')

            // Wait for FS event to reload the node
            await waitForFSEvent()
            await waitForCondition(
                () => getGraph().nodes[TEST_NODE_ID]?.contentWithoutYamlOrLinks.includes('Updated externally'),
                { maxWaitMs: 1000, errorMessage: 'Node content not updated from FS event' }
            )

            // THEN: Position should be PRESERVED (it was in the YAML)
            const graphAfterFSEvent: Graph = getGraph()
            const nodeAfterFSEvent: GraphNode = graphAfterFSEvent.nodes[TEST_NODE_ID]

            expect(O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)) {
                expect(nodeAfterFSEvent.nodeUIMetadata.position.value).toEqual({ x: 123, y: 456 })
            }
        }, 5000)
    })
})
