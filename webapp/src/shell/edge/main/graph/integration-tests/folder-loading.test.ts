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

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { loadFolder, isWatching, setProjectRoot } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import type { Graph, GraphNode, Edge } from '@vt/graph-model/graph'
import { getNodeTitle } from '@vt/graph-model/markdown'
import path from 'path'
import {
  type BroadcastCall,
  type FixtureEnvironment,
  type MockMainWindow,
  INTEGRATION_TEST_TIMEOUT_MS,
  MIN_LARGE_NODE_COUNT,
  MIN_SMALL_NODE_COUNT,
  cleanupFolderLoadingTest,
  createFixtureEnvironment,
  disposeFixtureEnvironment,
  expectLinkedFileAddDeleteViaFSEvent,
  expectLoadBroadcastSequence,
  expectSimpleFileAddDeleteViaFSEvent,
  expectWatchedDirectory,
  getGraphBroadcasts,
  loadFixtureFolder,
  prepareFolderLoadingTest
} from './folder-loading.test/__tests__/test-support'

// State for mocks
let broadcastCalls: Array<BroadcastCall> = []
let mockMainWindow: MockMainWindow
let fixtureEnvironment: FixtureEnvironment | null = null
let exampleSmallPath: string
let exampleLargePath: string

// Mock app-electron-state
vi.mock('@/shell/edge/main/runtime/state/app-electron-state', () => ({
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

// TODO: flaky under parallel test load — daemon TCP contention causes ECONNREFUSED / timeouts
describe.skip('Folder Loading - Integration Tests', () => {
  beforeAll(async () => {
    const environment = await createFixtureEnvironment()
    fixtureEnvironment = environment
    exampleSmallPath = environment.exampleSmallPath
    exampleLargePath = environment.exampleLargePath
  }, INTEGRATION_TEST_TIMEOUT_MS)

  beforeEach(async () => {
    if (!fixtureEnvironment) throw new Error('fixtureEnvironment must be initialized before tests run')
    broadcastCalls = []
    mockMainWindow = await prepareFolderLoadingTest(fixtureEnvironment, call => {
      broadcastCalls.push(call)
    })
  })

  afterEach(async () => {
    if (!fixtureEnvironment) return
    await cleanupFolderLoadingTest(fixtureEnvironment)
  })

  afterAll(async () => {
    if (!fixtureEnvironment) return
    await disposeFixtureEnvironment(fixtureEnvironment)
    fixtureEnvironment = null
  }, INTEGRATION_TEST_TIMEOUT_MS)

  describe('BEHAVIOR: Load directory and populate graph state', () => {
    it('should load example_small and populate graph with correct node count', async () => {
      // WHEN: Load example_small directory
      await loadFixtureFolder(exampleSmallPath)

      // THEN: Graph should have expected number of nodes
      const graph: Graph = getGraph()
      const nodeCount: number = Object.keys(graph.nodes).length

      expect(nodeCount).toBeGreaterThanOrEqual(MIN_SMALL_NODE_COUNT)

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
      expectLoadBroadcastSequence(getGraphBroadcasts(broadcastCalls))
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should load example_real_large and populate graph with correct node count', async () => {
      // WHEN: Load example_real_large directory
      await loadFixtureFolder(exampleLargePath)

      // THEN: Graph should have expected number of nodes
      const graph: Graph = getGraph()
      const nodeCount: number = Object.keys(graph.nodes).length

      expect(nodeCount).toBeGreaterThanOrEqual(MIN_LARGE_NODE_COUNT)

      // AND: Nodes should have content
      const nodes: GraphNode[] = Object.values(graph.nodes)
      expect(nodes.length).toBeGreaterThan(0)
      nodes.forEach(node => {
        expect(node.contentWithoutYamlOrLinks).toBeDefined()
        expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
      })

      // AND: Should broadcast delta to UI-edge (clear, stateChanged, watching-started)
      // Filter for graph-specific channels (ignoring ui:call from settings/vault state)
      expectLoadBroadcastSequence(getGraphBroadcasts(broadcastCalls))
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Verify edges are extracted correctly', () => {
    it('should extract edges from markdown links in loaded files', async () => {
      // WHEN: Load directory with linked files
      await loadFixtureFolder(exampleSmallPath)

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
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Load and switch between directories', () => {
    it('should load small → large → small and maintain correct state throughout +++ TESTING MANUAL FILE CHANGES', async () => {
      // STEP 1: Load example_small (simulating auto-load on startup)
      await loadFixtureFolder(exampleSmallPath)

      const graph1: Graph = getGraph()
      expect(Object.keys(graph1.nodes).length).toBeGreaterThanOrEqual(MIN_SMALL_NODE_COUNT)

      // Verify nodes have content and edges
      const smallNodeIds: Set<string> = new Set(Object.keys(graph1.nodes))
      const smallNodeCount: number = smallNodeIds.size
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
      await expectLinkedFileAddDeleteViaFSEvent(exampleSmallPath, mockMainWindow, broadcastCalls, smallNodeCount)

      // Reset broadcasts for next steps
      broadcastCalls.length = 0

      // STEP 2: Load example_real_large (user switches to larger directory)
      await loadFixtureFolder(exampleLargePath)

      const graph2: Graph = getGraph()
      expect(Object.keys(graph2.nodes).length).toBeGreaterThanOrEqual(MIN_LARGE_NODE_COUNT)

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
      await loadFixtureFolder(exampleSmallPath)

      const graph3: Graph = getGraph()
      expect(Object.keys(graph3.nodes).length).toBeGreaterThanOrEqual(MIN_SMALL_NODE_COUNT)

      // Verify we're back to small graph (same count, not same instances necessarily)
      const finalNodeIds: Set<string> = new Set(Object.keys(graph3.nodes))
      expect(finalNodeIds.size).toBe(smallNodeIds.size)

      // Verify edges are still present after switching back
      const finalEdgesCount: number = Object.values(graph3.nodes)
        .filter(node => node.outgoingEdges.length > 0).length
      expect(finalEdgesCount).toBeGreaterThan(0)

      // Verify all broadcasts used valid channels (includes ui:call from settings/vault state)
      broadcastCalls.forEach(call => {
        expect(['graph:projectedGraphUpdate', 'graph:clear', 'watching-started', 'ui:call']).toContain(call.channel)
        if (call.channel === 'graph:projectedGraphUpdate') {
          expect(Array.isArray(call.delta)).toBe(true)
        }
      })

      // Verify that file watcher was set up after loading
      expect(isWatching()).toBe(true)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should not throw when switching vaults while a previous load is not connected to the daemon', async () => {
      // Regression: simulate the old race where a concurrent/failed first load
      // left stale main-process state, causing writeCurrentPositionsThroughDaemon to
      // throw "No vault is currently open" and blocking the vault switch entirely.
      //
      // Reproduces: concurrent initialLoad + debug-auto-setup both calling loadFolder, with the
      // second load seeing stale state from the first (daemon not yet connected).
      setProjectRoot(exampleSmallPath)
      // The old load implementation attempted writeCurrentPositionsThroughDaemon and
      // had to avoid propagating that error.

      const result = await loadFolder(exampleLargePath)
      expect(result.success).toBe(true)
      expectWatchedDirectory(exampleLargePath)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should detect file addition and deletion after folder is loaded', async () => {
      // GIVEN: Load a folder and wait for watcher to be ready
      await loadFixtureFolder(exampleSmallPath)
      expect(isWatching()).toBe(true)

      // Clear broadcasts from initial load
      broadcastCalls.length = 0

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 300))

      await expectSimpleFileAddDeleteViaFSEvent(exampleSmallPath, mockMainWindow, broadcastCalls)
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Broadcast deltas on load', () => {
    it('should broadcast GraphDelta when loading a directory', async () => {
      // WHEN: Load directory
      await loadFixtureFolder(exampleSmallPath)

      // THEN: Should have broadcast graph-specific channels (clear + stateChanged + watching-started)
      // Additional ui:call broadcasts may come from settings/vault state updates
      const graphBroadcasts: BroadcastCall[] = getGraphBroadcasts(broadcastCalls)
      expectLoadBroadcastSequence(graphBroadcasts)

      const clearBroadcast: BroadcastCall = graphBroadcasts[0]
      const stateChangedBroadcast: BroadcastCall = graphBroadcasts[1]
      const watchingStartedBroadcast: BroadcastCall = graphBroadcasts[2]

      // AND: First broadcast should be graph:clear
      expect(clearBroadcast.channel).toBe('graph:clear')

      // AND: Second broadcast should use graph:projectedGraphUpdate channel
      expect(stateChangedBroadcast.channel).toBe('graph:projectedGraphUpdate')

      // AND: Third broadcast should be watching-started
      expect(watchingStartedBroadcast.channel).toBe('watching-started')

      // AND: Delta should be an array of NodeDeltas
      expect(Array.isArray(stateChangedBroadcast.delta)).toBe(true)

      // AND: Delta should contain node additions for all loaded nodes
      expect(stateChangedBroadcast.delta.length).toBe(Object.keys(getGraph().nodes).length)

      // Verify each delta has the expected structure (UpsertNodeAction or DeleteNode)
      stateChangedBroadcast.delta.forEach(nodeDelta => {
        expect(nodeDelta).toHaveProperty('type')
        // UpsertNodeAction should have nodeToUpsert property
        if (nodeDelta.type === 'UpsertNode') {
          expect(nodeDelta).toHaveProperty('nodeToUpsert')
        }
      })
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should broadcast delta when switching directories', async () => {
      // GIVEN: Load first directory
      await loadFixtureFolder(exampleSmallPath)
      const firstGraphBroadcasts: BroadcastCall[] = getGraphBroadcasts(broadcastCalls)
      expect(firstGraphBroadcasts.length).toBe(3) // clear + stateChanged + watching-started

      // WHEN: Load second directory
      await loadFixtureFolder(exampleLargePath)

      // THEN: Should have 6 graph-specific broadcasts total (3 for each load)
      const allGraphBroadcasts: BroadcastCall[] = getGraphBroadcasts(broadcastCalls)
      expect(allGraphBroadcasts.length).toBe(6)

      // Verify second load broadcasts
      const secondClearBroadcast: BroadcastCall = allGraphBroadcasts[3]
      const secondStateChangedBroadcast: BroadcastCall = allGraphBroadcasts[4]
      const secondWatchingStartedBroadcast: BroadcastCall = allGraphBroadcasts[5]
      expect(secondClearBroadcast.channel).toBe('graph:clear')
      expect(secondStateChangedBroadcast.channel).toBe('graph:projectedGraphUpdate')
      expect(secondWatchingStartedBroadcast.channel).toBe('watching-started')
      expect(Array.isArray(secondStateChangedBroadcast.delta)).toBe(true)
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Verify node properties', () => {
    it('should load nodes with all required properties', async () => {
      // WHEN: Load directory
      await loadFixtureFolder(exampleSmallPath)

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
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Recover from malformed YAML frontmatter', () => {
    it('should load files with bad YAML frontmatter and fall back to heading/filename', async () => {
      // WHEN: Load directory containing file with bad YAML
      await loadFixtureFolder(exampleSmallPath)

      // THEN: Should still load all nodes including the one with bad YAML
      const graph: Graph = getGraph()
      expect(Object.keys(graph.nodes).length).toBeGreaterThanOrEqual(MIN_SMALL_NODE_COUNT)

      // AND: The bad YAML file should be present
      // Node IDs are now absolute paths
      const badYamlPath: string = path.join(exampleSmallPath, 'voicetree/7_Bad_YAML_Frontmatter_Test.md')
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
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: projectRoot updated before file limit check (suffix bug fix)', () => {
    it('should update projectRoot immediately when loadFolder is called', async () => {
      // GIVEN: Load the first folder
      await loadFixtureFolder(exampleSmallPath)
      expectWatchedDirectory(exampleSmallPath)

      // WHEN: Load a different folder
      await loadFixtureFolder(exampleLargePath)

      // THEN: projectRoot should be updated to the new folder
      expectWatchedDirectory(exampleLargePath)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should maintain projectRoot even after switching folders multiple times', async () => {
      // Load folder A
      await loadFixtureFolder(exampleSmallPath)
      expectWatchedDirectory(exampleSmallPath)

      // Load folder B
      await loadFixtureFolder(exampleLargePath)
      expectWatchedDirectory(exampleLargePath)

      // Load folder A again
      await loadFixtureFolder(exampleSmallPath)
      expectWatchedDirectory(exampleSmallPath)
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })
})
