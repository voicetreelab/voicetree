/**
 * Integration test for saveNodePositions
 *
 * BEHAVIOR TESTED:
 * - saveNodePositions updates in-memory graph with positions from Cytoscape
 * - Positions are NOT written to YAML frontmatter (stored in .voicetree/positions.json)
 * - Positions are preserved when FS event reloads node from disk (in-memory merge)
 * - Legacy YAML positions are still parsed for migration
 *
 * ARCHITECTURE CONTEXT:
 * - saveNodePositions: Updates in-memory state only (no disk write)
 * - Positions persist to .voicetree/positions.json on app exit / folder switch
 * - FS events: Parse markdown from disk, in-memory positions preserved via merge
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveNodePositions } from '@/shell/edge/main/saveNodePositions'
import { getGraph, setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath, clearVaultPath } from '@vt/graph-db-server/watch-folder/watchFolder'
import { loadFolder, stopFileWatching, isWatching } from '@vt/graph-db-server/watch-folder/watchFolder'
import type { GraphNode, Graph, GraphDelta } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import type { NodeDefinition } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import os from 'os'
import { promises as fs } from 'fs'
import { waitForFSEvent, waitForWatcherReady, waitForCondition } from '@/utils/test-utils/waitForCondition'
import { clearRecentDeltas } from '@vt/graph-db-server/state/recent-deltas-store'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@vt/graph-db-server/graph/applyGraphDelta'
import { initGraphModel } from '@vt/graph-model'
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'

// State for mocks
let mockMainWindow: { readonly webContents: { readonly send: (channel: string, data: GraphDelta) => void; readonly isDestroyed: () => boolean }, readonly isDestroyed: () => boolean }
let testTmpDir: string
let testProjectPath: string
let testVoicetreeDir: string
let testFilePath: string
let testNodeId: string

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
    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'save-node-positions-'))
        testProjectPath = path.join(testTmpDir, 'project')
        testVoicetreeDir = path.join(testProjectPath, 'voicetree')
        testFilePath = path.join(testVoicetreeDir, 'test-position-node.md')
        testNodeId = testFilePath
        await fs.mkdir(testVoicetreeDir, { recursive: true })

        initGraphModel({ appSupportPath: path.join(testTmpDir, 'app-support') })
        await saveVaultConfigForDirectory(testProjectPath, { writePath: testVoicetreeDir })
        // Initialize state with empty graph and the temp project path
        setGraph(createGraph({}))
        setVaultPath(testProjectPath)
        clearRecentDeltas()

        // Create mock BrowserWindow
        mockMainWindow = {
            webContents: {
                send: vi.fn(),
                isDestroyed: vi.fn(() => false)
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
        await fs.rm(testTmpDir, { recursive: true, force: true })

        clearVaultPath()
        vi.clearAllMocks()
    })

    describe('BEHAVIOR: saveNodePositions updates in-memory graph state', () => {
        it('should update node positions in memory when called with Cytoscape node data', () => {
            // GIVEN: A graph with a node that has no position
            const testNode: GraphNode = {
                absoluteFilePathIsID: testNodeId,
                contentWithoutYamlOrLinks: '# Test Position Node\n\nContent here.',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            setGraph(createGraph({ [testNodeId]: testNode }))

            // Verify initial state - no position
            const graphBefore: Graph = getGraph()
            expect(O.isNone(graphBefore.nodes[testNodeId].nodeUIMetadata.position)).toBe(true)

            // WHEN: Call saveNodePositions with Cytoscape node data
            const cyNodes: readonly NodeDefinition[] = [
                {
                    data: { id: testNodeId },
                    position: { x: 150, y: 250 }
                }
            ]

            saveNodePositions(cyNodes)

            // THEN: Position should be updated in memory
            const graphAfter: Graph = getGraph()
            const nodeAfter: GraphNode = graphAfter.nodes[testNodeId]

            expect(O.isSome(nodeAfter.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(nodeAfter.nodeUIMetadata.position)) {
                expect(nodeAfter.nodeUIMetadata.position.value.x).toBe(150)
                expect(nodeAfter.nodeUIMetadata.position.value.y).toBe(250)
            }
        })

        it('should update positions for multiple nodes at once', () => {
            // GIVEN: A graph with multiple nodes without positions
            const node1: GraphNode = {
                absoluteFilePathIsID: 'node1.md',
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
                absoluteFilePathIsID: 'node2.md',
                contentWithoutYamlOrLinks: '# Node 2',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            setGraph(createGraph({ 'node1.md': node1, 'node2.md': node2 }))

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

    describe('BEHAVIOR: Positions are NOT written to YAML (stored in .voicetree/positions.json)', () => {
        it('should NOT write position to disk YAML when UpsertNode delta is applied', async () => {
            // Positions are stored in .voicetree/positions.json, not in markdown YAML
            const testNode: GraphNode = {
                absoluteFilePathIsID: testNodeId,
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

            // THEN: File should NOT contain position in YAML frontmatter
            const fileContent: string = await fs.readFile(testFilePath, 'utf-8')

            expect(fileContent).not.toContain('position:')
            expect(fileContent).not.toContain('x: 500')
            expect(fileContent).not.toContain('y: 600')
        })
    })

    describe('BEHAVIOR: Position preservation when FS event reloads node', () => {
        it('should PRESERVE in-memory position when file is modified externally (no position in YAML)', async () => {
            // GIVEN: Load folder with file watcher
            await loadFolder(testProjectPath)
            expect(isWatching()).toBe(true)
            await waitForWatcherReady()

            // Create a test file WITHOUT position in YAML
            const testFileContent: string = `---
---
# Test Position Node

Content here.`

            await fs.writeFile(testFilePath, testFileContent, 'utf-8')

            // Wait for file to be added to graph
            await waitForFSEvent()
            await waitForCondition(
                () => !!getGraph().nodes[testNodeId],
                { maxWaitMs: 1000, errorMessage: 'test-position-node not added to graph' }
            )

            // Now the node is in memory with no position
            const graphAfterLoad: Graph = getGraph()
            expect(O.isNone(graphAfterLoad.nodes[testNodeId].nodeUIMetadata.position)).toBe(true)

            // WHEN: Save positions from Cytoscape (simulating layout completion)
            const cyNodes: readonly NodeDefinition[] = [
                { data: { id: testNodeId }, position: { x: 999, y: 888 } }
            ]
            saveNodePositions(cyNodes)

            // Verify position was saved in memory
            const graphAfterSave: Graph = getGraph()
            expect(O.isSome(graphAfterSave.nodes[testNodeId].nodeUIMetadata.position)).toBe(true)
            if (O.isSome(graphAfterSave.nodes[testNodeId].nodeUIMetadata.position)) {
                expect(graphAfterSave.nodes[testNodeId].nodeUIMetadata.position.value).toEqual({ x: 999, y: 888 })
            }

            // WHEN: File is modified externally (without position in YAML)
            const updatedContent: string = `---
---
# Test Position Node

Content here. Updated externally.`

            await fs.writeFile(testFilePath, updatedContent, 'utf-8')

            // Wait for FS event to reload the node
            await waitForFSEvent()
            await waitForCondition(
                () => getGraph().nodes[testNodeId]?.contentWithoutYamlOrLinks.includes('Updated externally'),
                { maxWaitMs: 1000, errorMessage: 'Node content not updated from FS event' }
            )

            // THEN: Position should be PRESERVED (merged from in-memory state)
            const graphAfterFSEvent: Graph = getGraph()
            const nodeAfterFSEvent: GraphNode = graphAfterFSEvent.nodes[testNodeId]

            expect(O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)) {
                expect(nodeAfterFSEvent.nodeUIMetadata.position.value).toEqual({ x: 999, y: 888 })
            }
        }, 5000)

        it('should PRESERVE position when file has position in YAML frontmatter', async () => {
            // GIVEN: Load folder with file watcher
            await loadFolder(testProjectPath)
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

            await fs.writeFile(testFilePath, testFileContent, 'utf-8')

            // Wait for file to be added to graph
            await waitForFSEvent()
            await waitForCondition(
                () => !!getGraph().nodes[testNodeId],
                { maxWaitMs: 1000, errorMessage: 'test-position-node not added to graph' }
            )

            // Verify position was loaded from YAML
            const graphAfterLoad: Graph = getGraph()
            expect(O.isSome(graphAfterLoad.nodes[testNodeId].nodeUIMetadata.position)).toBe(true)

            // WHEN: File is modified (keeping position in YAML)
            const updatedContent: string = `---
position:
  x: 123
  y: 456
---
# Test Position Node

Content here. Updated externally.`

            await fs.writeFile(testFilePath, updatedContent, 'utf-8')

            // Wait for FS event to reload the node (may need longer for chokidar to detect second change)
            await waitForFSEvent()
            await waitForCondition(
                () => getGraph().nodes[testNodeId]?.contentWithoutYamlOrLinks.includes('Updated externally'),
                { maxWaitMs: 3000, errorMessage: 'Node content not updated from FS event' }
            )

            // THEN: Position should be PRESERVED (it was in the YAML)
            const graphAfterFSEvent: Graph = getGraph()
            const nodeAfterFSEvent: GraphNode = graphAfterFSEvent.nodes[testNodeId]

            expect(O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(nodeAfterFSEvent.nodeUIMetadata.position)) {
                expect(nodeAfterFSEvent.nodeUIMetadata.position.value).toEqual({ x: 123, y: 456 })
            }
        }, 8000)
    })
})
