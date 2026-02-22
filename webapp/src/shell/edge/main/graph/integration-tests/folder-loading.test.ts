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
import { loadFolder, stopFileWatching, isWatching } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getGraph, setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getProjectRootWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store'
import type { GraphDelta, Graph, UpsertNodeDelta, DeleteNode, GraphNode, Edge } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'
import path from 'path'
import { promises as fs } from 'fs'
import type { BrowserWindow } from 'electron'
import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths'
import { clearRecentDeltas } from '@/shell/edge/main/state/recent-deltas-store'
import { waitForCondition } from '@/utils/test-utils/waitForCondition'

// Track IPC broadcasts
interface BroadcastCall {
  readonly channel: string
  readonly delta: GraphDelta
}

// Expected counts (based on actual example_folder_fixtures)
// loadFolder now loads only the writePath (voicetree/ subfolder) via vault config
const EXPECTED_SMALL_NODE_COUNT: 8 = 8 as const  // voicetree/ subfolder only
const EXPECTED_LARGE_NODE_COUNT: 75 = 75 as const  // voicetree/ subfolder only

// State for mocks
let broadcastCalls: Array<BroadcastCall> = []
let mockMainWindow: { readonly webContents: { readonly send: (channel: string, data: GraphDelta) => void; readonly isDestroyed: () => boolean }, readonly isDestroyed: () => boolean }

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
    setGraph(createGraph({}))
    setVaultPath('')

    // Clear recent writes to ensure fresh state for file watching tests
    clearRecentDeltas()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: GraphDelta) => {
          broadcastCalls.push({ channel, delta: data })
        }),
        isDestroyed: vi.fn(() => false)
      },
      isDestroyed: vi.fn(() => false)
    }

    // Clean up ctx-nodes directories before tests (may exist from previous test runs)
    const ctxNodesPath: string = path.join(EXAMPLE_SMALL_PATH, 'ctx-nodes')
    const ctxNodesDirExists: boolean = await fs.access(ctxNodesPath).then(() => true).catch(() => false)
    if (ctxNodesDirExists) {
      await fs.rm(ctxNodesPath, { recursive: true, force: true })
    }

    // Also clean up voicetree/ctx-nodes since that's what gets loaded (with DEFAULT_VAULT_SUFFIX)
    const voicetreeCtxNodesPath: string = path.join(EXAMPLE_SMALL_PATH, 'voicetree', 'ctx-nodes')
    const voicetreeCtxNodesDirExists: boolean = await fs.access(voicetreeCtxNodesPath).then(() => true).catch(() => false)
    if (voicetreeCtxNodesDirExists) {
      await fs.rm(voicetreeCtxNodesPath, { recursive: true, force: true })
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

    // Clean up ctx-nodes directories if they exist (created by terminal tests)
    const ctxNodesPath: string = path.join(EXAMPLE_SMALL_PATH, 'ctx-nodes')
    const ctxNodesDirExists: boolean = await fs.access(ctxNodesPath).then(() => true).catch(() => false)
    if (ctxNodesDirExists) {
      await fs.rm(ctxNodesPath, { recursive: true, force: true })
    }

    // Also clean up voicetree/ctx-nodes
    const voicetreeCtxNodesPath: string = path.join(EXAMPLE_SMALL_PATH, 'voicetree', 'ctx-nodes')
    const voicetreeCtxNodesDirExists: boolean = await fs.access(voicetreeCtxNodesPath).then(() => true).catch(() => false)
    if (voicetreeCtxNodesDirExists) {
      await fs.rm(voicetreeCtxNodesPath, { recursive: true, force: true })
    }

    vi.clearAllMocks()
  })

  describe('BEHAVIOR: Load directory and populate graph state', () => {
    it('should load example_small and populate graph with correct node count', async () => {
      // WHEN: Load example_small directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Graph should have expected number of nodes
      const graph: Graph = getGraph()
      const nodeCount: number = Object.keys(graph.nodes).length

      expect(nodeCount).toBe(EXPECTED_SMALL_NODE_COUNT)

      // AND: Nodes should have content
      const nodes: GraphNode[] = Object.values(graph.nodes)
      expect(nodes.length).toBeGreaterThan(0)
      nodes.forEach(node => {
        expect(node.contentWithoutYamlOrLinks).toBeDefined()
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
        expect(node.absoluteFilePathIsID).toBeDefined()
      })

      // AND: Should broadcast delta to UI-edge (clear, stateChanged, watching-started)
      // Filter for graph-specific channels (ignoring ui:call from settings/vault state)
      const graphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:stateChanged', 'watching-started'].includes(c.channel)
      )
      expect(graphBroadcasts.length).toBe(3)
      expect(graphBroadcasts[0].channel).toBe('graph:clear')
      expect(graphBroadcasts[1].channel).toBe('graph:stateChanged')
      expect(graphBroadcasts[1].delta).toBeDefined()
      expect(graphBroadcasts[2].channel).toBe('watching-started')
    })

    it('should load example_real_large and populate graph with correct node count', async () => {
      // WHEN: Load example_real_large directory
      await loadFolder(EXAMPLE_LARGE_PATH)

      // THEN: Graph should have expected number of nodes
      const graph: Graph = getGraph()
      const nodeCount: number = Object.keys(graph.nodes).length

      expect(nodeCount).toBe(EXPECTED_LARGE_NODE_COUNT)

      // AND: Nodes should have content
      const nodes: GraphNode[] = Object.values(graph.nodes)
      expect(nodes.length).toBeGreaterThan(0)
      nodes.forEach(node => {
        expect(node.contentWithoutYamlOrLinks).toBeDefined()
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
      })

      // AND: Should broadcast delta to UI-edge (clear, stateChanged, watching-started)
      // Filter for graph-specific channels (ignoring ui:call from settings/vault state)
      const graphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:stateChanged', 'watching-started'].includes(c.channel)
      )
      expect(graphBroadcasts.length).toBe(3)
      expect(graphBroadcasts[0].channel).toBe('graph:clear')
      expect(graphBroadcasts[1].channel).toBe('graph:stateChanged')
      expect(graphBroadcasts[2].channel).toBe('watching-started')
    })
  })

  describe('BEHAVIOR: Verify edges are extracted correctly', () => {
    it('should extract edges from markdown links in loaded files', async () => {
      // WHEN: Load directory with linked files
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Graph should have some edges (at least one file should link to another)
      const graph: Graph = getGraph()
      const edgeEntries: [string, GraphNode][] = Object.entries(graph.nodes)
        .filter(([, node]) => node.outgoingEdges && node.outgoingEdges.length > 0)

      // We expect at least some nodes to have outgoing edges
      expect(edgeEntries.length).toBeGreaterThan(0)

      // Verify edge structure
      edgeEntries.forEach(([, node]) => {
        expect(Array.isArray(node.outgoingEdges)).toBe(true)
        node.outgoingEdges?.forEach((edge: Edge) => {
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

      const graph1: Graph = getGraph()
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

      // STEP 1b: Test file addition and deletion by simulating FS events
      // Clear broadcasts from initial load
      broadcastCalls.length = 0

      // Clear recent writes to ensure file watching will detect the new file
      clearRecentDeltas()

      // Import handler to simulate FS events
      const { handleFSEventWithStateAndUISides } = await import('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/handleFSEventWithStateAndUISides')

      const testFilePath: string = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const testFileContent: "# Test New File\n\nThis is a test file for chokidar detection.\n\n[[5_Immediate_Test_Observation_No_Output]]" = '# Test New File\n\nThis is a test file for chokidar detection.\n\n[[5_Immediate_Test_Observation_No_Output]]'
      // Expected content after wikilink replacement
      const expectedContent: "# Test New File\n\nThis is a test file for chokidar detection.\n\n[5_Immediate_Test_Observation_No_Output]*" = '# Test New File\n\nThis is a test file for chokidar detection.\n\n[5_Immediate_Test_Observation_No_Output]*'

      // Create the file on disk
      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Simulate the FS event for file addition
      const addEvent: { absolutePath: string; content: string; eventType: "Added"; } = {
        absolutePath: testFilePath,
        content: testFileContent,
        eventType: 'Added' as const
      }

      handleFSEventWithStateAndUISides(addEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete (involves FS I/O for wikilink resolution)
      await waitForCondition(
        () => !!getGraph().nodes[testFilePath],
        { maxWaitMs: 2000, errorMessage: 'test-new-file node not added to graph via handleFSEvent' }
      )

      // Verify the node was added to the graph - node IDs are now absolute paths
      const graphAfterAdd: Graph = getGraph()
      expect(graphAfterAdd.nodes[testFilePath]).toBeDefined()
      expect(graphAfterAdd.nodes[testFilePath].contentWithoutYamlOrLinks).toBe(expectedContent)
      expect(Object.keys(graphAfterAdd.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT + 1)

      // Verify edge was created from test-new-file to 5_Immediate_Test_Observation_No_Output
      const testNode: GraphNode = graphAfterAdd.nodes[testFilePath]
      expect(testNode.outgoingEdges).toBeDefined()
      expect(Array.isArray(testNode.outgoingEdges)).toBe(true)
      // Node IDs now include .md extension
      expect(testNode.outgoingEdges.some((e: Edge) => e.targetId.includes('5_Immediate_Test_Observation_No_Output'))).toBe(true)

      // Verify broadcast was sent (graph:stateChanged)
      // Note: handleFSEventWithStateAndUISides sends 2 broadcasts:
      // 1. graph:stateChanged (for cytoscape UI)
      // 2. ui:call (for floating editors)
      const graphStateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:stateChanged')
      expect(graphStateChangedBroadcasts.length).toBe(1)
      const addBroadcast: BroadcastCall | undefined = graphStateChangedBroadcasts.find(call =>
        call.delta.some(d => d.type === 'UpsertNode' && d.nodeToUpsert.absoluteFilePathIsID === testFilePath)
      )
      expect(addBroadcast).toBeDefined()

      // Reset broadcast tracking
      broadcastCalls.length = 0

      // Delete the file from disk
      await fs.unlink(testFilePath)

      // Simulate the FS event for file deletion
      const deleteEvent: { type: "Delete"; absolutePath: string; } = {
        type: 'Delete' as const,
        absolutePath: testFilePath
      }

      handleFSEventWithStateAndUISides(deleteEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete
      await waitForCondition(
        () => !getGraph().nodes[testFilePath],
        { maxWaitMs: 2000, errorMessage: 'test-new-file node not removed from graph via handleFSEvent' }
      )

      // Verify the node was removed from the graph - node IDs are absolute paths
      const graphAfterDelete: Graph = getGraph()
      expect(graphAfterDelete.nodes[testFilePath]).toBeUndefined()
      expect(Object.keys(graphAfterDelete.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify broadcast was sent (graph:stateChanged)
      // Note: handleFSEventWithStateAndUISides sends 2 broadcasts:
      // 1. graph:stateChanged (for cytoscape UI)
      // 2. ui:call (for floating editors)
      const deleteGraphStateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:stateChanged')
      expect(deleteGraphStateChangedBroadcasts.length).toBe(1)
      const deleteBroadcast: BroadcastCall | undefined = deleteGraphStateChangedBroadcasts.find(call =>
        call.delta.some(d => d.type === 'DeleteNode' && d.nodeId === testFilePath)
      )
      expect(deleteBroadcast).toBeDefined()

      // Reset broadcasts for next steps
      broadcastCalls.length = 0

      // STEP 2: Load example_real_large (user switches to larger directory)
      await loadFolder(EXAMPLE_LARGE_PATH)

      const graph2: Graph = getGraph()
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

      const graph3: Graph = getGraph()
      expect(Object.keys(graph3.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // Verify we're back to small graph (same count, not same instances necessarily)
      const finalNodeIds: Set<string> = new Set(Object.keys(graph3.nodes))
      expect(finalNodeIds.size).toBe(smallNodeIds.size)

      // Verify edges are still present after switching back
      const finalEdgesCount: number = Object.values(graph3.nodes)
        .filter(node => node.outgoingEdges.length > 0).length
      expect(finalEdgesCount).toBeGreaterThan(0)

      // Verify all broadcasts used valid channels (includes ui:call from settings/vault state)
      broadcastCalls.forEach(call => {
        expect(['graph:stateChanged', 'graph:clear', 'watching-started', 'ui:call']).toContain(call.channel)
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
      const { handleFSEventWithStateAndUISides } = await import('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/handleFSEventWithStateAndUISides')

      const addEvent: { absolutePath: string; content: string; eventType: "Added"; } = {
        absolutePath: newFilePath,
        content: newFileContent,
        eventType: 'Added' as const
      }


      handleFSEventWithStateAndUISides(addEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete (involves FS I/O for wikilink resolution)
      await waitForCondition(
        () => !!getGraph().nodes[newFilePath],
        { maxWaitMs: 2000, errorMessage: 'test-new-file node not added to graph via handleFSEvent' }
      )

      // THEN: Graph should contain the new node - node IDs are absolute paths
      const graph: Graph = getGraph()
      expect(graph.nodes[newFilePath]).toBeDefined()
      expect(graph.nodes[newFilePath].contentWithoutYamlOrLinks).toBe(newFileContent)

      // AND: Broadcast should have been sent (graph:stateChanged)
      // Note: handleFSEventWithStateAndUISides sends 2 broadcasts:
      // 1. graph:stateChanged (for cytoscape UI)
      // 2. ui:call (for floating editors)
      const stateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:stateChanged')
      expect(stateChangedBroadcasts.length).toBe(1)
      expect(stateChangedBroadcasts[0].channel).toBe('graph:stateChanged')

      // Verify the delta contains UpsertNode action
      const addDelta: UpsertNodeDelta | undefined = stateChangedBroadcasts[0].delta.find(d => d.type === 'UpsertNode')
      expect(addDelta).toBeDefined()

      // WHEN: Delete the file
      broadcastCalls.length = 0
      await fs.unlink(newFilePath)

      const deleteEvent: { type: "Delete"; absolutePath: string; } = {
        type: 'Delete' as const,
        absolutePath: newFilePath
      }


      handleFSEventWithStateAndUISides(deleteEvent, EXAMPLE_SMALL_PATH, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete
      await waitForCondition(
        () => !getGraph().nodes[newFilePath],
        { maxWaitMs: 2000, errorMessage: 'test-new-file node not removed from graph via handleFSEvent' }
      )

      // THEN: GraphNode should be removed from graph - node IDs are absolute paths
      const graphAfterDelete: Graph = getGraph()
      expect(graphAfterDelete.nodes[newFilePath]).toBeUndefined()

      // AND: Broadcast should have been sent (graph:stateChanged)
      // Note: handleFSEventWithStateAndUISides sends 2 broadcasts:
      // 1. graph:stateChanged (for cytoscape UI)
      // 2. ui:call (for floating editors)
      const deleteStateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:stateChanged')
      expect(deleteStateChangedBroadcasts.length).toBe(1)
      expect(deleteStateChangedBroadcasts[0].channel).toBe('graph:stateChanged')

      // Verify the delta contains DeleteNode action
      const deleteDelta: DeleteNode | undefined = deleteStateChangedBroadcasts[0].delta.find(d => d.type === 'DeleteNode')
      expect(deleteDelta).toBeDefined()
    })
  })

  describe('BEHAVIOR: Broadcast deltas on load', () => {
    it('should broadcast GraphDelta when loading a directory', async () => {
      // WHEN: Load directory
      await loadFolder(EXAMPLE_SMALL_PATH)

      // THEN: Should have broadcast graph-specific channels (clear + stateChanged + watching-started)
      // Additional ui:call broadcasts may come from settings/vault state updates
      const graphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:stateChanged', 'watching-started'].includes(c.channel)
      )
      expect(graphBroadcasts.length).toBe(3)

      const clearBroadcast: BroadcastCall = graphBroadcasts[0]
      const stateChangedBroadcast: BroadcastCall = graphBroadcasts[1]
      const watchingStartedBroadcast: BroadcastCall = graphBroadcasts[2]

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
      const firstGraphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:stateChanged', 'watching-started'].includes(c.channel)
      )
      expect(firstGraphBroadcasts.length).toBe(3) // clear + stateChanged + watching-started

      // WHEN: Load second directory
      await loadFolder(EXAMPLE_LARGE_PATH)

      // THEN: Should have 6 graph-specific broadcasts total (3 for each load)
      const allGraphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:stateChanged', 'watching-started'].includes(c.channel)
      )
      expect(allGraphBroadcasts.length).toBe(6)

      // Verify second load broadcasts
      const secondClearBroadcast: BroadcastCall = allGraphBroadcasts[3]
      const secondStateChangedBroadcast: BroadcastCall = allGraphBroadcasts[4]
      const secondWatchingStartedBroadcast: BroadcastCall = allGraphBroadcasts[5]
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
      const graph: Graph = getGraph()
      const nodes: GraphNode[] = Object.values(graph.nodes)

      nodes.forEach(node => {
        // Required properties - node IDs are now absolute paths
        expect(node).toHaveProperty('absoluteFilePathIsID')
        expect(node).toHaveProperty('contentWithoutYamlOrLinks')
        expect(node).toHaveProperty('nodeUIMetadata')

        // Property types
        expect(typeof node.absoluteFilePathIsID).toBe('string')
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
      const graph: Graph = getGraph()
      expect(Object.keys(graph.nodes).length).toBe(EXPECTED_SMALL_NODE_COUNT)

      // AND: The bad YAML file should be present
      // Node IDs are now absolute paths
      const badYamlPath: string = path.join(EXAMPLE_SMALL_PATH, 'voicetree/7_Bad_YAML_Frontmatter_Test.md')
      const badYamlNode: GraphNode = graph.nodes[badYamlPath]
      expect(badYamlNode).toBeDefined()

      // AND: Should have content (not skipped due to parse error)
      expect(badYamlNode.contentWithoutYamlOrLinks).toBeDefined()
      expect(badYamlNode.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)

      // AND: Should derive title from heading (via getNodeTitle), not the unparseable frontmatter
      const title: string = getNodeTitle(badYamlNode)
      expect(title).toBeDefined()
      // The title should be from the heading "Bad YAML Frontmatter Test"
      // NOT from the broken frontmatter title
      expect(title).not.toBe('(Sam) Proposed Fix: Expose VoiceTreeGraphView (55)')
      expect(title).toBe('Bad YAML Frontmatter Test')
    })
  })

  describe('BEHAVIOR: projectRootWatchedDirectory updated before file limit check (suffix bug fix)', () => {
    it('should update projectRootWatchedDirectory immediately when loadFolder is called', async () => {
      // GIVEN: Load the first folder
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(getProjectRootWatchedDirectory()).toBe(EXAMPLE_SMALL_PATH)

      // WHEN: Load a different folder
      await loadFolder(EXAMPLE_LARGE_PATH)

      // THEN: projectRootWatchedDirectory should be updated to the new folder
      expect(getProjectRootWatchedDirectory()).toBe(EXAMPLE_LARGE_PATH)
    })

    it('should maintain projectRootWatchedDirectory even after switching folders multiple times', async () => {
      // Load folder A
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(getProjectRootWatchedDirectory()).toBe(EXAMPLE_SMALL_PATH)

      // Load folder B
      await loadFolder(EXAMPLE_LARGE_PATH)
      expect(getProjectRootWatchedDirectory()).toBe(EXAMPLE_LARGE_PATH)

      // Load folder A again
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(getProjectRootWatchedDirectory()).toBe(EXAMPLE_SMALL_PATH)
    })
  })
})
