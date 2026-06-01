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

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { openProject, stopFileWatching, isWatching } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import type { Graph, GraphNode } from '@vt/graph-model/graph'
import { createEmptyGraph } from '@vt/graph-model/graph'
import path from 'path'
import os from 'os'
import { promises as fs } from 'fs'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths'
import { waitForCondition, waitForWatcherReady, waitForFSEvent } from '@/utils/test-utils/waitForCondition'
import { initGraphModel } from '@vt/graph-model'
import { clearDaemonClientCache, getActiveDaemonClient } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'

function hasEdgeToBasename(node: GraphNode | undefined, basename: string): boolean {
  if (!node?.outgoingEdges) return false
  return node.outgoingEdges.some(e => path.basename(e.targetId, '.md') === basename)
}

let testProjectPath: string
let testVoicetreeDir: string
const INTEGRATION_TEST_TIMEOUT_MS: number = 30_000
const FILE_WATCH_SYNC_TIMEOUT_MS: number = 15_000

async function waitForGraphCondition(
  condition: () => boolean,
  errorMessage: string,
): Promise<void> {
  await waitForCondition(condition, {
    maxWaitMs: FILE_WATCH_SYNC_TIMEOUT_MS,
    errorMessage,
  })
}

vi.mock('@/shell/edge/main/runtime/state/app-electron-state', () => ({
  getMainWindow: vi.fn(() => ({
    webContents: {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    },
    isDestroyed: vi.fn(() => false)
  })),
  setMainWindow: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now())
  }
}))

describe.skip('File Watching - Edge Management Tests', () => {
  beforeAll(async () => {
    initGraphModel({})

    testProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'file-watching-test-'))
    await fs.cp(EXAMPLE_SMALL_PATH, testProjectPath, { recursive: true })
    await fs.rm(path.join(testProjectPath, '.voicetree', 'graphd.lock'), { force: true })
    await fs.rm(path.join(testProjectPath, '.voicetree', 'graphd.port'), { force: true })
    testVoicetreeDir = path.join(testProjectPath, 'voicetree')

    setGraph(createEmptyGraph())

    await openProject(testProjectPath)
    expect(await isWatching()).toBe(true)
    await waitForWatcherReady()
  }, INTEGRATION_TEST_TIMEOUT_MS)

  afterAll(async () => {
    await stopFileWatching()
    await getActiveDaemonClient()?.shutdown().catch(() => undefined)
    clearDaemonClientCache()
    vi.clearAllMocks()
    await fs.rm(testProjectPath, { recursive: true, force: true })
  })

  describe('BEHAVIOR: Wikilink edge creation and deletion', () => {
    it('should create edge when appending wikilink WITH .md extension', async () => {
      const testFilePath: string = path.join(testVoicetreeDir, 'test-edge-with-ext.md')
      await fs.writeFile(testFilePath, '# Test Edge With Ext\n\nThis is a test file.', 'utf-8')

      await waitForFSEvent()
      await waitForGraphCondition(
        () => !!getGraph().nodes[testFilePath],
        'test-edge-with-ext node not added to graph',
      )

      const targetFilePath: string = path.join(testVoicetreeDir, '5_Immediate_Test_Observation_No_Output.md')
      const originalContent: string = await fs.readFile(targetFilePath, 'utf-8')
      await fs.writeFile(targetFilePath, originalContent + '\n\n[[test-edge-with-ext.md]]', 'utf-8')

      await waitForFSEvent()
      await waitForGraphCondition(
        () => hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-edge-with-ext'),
        'Edge to test-edge-with-ext not created',
      )

      const graph: Graph = getGraph()
      const sourceNode: GraphNode = graph.nodes[targetFilePath]
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(hasEdgeToBasename(sourceNode, 'test-edge-with-ext')).toBe(true)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it.skip('should create edge when appending wikilink WITHOUT .md extension', async () => {
      const testFilePath: string = path.join(testVoicetreeDir, 'test-edge-no-ext.md')
      await fs.writeFile(testFilePath, '# Test Edge No Ext\n\nThis is a test file.', 'utf-8')

      await waitForFSEvent()
      await waitForGraphCondition(
        () => !!getGraph().nodes[testFilePath],
        'test-edge-no-ext node not added to graph',
      )

      const targetFilePath: string = path.join(testVoicetreeDir, '5_Immediate_Test_Observation_No_Output.md')
      const originalContent: string = await fs.readFile(targetFilePath, 'utf-8')
      await fs.writeFile(targetFilePath, originalContent + '\n\n[[test-edge-no-ext]]', 'utf-8')

      await waitForFSEvent()
      await waitForGraphCondition(
        () => hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-edge-no-ext'),
        'Edge to test-edge-no-ext not created',
      )

      const graph: Graph = getGraph()
      const sourceNode: GraphNode = graph.nodes[targetFilePath]
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(hasEdgeToBasename(sourceNode, 'test-edge-no-ext')).toBe(true)
    }, INTEGRATION_TEST_TIMEOUT_MS)

    it.skip('should remove edge when wikilink is removed from file content', async () => {
      const testFilePath: string = path.join(testVoicetreeDir, 'test-edge-removal.md')
      await fs.writeFile(testFilePath, '# Test Edge Removal\n\nThis is a test file.', 'utf-8')

      await waitForFSEvent()
      await waitForGraphCondition(
        () => !!getGraph().nodes[testFilePath],
        'test-edge-removal node not added to graph',
      )

      const targetFilePath: string = path.join(testVoicetreeDir, '5_Immediate_Test_Observation_No_Output.md')
      const contentBeforeLink: string = await fs.readFile(targetFilePath, 'utf-8')

      await fs.writeFile(targetFilePath, contentBeforeLink + '\n\n[[test-edge-removal]]', 'utf-8')

      await waitForFSEvent()
      await waitForGraphCondition(
        () => hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-edge-removal'),
        'Edge not added before removal test',
      )

      await fs.writeFile(targetFilePath, contentBeforeLink, 'utf-8')

      await waitForFSEvent()
      await waitForGraphCondition(
        () => !hasEdgeToBasename(getGraph().nodes[targetFilePath], 'test-edge-removal'),
        'Edge to test-edge-removal not removed',
      )

      const graph: Graph = getGraph()
      const sourceNode: GraphNode = graph.nodes[targetFilePath]
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(hasEdgeToBasename(sourceNode, 'test-edge-removal')).toBe(false)
    }, INTEGRATION_TEST_TIMEOUT_MS)
  })

  describe('BEHAVIOR: Frontmatter color parsing from filesystem events', () => {
    it('should parse color from frontmatter when file is added via filesystem event', async () => {
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

      await waitForFSEvent()
      await waitForGraphCondition(
        () => {
          const node: GraphNode = getGraph().nodes[testFilePath]
          return node?.nodeUIMetadata.color._tag === 'Some' && node.nodeUIMetadata.color.value === 'cyan'
        },
        'test-color-node not added with color parsed from frontmatter',
      )

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
