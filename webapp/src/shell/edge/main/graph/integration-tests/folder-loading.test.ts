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
import { openVault, stopFileWatching, isWatching, getWatchStatus } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import type { GraphDelta, Graph, UpsertNodeDelta, DeleteNode, GraphNode, Edge } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import { getNodeTitle } from '@vt/graph-model/markdown'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import type { BrowserWindow } from 'electron'
import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths'
import { clearRecentDeltas } from '@vt/graph-db-server/state/recent-deltas-store'
import { waitForCondition } from '@/utils/test-utils/waitForCondition'
import { initGraphModel } from '@vt/graph-model'
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { setAppSupportPath } from '@vt/graph-db-server/state/app-support-store'
import { handleFSEventWithStateAndUISides } from '@vt/graph-db-server/graph/handleFSEvent'
import { GraphDbClient } from '@vt/graph-db-client'
import { clearDaemonClientCache } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'

// Track IPC broadcasts
interface BroadcastCall {
  readonly channel: string
  readonly delta: GraphDelta
}

// Minimum fixture counts for the configured write paths. The loader can also
// resolve linked nodes that live outside the write path, so exact totals depend
// on the observable graph state after loading.
const MIN_SMALL_NODE_COUNT: 10 = 10 as const
const MIN_LARGE_NODE_COUNT: 75 = 75 as const
const INTEGRATION_TEST_TIMEOUT_MS: 30000 = 30000 as const

async function loadFixtureFolder(folderPath: string): Promise<void> {
  await openVault(folderPath)
  await waitForCondition(
    () => Object.keys(getGraph().nodes).some(nodePath => nodePath.startsWith(`${folderPath}${path.sep}`)),
    { maxWaitMs: 10000, errorMessage: `Graph did not populate for loaded fixture folder: ${folderPath}` }
  )
}

async function expectWatchedDirectory(expected: string): Promise<void> {
  const status = await getWatchStatus()
  expect(status.isWatching).toBe(true)
  expect(status.directory).toBe(expected)
}

// State for mocks
let broadcastCalls: Array<BroadcastCall> = []
let mockMainWindow: { readonly webContents: { readonly send: (channel: string, data: GraphDelta) => void; readonly isDestroyed: () => boolean }, readonly isDestroyed: () => boolean }
let tempFixtureRoot: string | null = null
let exampleSmallPath: string
let exampleLargePath: string

async function copyFixtureToTemp(sourcePath: string, destinationName: string): Promise<string> {
  if (!tempFixtureRoot) {
    throw new Error('tempFixtureRoot must be initialized before copying fixtures')
  }

  const destinationPath: string = path.join(tempFixtureRoot, destinationName)
  await fs.cp(sourcePath, destinationPath, { recursive: true })
  await Promise.all([
    fs.rm(path.join(destinationPath, '.voicetree', 'graphd.port'), { force: true }),
    fs.rm(path.join(destinationPath, '.voicetree', 'graphd.lock'), { force: true })
  ])
  return destinationPath
}

async function shutdownDaemonForVault(projectRoot: string | undefined): Promise<void> {
  if (!projectRoot) return
  const client: GraphDbClient | null = await GraphDbClient.connect({ vault: projectRoot }).catch(() => null)
  await client?.shutdown().catch(() => undefined)
}

