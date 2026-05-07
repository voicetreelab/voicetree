/**
 * Integration test for file watching and edge management
 *
 * BEHAVIOR TESTED:
 * - File content changes trigger graph updates
 * - Wikilinks create edges in the graph
 * - Removing wikilinks removes edges from the graph
 * - Both [[file]] and [[file.md]] formats work correctly
 *
 * Testing Strategy:
 * - Create a new file in the voicetree subfolder (watched by chokidar)
 * - Modify an existing file to add wikilink to the new file
 * - Verify edge is created
 * - Remove the wikilink and verify edge is removed
 * - Test both with and without .md extension
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadFolder, stopFileWatching, isWatching } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getGraph, setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import type { GraphDelta, Graph, GraphNode } from '@vt/graph-model/pure/graph'
import { createEmptyGraph } from '@vt/graph-model/pure/graph/createGraph'
import path from 'path'
import os from 'os'
import { promises as fs } from 'fs'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths'
import { waitForCondition, waitForWatcherReady, waitForFSEvent } from '@/utils/test-utils/waitForCondition'
import { initGraphModel } from '@vt/graph-model'
import { clearDaemonClientCache, getActiveDaemonClient } from '@/shell/edge/main/electron/graph-daemon'

function hasEdgeToBasename(node: GraphNode | undefined, basename: string): boolean {
  if (!node?.outgoingEdges) return false
  return node.outgoingEdges.some(e => path.basename(e.targetId, '.md') === basename)
}

// Track IPC broadcasts
interface BroadcastCall {
  readonly channel: string
  readonly delta: GraphDelta
}

// State for mocks

let broadcastCalls: BroadcastCall[] = []
let mockMainWindow: { readonly webContents: { readonly send: (channel: string, data: GraphDelta) => void; readonly isDestroyed: () => boolean }, readonly isDestroyed: () => boolean }
let testProjectPath: string
let testVoicetreeDir: string
const INTEGRATION_TEST_TIMEOUT_MS = 30_000

// Mock app-electron-state
vi.mock('@/shell/edge/main/state/app-electron-state', () => ({
  getMainWindow: vi.fn(() => mockMainWindow),
  setMainWindow: vi.fn()
}))

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now())
  }
}))

describe('File Watching - Edge Management Tests', () => {
  beforeEach(async () => {
    // Initialize graph model (replaces electron app.getPath mock)
    initGraphModel({ appSupportPath: '/tmp/test-userdata-file-watching' })

    testProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'file-watching-test-'))
    await fs.cp(EXAMPLE_SMALL_PATH, testProjectPath, { recursive: true })
    await fs.rm(path.join(testProjectPath, '.voicetree', 'graphd.lock'), { force: true })
    await fs.rm(path.join(testProjectPath, '.voicetree', 'graphd.port'), { force: true })
    testVoicetreeDir = path.join(testProjectPath, 'voicetree')

    // Reset graph state
    setGraph(createEmptyGraph())
    setVaultPath('')

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
  })

  afterEach(async () => {
    await stopFileWatching()
    await getActiveDaemonClient()?.shutdown().catch(() => undefined)
    clearDaemonClientCache()

    // Clean up test files in voicetree subfolder
    const testFilePath: string = path.join(testVoicetreeDir, 'test-new-file.md')
    const testColorFilePath: string = path.join(testVoicetreeDir, 'test-color-node.md')
    const targetFilePath: string = path.join(testVoicetreeDir, '5_Immediate_Test_Observation_No_Output.md')
    const backupPath: string = targetFilePath + '.backup'

    try {
      await fs.unlink(testFilePath)
    } catch {
      // File might not exist, that's ok
    }

    try {
      await fs.unlink(testColorFilePath)
    } catch {
      // File might not exist, that's ok
    }

    // Restore original content if backup exists
    try {
      const backup: string = await fs.readFile(backupPath, 'utf-8')
      await fs.writeFile(targetFilePath, backup, 'utf-8')
      await fs.unlink(backupPath)
    } catch {
      // Backup might not exist, that's ok
    }

    vi.clearAllMocks()
    await fs.rm(testProjectPath, { recursive: true, force: true })
  })

  describe('BEHAVIOR: Wikilink edge creation and deletion', () => {
    it('should create edge when appending wikilink WITH .md extension', async () => {
      // GIVEN: Load folder and create a new file in voicetree subfolder (watched by chokidar)
      await loadFolder(testProjectPath)
      expect(isWatching()).toBe(true)

      await waitForWatcherReady()

      // Node IDs are absolute paths
      const testFilePath: string = path.join(testVoicetreeDir, 'test-new-file.md')
      const testFileContent: string = '# Test New File\n\nThis is a test file.'

      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for file to be detected and added to graph - node IDs are absolute paths
      await waitForFSEvent()
      await waitForCondition(
        () => !!getGraph().nodes[testFilePath],
        { maxWaitMs: 5000, errorMessage: 'test-new-file node not added to graph' }
      )

      // WHEN: Append wikilink WITH .md to an existing file in voicetree subfolder
      const targetFilePath: string = path.join(testVoicetreeDir, '5_Immediate_Test_Observation_No_Output.md')
      const originalContent: string = await fs.readFile(targetFilePath, 'utf-8')

      // Backup original content
      await fs.writeFile(targetFilePath + '.backup', originalContent, 'utf-8')

      const updatedContent: string = originalContent + '\n\n[[test-new-file.md]]'
      await fs.writeFile(targetFilePath, updatedContent, 'utf-8')

      // Wait for file change to be detected and edge to be created
      await waitForFSEvent()
      await waitForCondition(
        () => hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-new-file'),
        { maxWaitMs: 5000, errorMessage: 'Edge from 5_Immediate_Test_Observation_No_Output to test-new-file not created' }
      )

      // THEN: Edge should be created
      const graph: Graph = getGraph()
      const sourceNode: GraphNode = graph.nodes[targetFilePath]

      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(hasEdgeToBasename(sourceNode, 'test-new-file')).toBe(true)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should create edge when appending wikilink WITHOUT .md extension', async () => {
      // GIVEN: Load folder and create a new file in voicetree subfolder
      await loadFolder(testProjectPath)
      expect(isWatching()).toBe(true)

      await waitForWatcherReady()

      const testFilePath: string = path.join(testVoicetreeDir, 'test-new-file.md')
      const testFileContent: string = '# Test New File\n\nThis is a test file.'

      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for file to be detected and added to graph - node IDs are absolute paths
      await waitForFSEvent()
      await waitForCondition(
        () => !!getGraph().nodes[testFilePath],
        { maxWaitMs: 5000, errorMessage: 'test-new-file node not added to graph' }
      )

      // WHEN: Append wikilink WITHOUT .md to an existing file in voicetree subfolder
      const targetFilePath: string = path.join(testVoicetreeDir, '5_Immediate_Test_Observation_No_Output.md')
      const originalContent: string = await fs.readFile(targetFilePath, 'utf-8')

      // Backup original content
      await fs.writeFile(targetFilePath + '.backup', originalContent, 'utf-8')

      const updatedContent: string = originalContent + '\n\n[[test-new-file]]'
      await fs.writeFile(targetFilePath, updatedContent, 'utf-8')

      // Wait for file change to be detected and edge to be created
      await waitForFSEvent()
      await waitForCondition(
        () => hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-new-file'),
        { maxWaitMs: 5000, errorMessage: 'Edge from 5_Immediate_Test_Observation_No_Output to test-new-file not created' }
      )

      // THEN: Edge should be created
      const graph: Graph = getGraph()
      const sourceNode: GraphNode = graph.nodes[targetFilePath]
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(hasEdgeToBasename(sourceNode, 'test-new-file')).toBe(true)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it('should remove edge when wikilink is removed from file content', async () => {
      // GIVEN: Load folder and create a new file with a wikilink
      await loadFolder(testProjectPath)
      expect(isWatching()).toBe(true)

      await waitForWatcherReady()

      const testFilePath: string = path.join(testVoicetreeDir, 'test-new-file.md')
      const testFileContent: string = '# Test New File\n\nThis is a test file.'

      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for file to be detected and added to graph
      await waitForFSEvent()
      await waitForCondition(
        () => !!getGraph().nodes[testFilePath],
        { maxWaitMs: 5000, errorMessage: 'test-new-file node not added to graph' }
      )

      // Define clean original content without any wikilinks to test-new-file
      const targetFilePath: string = path.join(testVoicetreeDir, '5_Immediate_Test_Observation_No_Output.md')
      const cleanOriginalContent: string = `---
node_id: 5
title: 'Immediate Test Observation: No Output (5)'
---
### Speaker observes no output despite repeated speech input during an immediate test.

All right, so I'm testing 'one, two, three'. I don't see anything. All right, so I'm taking something about talking and...nothing is showing up. All right, so I'm talking, I'm talking, I'm talking, and nothing's coming up. Strange.


-----------------
_Links:_
Parent:
- is_an_immediate_observation_during [[4_Test_Outcome_No_Output.md]]`

      // Backup original content (current state which may be dirty from previous test runs)
      const currentContent: string = await fs.readFile(targetFilePath, 'utf-8')
      await fs.writeFile(targetFilePath + '.backup', currentContent, 'utf-8')

      // First ensure the file is in clean state without the wikilink
      await fs.writeFile(targetFilePath, cleanOriginalContent, 'utf-8')
      await waitForFSEvent()

      // Add wikilink to existing file
      const updatedContent: string = cleanOriginalContent + '\n\n[[test-new-file]]'
      await fs.writeFile(targetFilePath, updatedContent, 'utf-8')

      // Wait for edge to be created
      await waitForFSEvent()
      await waitForCondition(
        () => hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-new-file'),
        { maxWaitMs: 5000, errorMessage: 'Edge not added before removal test' }
      )

      // WHEN: Remove the wikilink by resetting to clean original content
      await fs.writeFile(targetFilePath, cleanOriginalContent, 'utf-8')

      // Wait for file change to be detected and edge to be removed
      await waitForFSEvent()
      await waitForCondition(
        () => !hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-new-file'),
        { maxWaitMs: 5000, errorMessage: 'Edge from 5_Immediate_Test_Observation_No_Output to test-new-file not removed' }
      )

      // THEN: Edge should be removed
      const graph: Graph = getGraph()
      const sourceNode: GraphNode = graph.nodes[targetFilePath]
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(hasEdgeToBasename(sourceNode, 'test-new-file')).toBe(false)
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Frontmatter color parsing from filesystem events', () => {
    it('should parse color from frontmatter when file is added via filesystem event', async () => {
      // GIVEN: Load folder
      await loadFolder(testProjectPath)
      expect(isWatching()).toBe(true)

      await waitForWatcherReady()

      // WHEN: Create a new file with color in frontmatter in voicetree subfolder
      const testFilePath: string = path.join(testVoicetreeDir, 'test-color-node.md')
      const testFileContent: string = `---
node_id: 57
title: (Sam) Fix Implemented and Test Passing (57)
color: cyan
agent_name: Sam
position:
  x: -819.9742978214647
  y: -1683.7117827984455
---

** Summary**
Successfully exposed VoiceTreeGraphView on window object. Test now passes with editor auto-opening correctly.

_Links:_
Parent:
- [[1762755382696eu7]]`

      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for file to be detected and node to be added with color parsed
      await waitForFSEvent()
      await waitForCondition(
        () => {
          const node: GraphNode = getGraph().nodes[testFilePath]
          return node?.nodeUIMetadata.color._tag === 'Some' && node.nodeUIMetadata.color.value === 'cyan'
        },
        { maxWaitMs: 5000, errorMessage: 'test-color-node not added with color parsed from frontmatter' }
      )

      // THEN: Verify color was parsed from frontmatter
      const graph: Graph = getGraph()
      const node: GraphNode = graph.nodes[testFilePath]

      expect(node).toBeDefined()
      expect(node.nodeUIMetadata.color._tag).toBe('Some')
      if (node.nodeUIMetadata.color._tag === 'Some') {
        expect(node.nodeUIMetadata.color.value).toBe('cyan')
      }
      expect(node.nodeUIMetadata.position._tag).toBe('Some')
      if (node.nodeUIMetadata.position._tag === 'Some') {
        expect(node.nodeUIMetadata.position.value.x).toBe(-819.9742978214647)
        expect(node.nodeUIMetadata.position.value.y).toBe(-1683.7117827984455)
      }
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })
})
