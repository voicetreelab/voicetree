/**
 * Integration test for folder loading functionality
 *
 * BEHAVIOR TESTED:
 * - INPUT: Load a directory (via loadLastDirectory mock or loadFolder)
 * - OUTPUT: Graph state correctly populated
 * - SIDE EFFECTS: Broadcast to renderer with graph delta
 *
 * This tests the integration of:
 * - Loading a graph from disk
 * - Updating graph state
 * - Broadcasting deltas to the UI
 * - Switching between different directories
 *
 * Testing Strategy:
 * - Load example_small via mocked loadLastDirectory
 * - Load example_real_large via loadFolder
 * - Load example_small again via loadFolder
 * - Verify graph state after each load (node count, edges, content)
 * - Mock IPC to verify deltas are broadcast correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadFolder, stopWatching, isWatching } from '@/functional_graph/shell/main/watchFolder'
import { getGraph, setGraph, setVaultPath } from '@/functional_graph/shell/state/graph-store'
import type { GraphDelta } from '@/functional_graph/pure/types'
import path from 'path'
import { promises as fs } from 'fs'
import type { BrowserWindow } from 'electron'

// Track IPC broadcasts
interface BroadcastCall {
  channel: string
  delta: GraphDelta
}

const EXAMPLE_SMALL_PATH = path.resolve(__dirname, '../../fixtures/example_small')
const EXAMPLE_LARGE_PATH = path.resolve(__dirname, '../../fixtures/example_real_large')

// Expected counts (based on actual fixtures)
const EXPECTED_SMALL_NODE_COUNT = 6
const EXPECTED_LARGE_NODE_COUNT = 56

// State for mocks
let broadcastCalls: BroadcastCall[] = []
let mockMainWindow: { webContents: { send: (channel: string, data: GraphDelta) => void }, isDestroyed: () => boolean }

// Mock app-electron-state
vi.mock('@/functional_graph/shell/state/app-electron-state', () => ({
  getMainWindow: vi.fn(() => mockMainWindow),
  setMainWindow: vi.fn()
}))

// Mock electron app - point to a temp directory that doesn't exist
// This way loadLastDirectory will fail gracefully without needing to mock fs
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now())
  }
}))

describe('Folder Loading - Integration Tests', () => {
  beforeEach(() => {
    // Reset graph state
    setGraph({ nodes: {} })
    setVaultPath('')

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: GraphDelta) => {
          broadcastCalls.push({ channel, delta: data })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopWatching()

    // Clean up test file if it exists
    const testFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
    try {
      await fs.unlink(testFilePath)
    } catch {
      // File might not exist, that's ok
    }

    vi.clearAllMocks()
  })

  describe('BEHAVIOR: Load directory and populate graph state', () => {
    it('should load example_small and populate graph with correct node count', async () => {
      // WHEN: Load example_small directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Graph should have expected number of nodes
      const graph = getGraph()
      const nodeCount = Object.keys(graph.nodes).length

      expect(nodeCount).toBe(EXPECTED_SMALL_NODE_COUNT)

      // AND: Nodes should have content
      const nodes = Object.values(graph.nodes)
      expect(nodes.length).toBeGreaterThan(0)
      nodes.forEach(node => {
        expect(node.content).toBeDefined()
        expect(node.content.length).toBeGreaterThan(0)
        expect(node.relativeFilePathIsID).toBeDefined()
      })

      // AND: Should broadcast delta to UI
      expect(broadcastCalls.length).toBeGreaterThan(0)
      expect(broadcastCalls[0].channel).toBe('graph:stateChanged')
      expect(broadcastCalls[0].delta).toBeDefined()
    })

    it('should load example_real_large and populate graph with correct node count', async () => {
      // WHEN: Load example_real_large directory
      await loadFolder(EXAMPLE_LARGE_PATH)

      // THEN: Graph should have expected number of nodes
      const graph = getGraph()
      const nodeCount = Object.keys(graph.nodes).length

      expect(nodeCount).toBe(EXPECTED_LARGE_NODE_COUNT)

      // AND: Nodes should have content
      const nodes = Object.values(graph.nodes)
      expect(nodes.length).toBeGreaterThan(0)
      nodes.forEach(node => {
        expect(node.content).toBeDefined()
        expect(node.content.length).toBeGreaterThan(0)
      })

      // AND: Should broadcast delta to UI
      expect(broadcastCalls.length).toBeGreaterThan(0)
      expect(broadcastCalls[0].channel).toBe('graph:stateChanged')
    })
  })

  describe('BEHAVIOR: Verify edges are extracted correctly', () => {
    it('should extract edges from markdown links in loaded files', async () => {
      // WHEN: Load directory with linked files
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Graph should have some edges (at least one file should link to another)
      const graph = getGraph()
      const edgeEntries = Object.entries(graph.nodes)
        .filter(([, node]) => node.outgoingEdges && node.outgoingEdges.length > 0)

      // We expect at least some nodes to have outgoing edges
      expect(edgeEntries.length).toBeGreaterThan(0)

      // Verify edge structure
      edgeEntries.forEach(([, node]) => {
        expect(Array.isArray(node.outgoingEdges)).toBe(true)
        node.outgoingEdges?.forEach(targetId => {
          expect(typeof targetId).toBe('string')
          expect(targetId.length).toBeGreaterThan(0)
        })
      })
    })
  })

  describe('BEHAVIOR: Load and switch between directories', () => {
    it('should load small → large → small and maintain correct state throughout', async () => {
      // STEP 1: Load example_small (simulating auto-load on startup)
      await loadFolder(EXAMPLE_SMALL_PATH)

      const graph1 = getGraph()
      expect(Object.keys(graph1.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify nodes have content and edges
      const smallNodeIds = new Set(Object.keys(graph1.nodes))
      Object.values(graph1.nodes).forEach(node => {
        expect(node.content.length).toBeGreaterThan(0)
        expect(Array.isArray(node.outgoingEdges)).toBe(true)
      })

      // Verify at least some edges exist in small graph
      const smallEdgesCount = Object.values(graph1.nodes)
        .filter(node => node.outgoingEdges.length > 0).length
      expect(smallEdgesCount).toBeGreaterThan(0)

      const firstBroadcastCount = broadcastCalls.length
      expect(firstBroadcastCount).toBe(1)

      // Verify that file watcher was set up after loading
      expect(isWatching()).toBe(true)

      // STEP 1b: Test real filesystem changes with chokidar
      // Clear broadcasts from initial load
      broadcastCalls.length = 0

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000))

      const testFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const testFileContent = '# Test New File\n\nThis is a test file for chokidar detection.'

      // Create a new file on disk
      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for chokidar to detect the file addition (with awaitWriteFinish it takes ~1-2 seconds)
      // Poll for the node to appear in the graph
      let nodeAdded = false
      const maxWaitTime = 5000 // 5 seconds max
      const pollInterval = 200 // Check every 200ms
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        if (currentGraph.nodes['test-new-file']) {
          nodeAdded = true
          break
        }
      }

      // Verify the node was added to the graph
      expect(nodeAdded).toBe(true)
      const graphAfterAdd = getGraph()
      expect(graphAfterAdd.nodes['test-new-file']).toBeDefined()
      expect(graphAfterAdd.nodes['test-new-file'].content).toBe(testFileContent)
      expect(Object.keys(graphAfterAdd.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT + 1)

      // Verify broadcast was sent
      expect(broadcastCalls.length).toBeGreaterThan(0)
      const addBroadcast = broadcastCalls.find(call =>
        call.delta.some(d => d.type === 'UpsertNode' && d.nodeToUpsert.relativeFilePathIsID === 'test-new-file')
      )
      expect(addBroadcast).toBeDefined()

      // Reset broadcast tracking
      broadcastCalls.length = 0

      // Delete the file
      await fs.unlink(testFilePath)

      // Wait for chokidar to detect the file deletion
      let nodeDeleted = false
      const deleteStartTime = Date.now()

      while (Date.now() - deleteStartTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        if (!currentGraph.nodes['test-new-file']) {
          nodeDeleted = true
          break
        }
      }

      // Verify the node was removed from the graph
      expect(nodeDeleted).toBe(true)
      const graphAfterDelete = getGraph()
      expect(graphAfterDelete.nodes['test-new-file']).toBeUndefined()
      expect(Object.keys(graphAfterDelete.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify broadcast was sent
      expect(broadcastCalls.length).toBeGreaterThan(0)
      const deleteBroadcast = broadcastCalls.find(call =>
        call.delta.some(d => d.type === 'DeleteNode' && d.nodeId === 'test-new-file')
      )
      expect(deleteBroadcast).toBeDefined()

      // Reset broadcasts for next steps
      broadcastCalls.length = 0

      // STEP 2: Load example_real_large (user switches to larger directory)
      await loadFolder(EXAMPLE_LARGE_PATH)

      const graph2 = getGraph()
      expect(Object.keys(graph2.nodes).length).toBe(EXPECTED_LARGE_NODE_COUNT)

      const largeNodeIds = new Set(Object.keys(graph2.nodes))

      // Verify the graph was completely replaced (not merged)
      expect(largeNodeIds.size).toBeGreaterThan(smallNodeIds.size)

      // Verify nodes have content
      Object.values(graph2.nodes).forEach(node => {
        expect(node.content.length).toBeGreaterThan(0)
      })

      const secondBroadcastCount = broadcastCalls.length
      expect(secondBroadcastCount).toBe(1) // One broadcast for the load

      // STEP 3: Load example_small again (user switches back)
      await loadFolder(EXAMPLE_SMALL_PATH)

      const graph3 = getGraph()
      expect(Object.keys(graph3.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify we're back to small graph (same count, not same instances necessarily)
      const finalNodeIds = new Set(Object.keys(graph3.nodes))
      expect(finalNodeIds.size).toBe(smallNodeIds.size)

      // Verify edges are still present after switching back
      const finalEdgesCount = Object.values(graph3.nodes)
        .filter(node => node.outgoingEdges.length > 0).length
      expect(finalEdgesCount).toBeGreaterThan(0)

      // Verify all broadcasts used the correct channel
      broadcastCalls.forEach(call => {
        expect(call.channel).toBe('graph:stateChanged')
        expect(Array.isArray(call.delta)).toBe(true)
      })

      // Verify that file watcher was set up after loading
      expect(isWatching()).toBe(true)
    }, 30000) // Increased timeout to 30 seconds for filesystem operations

    it('should detect file addition and deletion after folder is loaded', async () => {
      // GIVEN: Load a folder and wait for watcher to be ready
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(isWatching()).toBe(true)

      // Clear broadcasts from initial load
      broadcastCalls.length = 0

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 300))

      // WHEN: Add a new file using the file watching handler module's approach
      // Since chokidar doesn't reliably detect files in test env, we simulate the FS event
      const newFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const newFileContent = '# Test New File\n\nThis is a test.'

      await fs.writeFile(newFilePath, newFileContent, 'utf-8')

      // Import and call the FS event handler directly to simulate watcher detection
      const { handleFSEventWithStateAndUISides } = await import('@/functional_graph/shell/main/handleFSEventWithStateAndUISides')

      const addEvent = {
        absolutePath: newFilePath,
        content: newFileContent,
        eventType: 'Added' as const
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleFSEventWithStateAndUISides(addEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // THEN: Graph should contain the new node
      const graph = getGraph()
      expect(graph.nodes['test-new-file']).toBeDefined()
      expect(graph.nodes['test-new-file'].content).toBe(newFileContent)

      // AND: Broadcast should have been sent
      expect(broadcastCalls.length).toBe(1)
      expect(broadcastCalls[0].channel).toBe('graph:stateChanged')

      // Verify the delta contains UpsertNode action
      const addDelta = broadcastCalls[0].delta.find(d => d.type === 'UpsertNode')
      expect(addDelta).toBeDefined()

      // WHEN: Delete the file
      broadcastCalls.length = 0
      await fs.unlink(newFilePath)

      const deleteEvent = {
        absolutePath: newFilePath,
        content: '',
        eventType: 'Deleted' as const
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleFSEventWithStateAndUISides(deleteEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // THEN: Node should be removed from graph
      const graphAfterDelete = getGraph()
      expect(graphAfterDelete.nodes['test-new-file']).toBeUndefined()

      // AND: Broadcast should have been sent
      expect(broadcastCalls.length).toBe(1)
      expect(broadcastCalls[0].channel).toBe('graph:stateChanged')

      // Verify the delta contains DeleteNode action
      const deleteDelta = broadcastCalls[0].delta.find(d => d.type === 'DeleteNode')
      expect(deleteDelta).toBeDefined()
    })
  })

  describe('BEHAVIOR: Broadcast deltas on load', () => {
    it('should broadcast GraphDelta when loading a directory', async () => {
      // WHEN: Load directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Should have broadcast exactly once
      expect(broadcastCalls.length).toBe(1)

      const broadcast = broadcastCalls[0]

      // AND: Should use correct channel
      expect(broadcast.channel).toBe('graph:stateChanged')

      // AND: Delta should be an array of NodeDeltas
      expect(Array.isArray(broadcast.delta)).toBe(true)

      // AND: Delta should contain node additions for all loaded nodes
      expect(broadcast.delta.length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify each delta has the expected structure (UpsertNodeAction or DeleteNode)
      broadcast.delta.forEach(nodeDelta => {
        expect(nodeDelta).toHaveProperty('type')
        // UpsertNodeAction should have nodeToUpsert property
        if (nodeDelta.type === 'UpsertNode') {
          expect(nodeDelta).toHaveProperty('nodeToUpsert')
        }
      })
    })

    it('should broadcast delta when switching directories', async () => {
      // GIVEN: Load first directory
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(broadcastCalls.length).toBe(1)

      // WHEN: Load second directory
      await loadFolder(EXAMPLE_LARGE_PATH)

      // THEN: Should have broadcast twice (once for each load)
      expect(broadcastCalls.length).toBe(2)

      const secondBroadcast = broadcastCalls[1]
      expect(secondBroadcast.channel).toBe('graph:stateChanged')
      expect(Array.isArray(secondBroadcast.delta)).toBe(true)
    })
  })

  describe('BEHAVIOR: Verify node properties', () => {
    it('should load nodes with all required properties', async () => {
      // WHEN: Load directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: All nodes should have required properties
      const graph = getGraph()
      const nodes = Object.values(graph.nodes)

      nodes.forEach(node => {
        // Required properties
        expect(node).toHaveProperty('relativeFilePathIsID')
        expect(node).toHaveProperty('content')
        expect(node).toHaveProperty('nodeUIMetadata')

        // Property types
        expect(typeof node.relativeFilePathIsID).toBe('string')
        expect(typeof node.content).toBe('string')

        // Content should not be empty
        expect(node.content.length).toBeGreaterThan(0)

        // outgoingEdges should be an array
        expect(Array.isArray(node.outgoingEdges)).toBe(true)
      })
    })
  })
})
