/**
 * Integration test for folder loading functionality
 *
 * BEHAVIOR TESTED:
 * - INPUT: Load a directory (via loadLastDirectory mock or loadFolder)
 * - OUTPUT: Graph state correctly populated
 * - SIDE EFFECTS: Broadcast to renderer with graph delta
 *
 * This e2e-tests the integration of:
 * - Loading a graph from disk
 * - Updating graph state
 * - Broadcasting deltas to the UI-edge
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
import { loadFolder, stopFileWatching, isWatching } from '@/shell/edge/main/graph/watchFolder'
import { getGraph, setGraph, setVaultPath } from '@/shell/edge/main/state/graph-store'
import type { GraphDelta } from '@/pure/graph'
import path from 'path'
import { promises as fs } from 'fs'
import type { BrowserWindow } from 'electron'
import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths'

// Track IPC broadcasts
interface BroadcastCall {
  readonly channel: string
  readonly delta: GraphDelta
}

// Expected counts (based on actual example_folder_fixtures)
const EXPECTED_SMALL_NODE_COUNT: 7 = 7  // Includes 7_Bad_YAML_Frontmatter_Test.md
const EXPECTED_LARGE_NODE_COUNT: 76 = 76

// State for mocks
let broadcastCalls: Array<BroadcastCall> = []
let mockMainWindow: { readonly webContents: { readonly send: (channel: string, data: GraphDelta) => void }, readonly isDestroyed: () => boolean }

// Mock app-electron-state
vi.mock('@/shell/edge/main/state/app-electron-state', () => ({
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
  beforeEach(async () => {
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

    // Clean up ctx-nodes directory before tests (may exist from previous test runs)
    const ctxNodesPath: string = path.join(EXAMPLE_SMALL_PATH, 'ctx-nodes')
    const ctxNodesDirExists: boolean = await fs.access(ctxNodesPath).then(() => true).catch(() => false)
    if (ctxNodesDirExists) {
      await fs.rm(ctxNodesPath, { recursive: true, force: true })
    }
  })

  afterEach(async () => {
    await stopFileWatching()

    // Clean up test file if it exists - functional approach without try-catch
    const testFilePath: string = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
    const fileExists: boolean = await fs.access(testFilePath).then(() => true).catch(() => false)
    if (fileExists) {
      await fs.unlink(testFilePath)
    }

    // Clean up ctx-nodes directory if it exists (created by terminal tests)
    const ctxNodesPath: string = path.join(EXAMPLE_SMALL_PATH, 'ctx-nodes')
    const ctxNodesDirExists: boolean = await fs.access(ctxNodesPath).then(() => true).catch(() => false)
    if (ctxNodesDirExists) {
      await fs.rm(ctxNodesPath, { recursive: true, force: true })
    }

    vi.clearAllMocks()
  })

  describe('BEHAVIOR: Load directory and populate graph state', () => {
    it('should load example_small and populate graph with correct node count', async () => {
      // WHEN: Load example_small directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Graph should have expected number of nodes
      const graph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      const nodeCount: number = Object.keys(graph.nodes).length

      expect(nodeCount).toBe(EXPECTED_SMALL_NODE_COUNT)

      // AND: Nodes should have content
      const nodes: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode[] = Object.values(graph.nodes)
      expect(nodes.length).toBeGreaterThan(0)
      nodes.forEach(node => {
        expect(node.contentWithoutYamlOrLinks).toBeDefined()
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
        expect(node.relativeFilePathIsID).toBeDefined()
      })

      // AND: Should broadcast delta to UI-edge (clear, stateChanged, watching-started)
      expect(broadcastCalls.length).toBe(3)
      expect(broadcastCalls[0].channel).toBe('graph:clear')
      expect(broadcastCalls[1].channel).toBe('graph:stateChanged')
      expect(broadcastCalls[1].delta).toBeDefined()
      expect(broadcastCalls[2].channel).toBe('watching-started')
    })

    it('should load example_real_large and populate graph with correct node count', async () => {
      // WHEN: Load example_real_large directory
      await loadFolder(EXAMPLE_LARGE_PATH)

      // THEN: Graph should have expected number of nodes
      const graph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      const nodeCount: number = Object.keys(graph.nodes).length

      expect(nodeCount).toBe(EXPECTED_LARGE_NODE_COUNT)

      // AND: Nodes should have content
      const nodes: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode[] = Object.values(graph.nodes)
      expect(nodes.length).toBeGreaterThan(0)
      nodes.forEach(node => {
        expect(node.contentWithoutYamlOrLinks).toBeDefined()
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
      })

      // AND: Should broadcast delta to UI-edge (clear, stateChanged, watching-started)
      expect(broadcastCalls.length).toBe(3)
      expect(broadcastCalls[0].channel).toBe('graph:clear')
      expect(broadcastCalls[1].channel).toBe('graph:stateChanged')
      expect(broadcastCalls[2].channel).toBe('watching-started')
    })
  })

  describe('BEHAVIOR: Verify edges are extracted correctly', () => {
    it('should extract edges from markdown links in loaded files', async () => {
      // WHEN: Load directory with linked files
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Graph should have some edges (at least one file should link to another)
      const graph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      const edgeEntries: [string, import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode][] = Object.entries(graph.nodes)
        .filter(([, node]) => node.outgoingEdges && node.outgoingEdges.length > 0)

      // We expect at least some nodes to have outgoing edges
      expect(edgeEntries.length).toBeGreaterThan(0)

      // Verify edge structure
      edgeEntries.forEach(([, node]) => {
        expect(Array.isArray(node.outgoingEdges)).toBe(true)
        node.outgoingEdges?.forEach(edge => {
          expect(typeof edge.targetId).toBe('string')
          expect(edge.targetId.length).toBeGreaterThan(0)
          expect(typeof edge.label).toBe('string')
        })
      })
    })
  })

  describe('BEHAVIOR: Load and switch between directories', () => {
    it('should load small → large → small and maintain correct state throughout +++ TESTING MANUAL FILE CHANGES', async () => {
      // STEP 1: Load example_small (simulating auto-load on startup)
      await loadFolder(EXAMPLE_SMALL_PATH)

      const graph1: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(Object.keys(graph1.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify nodes have content and edges
      const smallNodeIds: Set<string> = new Set(Object.keys(graph1.nodes))
      Object.values(graph1.nodes).forEach(node => {
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
        expect(Array.isArray(node.outgoingEdges)).toBe(true)
      })

      // Verify at least some edges exist in small graph
      const smallEdgesCount: number = Object.values(graph1.nodes)
        .filter(node => node.outgoingEdges.length > 0).length
      expect(smallEdgesCount).toBeGreaterThan(0)

      const firstBroadcastCount: number = broadcastCalls.length
      expect(firstBroadcastCount).toBeGreaterThan(0)

      // Verify that file watcher was set up after loading
      expect(isWatching()).toBe(true)

      // STEP 1b: Test real filesystem changes with chokidar
      // Clear broadcasts from initial load
      broadcastCalls.length = 0

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000))

      const testFilePath: string = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const testFileContent: "# Test New File\n\nThis is a test file for chokidar detection.\n\n[[5_Immediate_Test_Observation_No_Output]]" = '# Test New File\n\nThis is a test file for chokidar detection.\n\n[[5_Immediate_Test_Observation_No_Output]]'
      // Expected content after wikilink replacement
      const expectedContent: "# Test New File\n\nThis is a test file for chokidar detection.\n\n[5_Immediate_Test_Observation_No_Output]*" = '# Test New File\n\nThis is a test file for chokidar detection.\n\n[5_Immediate_Test_Observation_No_Output]*'

      // Create a new file on disk
      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for chokidar to detect the file addition (with awaitWriteFinish it takes ~1-2 seconds)
      // Poll for the node to appear in the graph
      let nodeAdded: boolean = false
      const maxWaitTime: 5000 = 5000 // 5 seconds max
      const pollInterval: 200 = 200 // Check every 200ms
      const startTime: number = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
        if (currentGraph.nodes['test-new-file.md']) {
          nodeAdded = true
          break
        }
      }

      // Verify the node was added to the graph
      expect(nodeAdded).toBe(true)
      const graphAfterAdd: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(graphAfterAdd.nodes['test-new-file.md']).toBeDefined()
      expect(graphAfterAdd.nodes['test-new-file.md'].contentWithoutYamlOrLinks).toBe(expectedContent)
      expect(Object.keys(graphAfterAdd.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT + 1)

      // Verify edge was created from test-new-file to 5_Immediate_Test_Observation_No_Output
      const testNode: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode = graphAfterAdd.nodes['test-new-file.md']
      expect(testNode.outgoingEdges).toBeDefined()
      expect(Array.isArray(testNode.outgoingEdges)).toBe(true)
      // Node IDs now include .md extension
      expect(testNode.outgoingEdges.some(e => e.targetId.includes('5_Immediate_Test_Observation_No_Output'))).toBe(true)

      // Verify broadcast was sent
      expect(broadcastCalls.length).toBeGreaterThan(0)
      const addBroadcast: BroadcastCall | undefined = broadcastCalls.find(call =>
        call.delta.some(d => d.type === 'UpsertNode' && d.nodeToUpsert.relativeFilePathIsID === 'test-new-file.md')
      )
      expect(addBroadcast).toBeDefined()

      // Reset broadcast tracking
      broadcastCalls.length = 0

      // Delete the file
      await fs.unlink(testFilePath)

      // Wait for chokidar to detect the file deletion
      let nodeDeleted: boolean = false
      const deleteStartTime: number = Date.now()

      while (Date.now() - deleteStartTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
        if (!currentGraph.nodes['test-new-file.md']) {
          nodeDeleted = true
          break
        }
      }

      // Verify the node was removed from the graph
      expect(nodeDeleted).toBe(true)
      const graphAfterDelete: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(graphAfterDelete.nodes['test-new-file.md']).toBeUndefined()
      expect(Object.keys(graphAfterDelete.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify broadcast was sent
      expect(broadcastCalls.length).toBeGreaterThan(0)
      const deleteBroadcast: BroadcastCall | undefined = broadcastCalls.find(call =>
        call.delta.some(d => d.type === 'DeleteNode' && d.nodeId === 'test-new-file.md')
      )
      expect(deleteBroadcast).toBeDefined()

      // Reset broadcasts for next steps
      broadcastCalls.length = 0

      // STEP 2: Load example_real_large (user switches to larger directory)
      await loadFolder(EXAMPLE_LARGE_PATH)

      const graph2: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(Object.keys(graph2.nodes).length).toBe(EXPECTED_LARGE_NODE_COUNT)

      const largeNodeIds: Set<string> = new Set(Object.keys(graph2.nodes))

      // Verify the graph was completely replaced (not merged)
      expect(largeNodeIds.size).toBeGreaterThan(smallNodeIds.size)

      // Verify nodes have content
      Object.values(graph2.nodes).forEach(node => {
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
      })

      const secondBroadcastCount: number = broadcastCalls.length
      expect(secondBroadcastCount).toBeGreaterThan(0) // At least one broadcast for the load

      // STEP 3: Load example_small again (user switches back)
      await loadFolder(EXAMPLE_SMALL_PATH)

      const graph3: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(Object.keys(graph3.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify we're back to small graph (same count, not same instances necessarily)
      const finalNodeIds: Set<string> = new Set(Object.keys(graph3.nodes))
      expect(finalNodeIds.size).toBe(smallNodeIds.size)

      // Verify edges are still present after switching back
      const finalEdgesCount: number = Object.values(graph3.nodes)
        .filter(node => node.outgoingEdges.length > 0).length
      expect(finalEdgesCount).toBeGreaterThan(0)

      // Verify all broadcasts used valid channels
      broadcastCalls.forEach(call => {
        expect(['graph:stateChanged', 'graph:clear', 'watching-started']).toContain(call.channel)
        if (call.channel === 'graph:stateChanged') {
          expect(Array.isArray(call.delta)).toBe(true)
        }
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
      const newFilePath: string = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const newFileContent: "# Test New File\n\nThis is a test." = '# Test New File\n\nThis is a test.'

      await fs.writeFile(newFilePath, newFileContent, 'utf-8')

      // Import and call the FS event handler directly to simulate watcher detection
      const { handleFSEventWithStateAndUISides } = await import('@/shell/edge/main/graph/readAndDBEventsPath/handleFSEventWithStateAndUISides')

      const addEvent: { absolutePath: string; content: string; eventType: "Added"; } = {
        absolutePath: newFilePath,
        content: newFileContent,
        eventType: 'Added' as const
      }

       
      handleFSEventWithStateAndUISides(addEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // THEN: Graph should contain the new node
      const graph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(graph.nodes['test-new-file.md']).toBeDefined()
      expect(graph.nodes['test-new-file.md'].contentWithoutYamlOrLinks).toBe(newFileContent)

      // AND: Broadcast should have been sent
      expect(broadcastCalls.length).toBe(1)
      expect(broadcastCalls[0].channel).toBe('graph:stateChanged')

      // Verify the delta contains UpsertNode action
      const addDelta: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").UpsertNodeAction | undefined = broadcastCalls[0].delta.find(d => d.type === 'UpsertNode')
      expect(addDelta).toBeDefined()

      // WHEN: Delete the file
      broadcastCalls.length = 0
      await fs.unlink(newFilePath)

      const deleteEvent: { type: "Delete"; absolutePath: string; } = {
        type: 'Delete' as const,
        absolutePath: newFilePath
      }

       
      handleFSEventWithStateAndUISides(deleteEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // THEN: GraphNode should be removed from graph
      const graphAfterDelete: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(graphAfterDelete.nodes['test-new-file.md']).toBeUndefined()

      // AND: Broadcast should have been sent
      expect(broadcastCalls.length).toBe(1)
      expect(broadcastCalls[0].channel).toBe('graph:stateChanged')

      // Verify the delta contains DeleteNode action
      const deleteDelta: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").DeleteNode | undefined = broadcastCalls[0].delta.find(d => d.type === 'DeleteNode')
      expect(deleteDelta).toBeDefined()
    })
  })

  describe('BEHAVIOR: Broadcast deltas on load', () => {
    it('should broadcast GraphDelta when loading a directory', async () => {
      // WHEN: Load directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Should have broadcast 3 times (clear + stateChanged + watching-started)
      expect(broadcastCalls.length).toBe(3)

      const clearBroadcast: BroadcastCall = broadcastCalls[0]
      const stateChangedBroadcast: BroadcastCall = broadcastCalls[1]
      const watchingStartedBroadcast: BroadcastCall = broadcastCalls[2]

      // AND: First broadcast should be graph:clear
      expect(clearBroadcast.channel).toBe('graph:clear')

      // AND: Second broadcast should use graph:stateChanged channel
      expect(stateChangedBroadcast.channel).toBe('graph:stateChanged')

      // AND: Third broadcast should be watching-started
      expect(watchingStartedBroadcast.channel).toBe('watching-started')

      // AND: Delta should be an array of NodeDeltas
      expect(Array.isArray(stateChangedBroadcast.delta)).toBe(true)

      // AND: Delta should contain node additions for all loaded nodes
      expect(stateChangedBroadcast.delta.length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify each delta has the expected structure (UpsertNodeAction or DeleteNode)
      stateChangedBroadcast.delta.forEach(nodeDelta => {
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
      expect(broadcastCalls.length).toBe(3) // clear + stateChanged + watching-started

      // WHEN: Load second directory
      await loadFolder(EXAMPLE_LARGE_PATH)

      // THEN: Should have broadcast 6 times total (3 for each load: clear + stateChanged + watching-started)
      expect(broadcastCalls.length).toBe(6)

      // Verify second load broadcasts
      const secondClearBroadcast: BroadcastCall = broadcastCalls[3]
      const secondStateChangedBroadcast: BroadcastCall = broadcastCalls[4]
      const secondWatchingStartedBroadcast: BroadcastCall = broadcastCalls[5]
      expect(secondClearBroadcast.channel).toBe('graph:clear')
      expect(secondStateChangedBroadcast.channel).toBe('graph:stateChanged')
      expect(secondWatchingStartedBroadcast.channel).toBe('watching-started')
      expect(Array.isArray(secondStateChangedBroadcast.delta)).toBe(true)
    })
  })

  describe('BEHAVIOR: Verify node properties', () => {
    it('should load nodes with all required properties', async () => {
      // WHEN: Load directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: All nodes should have required properties
      const graph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      const nodes: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode[] = Object.values(graph.nodes)

      nodes.forEach(node => {
        // Required properties
        expect(node).toHaveProperty('relativeFilePathIsID')
        expect(node).toHaveProperty('contentWithoutYamlOrLinks')
        expect(node).toHaveProperty('nodeUIMetadata')

        // Property types
        expect(typeof node.relativeFilePathIsID).toBe('string')
        expect(typeof node.contentWithoutYamlOrLinks).toBe('string')

        // Content should not be empty
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)

        // outgoingEdges should be an array
        expect(Array.isArray(node.outgoingEdges)).toBe(true)
      })
    })
  })

  describe('BEHAVIOR: Recover from malformed YAML frontmatter', () => {
    it('should load files with bad YAML frontmatter and fall back to heading/filename', async () => {
      // WHEN: Load directory containing file with bad YAML
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Should still load all nodes including the one with bad YAML
      const graph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph()
      expect(Object.keys(graph.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // AND: The bad YAML file should be present
      const badYamlNode: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode = graph.nodes['7_Bad_YAML_Frontmatter_Test.md']
      expect(badYamlNode).toBeDefined()

      // AND: Should have content (not skipped due to parse error)
      expect(badYamlNode.contentWithoutYamlOrLinks).toBeDefined()
      expect(badYamlNode.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)

      // AND: Should have used fallback title (from heading, not the unparseable frontmatter)
      expect(badYamlNode.nodeUIMetadata.title).toBeDefined()
      // The title should be from the heading "Bad YAML Frontmatter Test"
      // NOT from the broken frontmatter title
      expect(badYamlNode.nodeUIMetadata.title).not.toBe('(Sam) Proposed Fix: Expose VoiceTreeGraphView (55)')
      expect(badYamlNode.nodeUIMetadata.title).toBe('Bad YAML Frontmatter Test')
    })
  })
})