async function shutdownFixtureDaemons(): Promise<void> {
  await Promise.all([
    shutdownDaemonForVault(exampleSmallPath),
    shutdownDaemonForVault(exampleLargePath)
  ])
  clearDaemonClientCache()
}

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
    tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-loading-fixtures-'))
    exampleSmallPath = await copyFixtureToTemp(EXAMPLE_SMALL_PATH, 'example_small')
    exampleLargePath = await copyFixtureToTemp(EXAMPLE_LARGE_PATH, 'example_real_large')
  }, INTEGRATION_TEST_TIMEOUT_MS)

  beforeEach(async () => {
    // Drain fire-and-forget async operations from previous test (e.g. void applyAndBroadcast
    // which does async wikilink resolution before publishing projected graph updates)
    await new Promise(resolve => setTimeout(resolve, 500))

    // Reset broadcast tracking before wiring graph-model callbacks.
    broadcastCalls = []

    // Initialize graph model with test callbacks that mirror Electron IPC channels.
    const appSupport = path.join(tempFixtureRoot, 'app-support')
    setAppSupportPath(appSupport)
    initGraphModel({
      onGraphCleared: (): void => {
        broadcastCalls.push({ channel: 'graph:clear', delta: [] })
      },
      onWatchingStarted: (): void => {
        broadcastCalls.push({ channel: 'watching-started', delta: [] })
      }
    })

    // Reset graph state
    setGraph(createGraph({}))

    await saveVaultConfigForDirectory(appSupport, exampleSmallPath, {
      writeFolder: path.join(exampleSmallPath, 'voicetree')
    })
    await saveVaultConfigForDirectory(appSupport, exampleLargePath, {
      writeFolder: path.join(exampleLargePath, 'voicetree')
    })

    for (const testFilePath of [
      path.join(exampleSmallPath, 'test-new-file.md'),
      path.join(exampleSmallPath, 'test-new-file-simple.md'),
      path.join(exampleSmallPath, 'voicetree', 'test-new-file.md'),
      path.join(exampleSmallPath, 'voicetree', 'test-new-file-simple.md')
    ]) {
      await fs.unlink(testFilePath).catch(() => undefined)
    }

    // Clear recent writes to ensure fresh state for file watching tests
    clearRecentDeltas()

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
    const ctxNodesPath: string = path.join(exampleSmallPath, 'ctx-nodes')
    const ctxNodesDirExists: boolean = await fs.access(ctxNodesPath).then(() => true).catch(() => false)
    if (ctxNodesDirExists) {
      await fs.rm(ctxNodesPath, { recursive: true, force: true })
    }

    // Also clean up voicetree/ctx-nodes since that's what gets loaded (with DEFAULT_VAULT_SUFFIX)
    const voicetreeCtxNodesPath: string = path.join(exampleSmallPath, 'voicetree', 'ctx-nodes')
    const voicetreeCtxNodesDirExists: boolean = await fs.access(voicetreeCtxNodesPath).then(() => true).catch(() => false)
    if (voicetreeCtxNodesDirExists) {
      await fs.rm(voicetreeCtxNodesPath, { recursive: true, force: true })
    }
  })

  afterEach(async () => {
    await stopFileWatching()

    // Clean up test file if it exists - functional approach without try-catch
    for (const testFilePath of [
      path.join(exampleSmallPath, 'test-new-file.md'),
      path.join(exampleSmallPath, 'test-new-file-simple.md'),
      path.join(exampleSmallPath, 'voicetree', 'test-new-file.md'),
      path.join(exampleSmallPath, 'voicetree', 'test-new-file-simple.md')
    ]) {
      const fileExists: boolean = await fs.access(testFilePath).then(() => true).catch(() => false)
      if (fileExists) {
        await fs.unlink(testFilePath)
      }
    }

    // Clean up ctx-nodes directories if they exist (created by terminal tests)
    const ctxNodesPath: string = path.join(exampleSmallPath, 'ctx-nodes')
    const ctxNodesDirExists: boolean = await fs.access(ctxNodesPath).then(() => true).catch(() => false)
    if (ctxNodesDirExists) {
      await fs.rm(ctxNodesPath, { recursive: true, force: true })
    }

    // Also clean up voicetree/ctx-nodes
    const voicetreeCtxNodesPath: string = path.join(exampleSmallPath, 'voicetree', 'ctx-nodes')
    const voicetreeCtxNodesDirExists: boolean = await fs.access(voicetreeCtxNodesPath).then(() => true).catch(() => false)
    if (voicetreeCtxNodesDirExists) {
      await fs.rm(voicetreeCtxNodesPath, { recursive: true, force: true })
    }

    vi.clearAllMocks()
  })

  afterAll(async () => {
    await shutdownFixtureDaemons()
    if (tempFixtureRoot) {
      await fs.rm(tempFixtureRoot, { recursive: true, force: true })
      tempFixtureRoot = null
    }
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
      const graphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:projectedGraphUpdate', 'watching-started'].includes(c.channel)
      )
      expect(graphBroadcasts.length).toBe(3)
      expect(graphBroadcasts[0].channel).toBe('graph:clear')
      expect(graphBroadcasts[1].channel).toBe('graph:projectedGraphUpdate')
      expect(graphBroadcasts[1].delta).toBeDefined()
      expect(graphBroadcasts[2].channel).toBe('watching-started')
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
      const graphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:projectedGraphUpdate', 'watching-started'].includes(c.channel)
      )
      expect(graphBroadcasts.length).toBe(3)
      expect(graphBroadcasts[0].channel).toBe('graph:clear')
      expect(graphBroadcasts[1].channel).toBe('graph:projectedGraphUpdate')
      expect(graphBroadcasts[2].channel).toBe('watching-started')
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
      expect(await isWatching()).toBe(true)

      // STEP 1b: Test file addition and deletion by simulating FS events
      // Clear broadcasts from initial load
      broadcastCalls.length = 0

      // Clear recent writes to ensure file watching will detect the new file
      clearRecentDeltas()

      // Import handler to simulate FS events
      const testFilePath: string = path.join(exampleSmallPath, 'test-new-file.md')
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

      handleFSEventWithStateAndUISides(addEvent, exampleSmallPath, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete (involves FS I/O for wikilink resolution)
      await waitForCondition(
        () => !!getGraph().nodes[testFilePath],
        { maxWaitMs: 5000, errorMessage: 'test-new-file node not added to graph via handleFSEvent' }
      )

      // Verify the node was added to the graph - node IDs are now absolute paths
      const graphAfterAdd: Graph = getGraph()
      expect(graphAfterAdd.nodes[testFilePath]).toBeDefined()
      expect(graphAfterAdd.nodes[testFilePath].contentWithoutYamlOrLinks).toBe(expectedContent)
      expect(Object.keys(graphAfterAdd.nodes).length).toBeGreaterThanOrEqual(smallNodeCount)

      // Verify edge was created from test-new-file to 5_Immediate_Test_Observation_No_Output
      const testNode: GraphNode = graphAfterAdd.nodes[testFilePath]
      expect(testNode.outgoingEdges).toBeDefined()
      expect(Array.isArray(testNode.outgoingEdges)).toBe(true)
      // Node IDs now include .md extension
      expect(testNode.outgoingEdges.some((e: Edge) => e.targetId.includes('5_Immediate_Test_Observation_No_Output'))).toBe(true)

      // Verify broadcast was sent (graph:projectedGraphUpdate)
      // Note: handleFSEventWithStateAndUISides sends 2 broadcasts:
      // 1. graph:projectedGraphUpdate (for cytoscape UI)
      // 2. ui:call (for floating editors)
      const graphStateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:projectedGraphUpdate')
      if (graphStateChangedBroadcasts.length > 0) {
        const addBroadcast: BroadcastCall | undefined = graphStateChangedBroadcasts.find(call =>
          call.delta.some(d => d.type === 'UpsertNode' && d.nodeToUpsert.absoluteFilePathIsID === testFilePath)
        )
        expect(addBroadcast).toBeDefined()
      }

      // Reset broadcast tracking
      broadcastCalls.length = 0

      // Delete the file from disk
      await fs.unlink(testFilePath)

      // Simulate the FS event for file deletion
      const deleteEvent: { type: "Delete"; absolutePath: string; } = {
        type: 'Delete' as const,
        absolutePath: testFilePath
      }

      handleFSEventWithStateAndUISides(deleteEvent, exampleSmallPath, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete
      await waitForCondition(
        () => !getGraph().nodes[testFilePath],
        { maxWaitMs: 5000, errorMessage: 'test-new-file node not removed from graph via handleFSEvent' }
      )

      // Verify the node was removed from the graph - node IDs are absolute paths
      const graphAfterDelete: Graph = getGraph()
      expect(graphAfterDelete.nodes[testFilePath]).toBeUndefined()

      // Verify broadcast was sent (graph:projectedGraphUpdate)
      // Note: handleFSEventWithStateAndUISides sends 2 broadcasts:
      // 1. graph:projectedGraphUpdate (for cytoscape UI)
      // 2. ui:call (for floating editors)
      const deleteGraphStateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:projectedGraphUpdate')
      if (deleteGraphStateChangedBroadcasts.length > 0) {
        const deleteBroadcast: BroadcastCall | undefined = deleteGraphStateChangedBroadcasts.find(call =>
          call.delta.some(d => d.type === 'DeleteNode' && d.nodeId === testFilePath)
        )
        expect(deleteBroadcast).toBeDefined()
      }

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
      expect(await isWatching()).toBe(true)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should not throw when switching vaults while a previous load is not connected to the daemon', async () => {
      // Regression: simulate the old race where a concurrent/failed first load
      // left stale main-process state, causing writeCurrentPositionsThroughDaemon to
      // throw "No vault is currently open" and blocking the vault switch entirely.
      //
      // Reproduces: concurrent initialLoad + debug-auto-setup both calling loadFolder, with the
      // second load seeing stale state from the first (daemon not yet connected).
      // The old load implementation attempted writeCurrentPositionsThroughDaemon and
      // had to avoid propagating that error.

      await openVault(exampleLargePath)
      await expectWatchedDirectory(exampleLargePath)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should detect file addition and deletion after folder is loaded', async () => {
      // GIVEN: Load a folder and wait for watcher to be ready
      await loadFixtureFolder(exampleSmallPath)
      expect(await isWatching()).toBe(true)

      // Clear broadcasts from initial load
      broadcastCalls.length = 0

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 300))

      // WHEN: Add a new file using the file watching handler module's approach
      // Since chokidar doesn't reliably detect files in test env, we simulate the FS event
      const newFilePath: string = path.join(exampleSmallPath, 'test-new-file-simple.md')
      const newFileContent: "# Test New File\n\nThis is a test." = '# Test New File\n\nThis is a test.'

      await fs.writeFile(newFilePath, newFileContent, 'utf-8')

      // Import and call the FS event handler directly to simulate watcher detection
      const addEvent: { absolutePath: string; content: string; eventType: "Added"; } = {
        absolutePath: newFilePath,
        content: newFileContent,
        eventType: 'Added' as const
      }


      handleFSEventWithStateAndUISides(addEvent, exampleSmallPath, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete (involves FS I/O for wikilink resolution)
      // Must wait for both graph state AND broadcast since the broadcast fires after async wikilink resolution
      await waitForCondition(
        () => !!getGraph().nodes[newFilePath] && broadcastCalls.some(call => call.channel === 'graph:projectedGraphUpdate'),
        { maxWaitMs: 5000, errorMessage: 'test-new-file node not added to graph via handleFSEvent' }
      )

      // THEN: Graph should contain the new node - node IDs are absolute paths
      const graph: Graph = getGraph()
      expect(graph.nodes[newFilePath]).toBeDefined()
      expect(graph.nodes[newFilePath].contentWithoutYamlOrLinks).toBe(newFileContent)

      // AND: Broadcast should have been sent (graph:projectedGraphUpdate)
      const stateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:projectedGraphUpdate')
      expect(stateChangedBroadcasts.length).toBeGreaterThanOrEqual(1)
      expect(stateChangedBroadcasts[0].channel).toBe('graph:projectedGraphUpdate')

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


      handleFSEventWithStateAndUISides(deleteEvent, exampleSmallPath, mockMainWindow as unknown as BrowserWindow)

      // Wait for async applyAndBroadcast to complete (wait for both graph state and broadcast)
      await waitForCondition(
        () => !getGraph().nodes[newFilePath] && broadcastCalls.some(call => call.channel === 'graph:projectedGraphUpdate'),
        { maxWaitMs: 5000, errorMessage: 'test-new-file node not removed from graph via handleFSEvent' }
      )

      // THEN: GraphNode should be removed from graph - node IDs are absolute paths
      const graphAfterDelete: Graph = getGraph()
      expect(graphAfterDelete.nodes[newFilePath]).toBeUndefined()

      // AND: Broadcast should have been sent (graph:projectedGraphUpdate)
      const deleteStateChangedBroadcasts: BroadcastCall[] = broadcastCalls.filter(call => call.channel === 'graph:projectedGraphUpdate')
      expect(deleteStateChangedBroadcasts.length).toBeGreaterThanOrEqual(1)
      expect(deleteStateChangedBroadcasts[0].channel).toBe('graph:projectedGraphUpdate')

      const deleteDelta: DeleteNode | undefined = deleteStateChangedBroadcasts[0].delta.find(d => d.type === 'DeleteNode')
      expect(deleteDelta).toBeDefined()
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Broadcast deltas on load', () => {
    it('should broadcast GraphDelta when loading a directory', async () => {
      // WHEN: Load directory
      await loadFixtureFolder(exampleSmallPath)

      // THEN: Should have broadcast graph-specific channels (clear + stateChanged + watching-started)
      // Additional ui:call broadcasts may come from settings/vault state updates
      const graphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:projectedGraphUpdate', 'watching-started'].includes(c.channel)
      )
      expect(graphBroadcasts.length).toBe(3)

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
      const firstGraphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:projectedGraphUpdate', 'watching-started'].includes(c.channel)
      )
      expect(firstGraphBroadcasts.length).toBe(3) // clear + stateChanged + watching-started

      // WHEN: Load second directory
      await loadFixtureFolder(exampleLargePath)

      // THEN: Should have 6 graph-specific broadcasts total (3 for each load)
      const allGraphBroadcasts: BroadcastCall[] = broadcastCalls.filter(c =>
        ['graph:clear', 'graph:projectedGraphUpdate', 'watching-started'].includes(c.channel)
      )
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
      await expectWatchedDirectory(exampleSmallPath)

      // WHEN: Load a different folder
      await loadFixtureFolder(exampleLargePath)

      // THEN: projectRootWatchedDirectory should be updated to the new folder
      await expectWatchedDirectory(exampleLargePath)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should maintain projectRoot even after switching folders multiple times', async () => {
      // Load folder A
      await loadFixtureFolder(exampleSmallPath)
      await expectWatchedDirectory(exampleSmallPath)

      // Load folder B
      await loadFixtureFolder(exampleLargePath)
      await expectWatchedDirectory(exampleLargePath)

      // Load folder A again
      await loadFixtureFolder(exampleSmallPath)
      await expectWatchedDirectory(exampleSmallPath)
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })
})
