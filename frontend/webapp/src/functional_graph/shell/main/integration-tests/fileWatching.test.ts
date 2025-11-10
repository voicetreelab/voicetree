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
 * - Create a new file
 * - Modify an existing file to add wikilink to the new file
 * - Verify edge is created
 * - Remove the wikilink and verify edge is removed
 * - Test both with and without .md extension
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadFolder, stopWatching, isWatching } from '@/functional_graph/shell/main/watchFolder.ts'
import { getGraph, setGraph, setVaultPath } from '@/functional_graph/shell/state/graph-store.ts'
import type { GraphDelta } from '@/functional_graph/pure/types.ts'
import path from 'path'
import { promises as fs } from 'fs'

// Track IPC broadcasts
interface BroadcastCall {
  readonly channel: string
  readonly delta: GraphDelta
}

const EXAMPLE_SMALL_PATH = path.resolve(__dirname, '../../../../fixtures/example_small')

// State for mocks
// eslint-disable-next-line functional/prefer-readonly-type
let broadcastCalls: BroadcastCall[] = []
let mockMainWindow: { readonly webContents: { readonly send: (channel: string, data: GraphDelta) => void }, readonly isDestroyed: () => boolean }

// Mock app-electron-state
vi.mock('@/functional_graph/shell/state/app-electron-state', () => ({
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

    // Clean up test files
    const testFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
    const testColorFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-color-node.md')
    const testFilePathWithChanges = path.join(EXAMPLE_SMALL_PATH, '5_Immediate_Test_Observation_No_Output.md')
    const originalContent = path.join(EXAMPLE_SMALL_PATH, '5_Immediate_Test_Observation_No_Output.md.backup')

    // eslint-disable-next-line functional/no-try-statements
    try {
      await fs.unlink(testFilePath)
    } catch {
      // File might not exist, that's ok
    }

    // eslint-disable-next-line functional/no-try-statements
    try {
      await fs.unlink(testColorFilePath)
    } catch {
      // File might not exist, that's ok
    }

    // Restore original content if backup exists
    // eslint-disable-next-line functional/no-try-statements
    try {
      const backup = await fs.readFile(originalContent, 'utf-8')
      await fs.writeFile(testFilePathWithChanges, backup, 'utf-8')
      await fs.unlink(originalContent)
    } catch {
      // Backup might not exist, that's ok
    }

    vi.clearAllMocks()
  })

  describe('BEHAVIOR: Wikilink edge creation and deletion', () => {
    it('should create edge when appending wikilink WITH .md extension', async () => {
      // GIVEN: Load folder and create a new file
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(isWatching()).toBe(true)

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000))

      const testFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const testFileContent = '# Test New File\n\nThis is a test file.'

      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for file to be detected
      await new Promise(resolve => setTimeout(resolve, 1000))
      let nodeAdded = false
      const maxWaitTime = 5000
      const pollInterval = 200
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        if (currentGraph.nodes['test-new-file']) {
          nodeAdded = true
          break
        }
      }

      expect(nodeAdded).toBe(true)

      // WHEN: Append wikilink WITH .md to an existing file
      const targetFilePath = path.join(EXAMPLE_SMALL_PATH, '5_Immediate_Test_Observation_No_Output.md')
      const originalContent = await fs.readFile(targetFilePath, 'utf-8')

      // Backup original content
      await fs.writeFile(targetFilePath + '.backup', originalContent, 'utf-8')

      const updatedContent = originalContent + '\n\n[[test-new-file.md]]'
      await fs.writeFile(targetFilePath, updatedContent, 'utf-8')

      // Wait for file change to be detected
      await new Promise(resolve => setTimeout(resolve, 1000))
      let edgeAdded = false
      const edgeStartTime = Date.now()

      while (Date.now() - edgeStartTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        const sourceNode = currentGraph.nodes['5_Immediate_Test_Observation_No_Output']
        if (sourceNode?.outgoingEdges?.includes('test-new-file')) {
          edgeAdded = true
          break
        }
      }

      // THEN: Edge should be created (IDs always have .md extension stripped)
      const graph = getGraph()
      const sourceNode = graph.nodes['5_Immediate_Test_Observation_No_Output']

      expect(edgeAdded).toBe(true)
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(sourceNode.outgoingEdges).toContain('test-new-file')
    }, 15000)

    it('should create edge when appending wikilink WITHOUT .md extension', async () => {
      // GIVEN: Load folder and create a new file
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(isWatching()).toBe(true)

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000))

      const testFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const testFileContent = '# Test New File\n\nThis is a test file.'

      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for file to be detected
      await new Promise(resolve => setTimeout(resolve, 1000))
      let nodeAdded = false
      const maxWaitTime = 5000
      const pollInterval = 200
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        if (currentGraph.nodes['test-new-file']) {
          nodeAdded = true
          break
        }
      }

      expect(nodeAdded).toBe(true)

      // WHEN: Append wikilink WITHOUT .md to an existing file
      const targetFilePath = path.join(EXAMPLE_SMALL_PATH, '5_Immediate_Test_Observation_No_Output.md')
      const originalContent = await fs.readFile(targetFilePath, 'utf-8')

      // Backup original content
      await fs.writeFile(targetFilePath + '.backup', originalContent, 'utf-8')

      const updatedContent = originalContent + '\n\n[[test-new-file]]'
      await fs.writeFile(targetFilePath, updatedContent, 'utf-8')

      // Wait for file change to be detected
      await new Promise(resolve => setTimeout(resolve, 1000))
      let edgeAdded = false
      const edgeStartTime = Date.now()

      while (Date.now() - edgeStartTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        const sourceNode = currentGraph.nodes['5_Immediate_Test_Observation_No_Output']
        if (sourceNode?.outgoingEdges?.includes('test-new-file')) {
          edgeAdded = true
          break
        }
      }

      // THEN: Edge should be created
      expect(edgeAdded).toBe(true)
      const graph = getGraph()
      const sourceNode = graph.nodes['5_Immediate_Test_Observation_No_Output']
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(sourceNode.outgoingEdges).toContain('test-new-file')
    }, 15000)

    it('should remove edge when wikilink is removed from file content', async () => {
      // GIVEN: Load folder and create a new file with a wikilink
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(isWatching()).toBe(true)

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000))

      const testFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-new-file.md')
      const testFileContent = '# Test New File\n\nThis is a test file.'

      await fs.writeFile(testFilePath, testFileContent, 'utf-8')

      // Wait for file to be detected
      await new Promise(resolve => setTimeout(resolve, 1000))
      let nodeAdded = false
      const maxWaitTime = 5000
      const pollInterval = 200
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        if (currentGraph.nodes['test-new-file']) {
          nodeAdded = true
          break
        }
      }

      expect(nodeAdded).toBe(true)

      // Add wikilink to existing file
      const targetFilePath = path.join(EXAMPLE_SMALL_PATH, '5_Immediate_Test_Observation_No_Output.md')
      const originalContent = await fs.readFile(targetFilePath, 'utf-8')

      // Backup original content
      await fs.writeFile(targetFilePath + '.backup', originalContent, 'utf-8')

      const updatedContent = originalContent + '\n\n[[test-new-file]]'
      await fs.writeFile(targetFilePath, updatedContent, 'utf-8')

      // Wait for edge to be created
      await new Promise(resolve => setTimeout(resolve, 1000))
      let edgeAdded = false
      const edgeStartTime = Date.now()

      while (Date.now() - edgeStartTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        const sourceNode = currentGraph.nodes['5_Immediate_Test_Observation_No_Output']
        if (sourceNode?.outgoingEdges?.includes('test-new-file')) {
          edgeAdded = true
          break
        }
      }

      expect(edgeAdded).toBe(true)

      // WHEN: Remove the wikilink by resetting to original content
      await fs.writeFile(targetFilePath, originalContent, 'utf-8')

      // Wait for file change to be detected
      await new Promise(resolve => setTimeout(resolve, 1000))
      let edgeRemoved = false
      const removeStartTime = Date.now()

      while (Date.now() - removeStartTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        const sourceNode = currentGraph.nodes['5_Immediate_Test_Observation_No_Output']
        if (!sourceNode?.outgoingEdges?.includes('test-new-file')) {
          edgeRemoved = true
          break
        }
      }

      // THEN: Edge should be removed
      expect(edgeRemoved).toBe(true)
      const graph = getGraph()
      const sourceNode = graph.nodes['5_Immediate_Test_Observation_No_Output']
      expect(sourceNode.outgoingEdges).toBeDefined()
      expect(sourceNode.outgoingEdges).not.toContain('test-new-file')
    }, 15000)
  })

  describe('BEHAVIOR: Frontmatter color parsing from filesystem events', () => {
    it('should parse color from frontmatter when file is added via filesystem event', async () => {
      // GIVEN: Load folder
      await loadFolder(EXAMPLE_SMALL_PATH)
      expect(isWatching()).toBe(true)

      // Wait for watcher to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000))

      // WHEN: Create a new file with color in frontmatter
      const testFilePath = path.join(EXAMPLE_SMALL_PATH, 'test-color-node.md')
      const testFileContent = `---
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

      // Wait for file to be detected
      await new Promise(resolve => setTimeout(resolve, 1000))

      // THEN: Node should be added with color parsed from frontmatter
      let nodeAddedWithColor = false
      const maxWaitTime = 5000
      const pollInterval = 200
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        const currentGraph = getGraph()
        const node = currentGraph.nodes['test-color-node']

        if (node) {
          // Check if color has been parsed correctly
          if (node.nodeUIMetadata.color._tag === 'Some' && node.nodeUIMetadata.color.value === 'cyan') {
            nodeAddedWithColor = true
            break
          }
        }
      }

      // THEN: Verify color was parsed from frontmatter
      const graph = getGraph()
      const node = graph.nodes['test-color-node']

      expect(node).toBeDefined()
      expect(nodeAddedWithColor).toBe(true)
      expect(node.nodeUIMetadata.color._tag).toBe('Some')
      if (node.nodeUIMetadata.color._tag === 'Some') {
        expect(node.nodeUIMetadata.color.value).toBe('cyan')
      }
      expect(node.nodeUIMetadata.position._tag).toBe('Some')
      if (node.nodeUIMetadata.position._tag === 'Some') {
        expect(node.nodeUIMetadata.position.value.x).toBe(-819.9742978214647)
        expect(node.nodeUIMetadata.position.value.y).toBe(-1683.7117827984455)
      }
    }, 15000)
  })
})
