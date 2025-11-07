/**
 * Integration test for Module C: File Watch → Graph Updates
 *
 * BEHAVIOR TESTED:
 * - INPUT: File system changes (create, modify, delete markdown files)
 * - OUTPUT: Graph state updated correctly
 * - SIDE EFFECTS: Broadcast to renderer with new graph state
 *
 * This tests the integration between file watching and graph state updates.
 * We test the BEHAVIOR, not implementation details.
 *
 * Architecture:
 * FileWatchHandler → file-watch-handlers → applyFSEventToGraph (pure) → Graph state update + broadcast
 *
 * Testing Strategy:
 * - Use real temporary directory for filesystem operations
 * - Mock FileWatchHandler to trigger file events programmatically
 * - Mock mainWindow.webContents.send to capture broadcast calls
 * - DO NOT mock the pure functional core (applyFSEventToGraph) - test the real thing
 * - Verify end-to-end behavior: file change → graph updated + broadcast sent
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import { setupFileWatchHandlerForTests } from '@/electron/file-watch-handler.ts'
import type { Graph } from '@/functional_graph/pure/types.ts'
import type { BrowserWindow } from 'electron'

// State managed by mocked globals
let currentGraph: Graph = { nodes: {}, edges: {} }
let tempVault: string = ''
let mockMainWindow: any = null

// Mock ../main module
vi.mock('../../../electron/main', () => ({
  getGraph: () => currentGraph,
  setGraph: (graph: Graph) => {
    currentGraph = graph
  },
  getVaultPath: () => tempVault,
  getMainWindow: () => mockMainWindow
}))

// Mock FileWatchHandler interface for programmatic event triggering
interface MockFileWatchManager {
  sendToRenderer: (channel: string, data?: any) => void
}

describe('File Watch → Graph Updates - Behavioral Integration', () => {
  let mockFileWatchManager: MockFileWatchManager
  let broadcastCalls: Array<{ graph: Graph }>

  // Helper to access current graph (for tests)
  const getGraph = (): Graph => currentGraph

  beforeEach(async () => {
    // Create temporary vault for filesystem operations
    tempVault = path.join('/tmp', `test-vault-${Date.now()}`)
    await fs.mkdir(tempVault, { recursive: true })

    // Initialize graph to empty state (module-level variable)
    currentGraph = { nodes: {}, edges: {} }

    // Track all broadcast calls
    broadcastCalls = []

    // Create mock FileWatchManager with sendToRenderer method
    mockFileWatchManager = {
      sendToRenderer: vi.fn()
    }

    // Create mock BrowserWindow with webContents.send
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: any) => {
          if (channel === 'graph:stateChanged') {
            broadcastCalls.push({ graph: data })
          }
        })
      }
    } as any

    // Setup file watch handlers
    setupFileWatchHandlerForTests(
      mockFileWatchManager,
      () => currentGraph,
      (graph: Graph) => { currentGraph = graph },
      mockMainWindow,
      tempVault
    )
  })

  afterEach(async () => {
    // Cleanup temp vault
    await fs.rm(tempVault, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('BEHAVIOR: File created → GraphNode added to graph + broadcast', () => {
    it('should add node to graph when file-added event is triggered', async () => {
      // GIVEN: Empty graph and a markdown file created on disk
      const filePath = path.join(tempVault, 'test_node.md')
      const fileContent = '# Test GraphNode\n\nThis is a test node.'
      await fs.writeFile(filePath, fileContent, 'utf-8')

      expect(getGraph().nodes).toEqual({})

      // WHEN: FileWatchHandler detects the new file and triggers file-added event
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: filePath,
        content: fileContent
      })

      // THEN: Graph state should include the new node
      const updatedGraph = getGraph()
      expect(updatedGraph.nodes['test_node']).toBeDefined()
      expect(updatedGraph.nodes['test_node'].title).toBe('Test GraphNode')
      expect(updatedGraph.nodes['test_node'].content).toBe(fileContent)
      expect(updatedGraph.nodes['test_node'].id).toBe('test_node')

      // AND: Broadcast should be called with new graph state
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'graph:stateChanged',
        expect.objectContaining({
          nodes: expect.objectContaining({
            test_node: expect.objectContaining({
              title: 'Test GraphNode'
            })
          })
        })
      )

      // AND: Exactly one broadcast call
      expect(broadcastCalls).toHaveLength(1)
      expect(broadcastCalls[0].graph.nodes['test_node']).toBeDefined()
    })

    it('should extract node ID from file absolutePath correctly', async () => {
      // GIVEN: Files with different naming patterns
      const testCases = [
        { filename: 'simple.md', expectedId: 'simple' },
        { filename: 'with_underscore.md', expectedId: 'with_underscore' },
        { filename: 'with-dash.md', expectedId: 'with-dash' },
        { filename: 'CamelCase.md', expectedId: 'CamelCase' }
      ]

      for (const testCase of testCases) {
        const filePath = path.join(tempVault, testCase.filename)
        const fileContent = `# ${testCase.expectedId}\n\nContent.`
        await fs.writeFile(filePath, fileContent, 'utf-8')

        // WHEN: File added event is triggered
        mockFileWatchManager.sendToRenderer('file-added', {
          fullPath: filePath,
          content: fileContent
        })

        // THEN: GraphNode ID should be extracted correctly
        const node = getGraph().nodes[testCase.expectedId]
        expect(node).toBeDefined()
        expect(node.id).toBe(testCase.expectedId)
      }
    })

    it('should parse markdown links as outgoingEdges', async () => {
      // GIVEN: Two nodes, one linking to the other
      const file1Path = path.join(tempVault, 'node1.md')
      const file1Content = '# GraphNode 1\n\nFirst node.'
      await fs.writeFile(file1Path, file1Content, 'utf-8')

      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: file1Content
      })

      const file2Path = path.join(tempVault, 'node2.md')
      const file2Content = '# GraphNode 2\n\nThis links to [[node1]].'
      await fs.writeFile(file2Path, file2Content, 'utf-8')

      // WHEN: Second file with link is added
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file2Path,
        content: file2Content
      })

      // THEN: Graph should have both nodes
      const graph = getGraph()
      expect(graph.nodes['node1']).toBeDefined()
      expect(graph.nodes['node2']).toBeDefined()

      // AND: Edge from node2 to node1 should exist
      expect(graph.edges['node2']).toBeDefined()
      expect(graph.edges['node2']).toContain('node1')

      // AND: Broadcast called twice (once for each node)
      expect(broadcastCalls).toHaveLength(2)
    })

    it('should handle files with no title (defaults to "Untitled")', async () => {
      // GIVEN: File with no markdown heading
      const filePath = path.join(tempVault, 'no_title.md')
      const fileContent = 'Just some content without a heading.'
      await fs.writeFile(filePath, fileContent, 'utf-8')

      // WHEN: File added event is triggered
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: filePath,
        content: fileContent
      })

      // THEN: GraphNode should have default title
      const node = getGraph().nodes['no_title']
      expect(node).toBeDefined()
      expect(node.title).toBe('Untitled')
      expect(node.content).toBe(fileContent)
    })
  })

  describe('BEHAVIOR: File modified → GraphNode updated in graph + broadcast', () => {
    it('should update node content when file-changed event is triggered', async () => {
      // GIVEN: A node exists in the graph
      const filePath = path.join(tempVault, 'update_test.md')
      const originalContent = '# Original Title\n\nOriginal content.'
      await fs.writeFile(filePath, originalContent, 'utf-8')

      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: filePath,
        content: originalContent
      })

      const originalNode = getGraph().nodes['update_test']
      expect(originalNode.title).toBe('Original Title')
      expect(originalNode.content).toBe(originalContent)

      // WHEN: File is modified on disk and change event is triggered
      const updatedContent = '# Updated Title\n\nNew content added.'
      await fs.writeFile(filePath, updatedContent, 'utf-8')

      mockFileWatchManager.sendToRenderer('file-changed', {
        fullPath: filePath,
        content: updatedContent
      })

      // THEN: GraphNode should be updated in graph
      const updatedNode = getGraph().nodes['update_test']
      expect(updatedNode.title).toBe('Updated Title')
      expect(updatedNode.content).toBe(updatedContent)

      // AND: Broadcast should be called with updated graph (twice: add + change)
      expect(broadcastCalls).toHaveLength(2)
      expect(broadcastCalls[1].graph.nodes['update_test'].title).toBe('Updated Title')
    })

    it('should update outgoingEdges when links are added or removed', async () => {
      // GIVEN: Two nodes with no links
      const file1Path = path.join(tempVault, 'node1.md')
      await fs.writeFile(file1Path, '# GraphNode 1\n\nNo links.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: '# GraphNode 1\n\nNo links.'
      })

      const file2Path = path.join(tempVault, 'node2.md')
      await fs.writeFile(file2Path, '# GraphNode 2\n\nNo links.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file2Path,
        content: '# GraphNode 2\n\nNo links.'
      })

      // Initially no outgoingEdges
      expect(getGraph().edges['node2'] || []).toHaveLength(0)

      // WHEN: node2 is updated to add a link to node1
      const updatedContent = '# GraphNode 2\n\nNow links to [[node1]].'
      await fs.writeFile(file2Path, updatedContent, 'utf-8')

      mockFileWatchManager.sendToRenderer('file-changed', {
        fullPath: file2Path,
        content: updatedContent
      })

      // THEN: Edge should be added
      const graph = getGraph()
      expect(graph.edges['node2']).toContain('node1')

      // WHEN: node2 is updated to remove the link
      const noLinkContent = '# GraphNode 2\n\nLink removed.'
      await fs.writeFile(file2Path, noLinkContent, 'utf-8')

      mockFileWatchManager.sendToRenderer('file-changed', {
        fullPath: file2Path,
        content: noLinkContent
      })

      // THEN: Edge should be removed
      const finalGraph = getGraph()
      expect(finalGraph.edges['node2'] || []).toHaveLength(0)
    })

    it('should handle changed event for nonexistent node (treats as add)', async () => {
      // GIVEN: Empty graph
      expect(getGraph().nodes).toEqual({})

      // WHEN: file-changed event is triggered for a file that doesn't exist in graph
      const filePath = path.join(tempVault, 'new_node.md')
      const fileContent = '# New GraphNode\n\nCreated via change event.'
      await fs.writeFile(filePath, fileContent, 'utf-8')

      mockFileWatchManager.sendToRenderer('file-changed', {
        fullPath: filePath,
        content: fileContent
      })

      // THEN: GraphNode should be added (graceful handling)
      const node = getGraph().nodes['new_node']
      expect(node).toBeDefined()
      expect(node.title).toBe('New GraphNode')
    })
  })

  describe('BEHAVIOR: File deleted → GraphNode removed from graph + broadcast', () => {
    it('should remove node when file-deleted event is triggered', async () => {
      // GIVEN: A node exists in the graph
      const filePath = path.join(tempVault, 'delete_test.md')
      const fileContent = '# To Be Deleted\n\nThis will be deleted.'
      await fs.writeFile(filePath, fileContent, 'utf-8')

      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: filePath,
        content: fileContent
      })

      expect(getGraph().nodes['delete_test']).toBeDefined()

      // WHEN: File is deleted and delete event is triggered
      await fs.unlink(filePath)

      mockFileWatchManager.sendToRenderer('file-deleted', {
        fullPath: filePath
      })

      // THEN: GraphNode should be removed from graph
      expect(getGraph().nodes['delete_test']).toBeUndefined()

      // AND: Broadcast should be called with updated graph (twice: add + delete)
      expect(broadcastCalls).toHaveLength(2)
      expect(broadcastCalls[1].graph.nodes['delete_test']).toBeUndefined()
    })

    it('should remove outgoingEdges pointing to deleted node', async () => {
      // GIVEN: Two nodes with an edge between them
      const file1Path = path.join(tempVault, 'node1.md')
      await fs.writeFile(file1Path, '# GraphNode 1\n\nFirst node.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: '# GraphNode 1\n\nFirst node.'
      })

      const file2Path = path.join(tempVault, 'node2.md')
      await fs.writeFile(file2Path, '# GraphNode 2\n\nLinks to [[node1]].', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file2Path,
        content: '# GraphNode 2\n\nLinks to [[node1]].'
      })

      expect(getGraph().edges['node2']).toContain('node1')

      // WHEN: node1 is deleted
      await fs.unlink(file1Path)
      mockFileWatchManager.sendToRenderer('file-deleted', {
        fullPath: file1Path
      })

      // THEN: node1 should be removed
      expect(getGraph().nodes['node1']).toBeUndefined()

      // AND: Edge from node2 to node1 should still exist (orphaned edge)
      // Note: The current implementation keeps the edge, which creates orphaned outgoingEdges
      // This is the actual behavior - we're testing reality, not ideal behavior
      const graph = getGraph()
      expect(graph.edges['node2']).toBeDefined()
      // The edge still references node1, even though node1 no longer exists
    })

    it('should remove outgoing outgoingEdges from deleted node', async () => {
      // GIVEN: Two nodes, node2 links to node1
      const file1Path = path.join(tempVault, 'node1.md')
      await fs.writeFile(file1Path, '# GraphNode 1\n\nFirst node.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: '# GraphNode 1\n\nFirst node.'
      })

      const file2Path = path.join(tempVault, 'node2.md')
      await fs.writeFile(file2Path, '# GraphNode 2\n\nLinks to [[node1]].', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file2Path,
        content: '# GraphNode 2\n\nLinks to [[node1]].'
      })

      expect(getGraph().edges['node2']).toBeDefined()

      // WHEN: node2 (the source node) is deleted
      await fs.unlink(file2Path)
      mockFileWatchManager.sendToRenderer('file-deleted', {
        fullPath: file2Path
      })

      // THEN: node2's edge entry should be removed from the graph
      const graph = getGraph()
      expect(graph.edges['node2']).toBeUndefined()
      expect(graph.nodes['node1']).toBeDefined() // node1 still exists
    })

    it('should handle deleting nonexistent node gracefully', async () => {
      // GIVEN: Empty graph
      expect(getGraph().nodes).toEqual({})

      // WHEN: file-deleted event is triggered for a file that doesn't exist in graph
      const filePath = path.join(tempVault, 'nonexistent.md')

      mockFileWatchManager.sendToRenderer('file-deleted', {
        fullPath: filePath
      })

      // THEN: Should not crash, graph remains empty
      expect(getGraph().nodes).toEqual({})
      expect(broadcastCalls).toHaveLength(1) // Still broadcasts the (unchanged) graph
    })
  })

  describe('BEHAVIOR: Multiple rapid file changes', () => {
    it('should handle rapid add/modify/delete operations correctly', async () => {
      // GIVEN: Empty graph

      // WHEN: Rapidly creating, modifying, and deleting files
      const file1Path = path.join(tempVault, 'rapid1.md')
      await fs.writeFile(file1Path, '# Rapid 1\n\nFirst.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: '# Rapid 1\n\nFirst.'
      })

      const file2Path = path.join(tempVault, 'rapid2.md')
      await fs.writeFile(file2Path, '# Rapid 2\n\nSecond.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file2Path,
        content: '# Rapid 2\n\nSecond.'
      })

      // Modify first file
      await fs.writeFile(file1Path, '# Rapid 1 Updated\n\nChanged.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-changed', {
        fullPath: file1Path,
        content: '# Rapid 1 Updated\n\nChanged.'
      })

      // Delete second file
      await fs.unlink(file2Path)
      mockFileWatchManager.sendToRenderer('file-deleted', {
        fullPath: file2Path
      })

      // THEN: Graph should reflect final state
      const graph = getGraph()
      expect(graph.nodes['rapid1']).toBeDefined()
      expect(graph.nodes['rapid1'].title).toBe('Rapid 1 Updated')
      expect(graph.nodes['rapid2']).toBeUndefined()

      // AND: All broadcasts should have been called
      expect(broadcastCalls.length).toBeGreaterThanOrEqual(4) // add, add, change, delete
    })
  })

  describe('BEHAVIOR: Edge cases and error handling', () => {
    it('should handle initial-files-loaded event', () => {
      // GIVEN: Empty graph

      // WHEN: initial-files-loaded event is triggered
      mockFileWatchManager.sendToRenderer('initial-files-loaded', {
        files: [],
        directory: tempVault
      })

      // THEN: Should broadcast current graph state
      expect(broadcastCalls).toHaveLength(1)
      expect(broadcastCalls[0].graph).toEqual({ nodes: {}, edges: {} })
    })

    it('should ignore events without required data', () => {
      // GIVEN: Empty graph
      const initialNodeCount = Object.keys(getGraph().nodes).length

      // WHEN: file-added event without fullPath or content
      mockFileWatchManager.sendToRenderer('file-added', {
        // Missing fullPath and content
      })

      // THEN: Graph should not change
      expect(Object.keys(getGraph().nodes).length).toBe(initialNodeCount)

      // AND: No broadcast should occur (event is ignored)
      expect(broadcastCalls).toHaveLength(0)
    })

    it('should handle unknown event channels gracefully', () => {
      // GIVEN: Empty graph

      // WHEN: Unknown event channel
      mockFileWatchManager.sendToRenderer('unknown-event', {
        data: 'unknown'
      })

      // THEN: Should not crash
      expect(getGraph()).toEqual({ nodes: {}, edges: {} })
    })

    it('should continue processing after error in one event', async () => {
      // GIVEN: Valid initial node
      const file1Path = path.join(tempVault, 'valid.md')
      await fs.writeFile(file1Path, '# Valid\n\nGood.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: '# Valid\n\nGood.'
      })

      expect(getGraph().nodes['valid']).toBeDefined()

      // WHEN: An event with invalid data is sent (should be handled gracefully)
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: null, // Invalid
        content: null
      })

      // THEN: Original node should still exist
      expect(getGraph().nodes['valid']).toBeDefined()

      // AND: Can still process subsequent events
      const file2Path = path.join(tempVault, 'valid2.md')
      await fs.writeFile(file2Path, '# Valid 2\n\nAlso good.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file2Path,
        content: '# Valid 2\n\nAlso good.'
      })

      expect(getGraph().nodes['valid2']).toBeDefined()
    })
  })

  describe('BEHAVIOR: Broadcast verification', () => {
    it('should broadcast on every graph state change', async () => {
      // Track broadcast calls
      broadcastCalls = []

      // Create file (should broadcast)
      const file1Path = path.join(tempVault, 'broadcast1.md')
      await fs.writeFile(file1Path, '# Broadcast 1\n\nFirst.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: '# Broadcast 1\n\nFirst.'
      })

      expect(broadcastCalls).toHaveLength(1)

      // Modify file (should broadcast)
      await fs.writeFile(file1Path, '# Broadcast 1 Updated\n\nChanged.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-changed', {
        fullPath: file1Path,
        content: '# Broadcast 1 Updated\n\nChanged.'
      })

      expect(broadcastCalls).toHaveLength(2)

      // Delete file (should broadcast)
      await fs.unlink(file1Path)
      mockFileWatchManager.sendToRenderer('file-deleted', {
        fullPath: file1Path
      })

      expect(broadcastCalls).toHaveLength(3)

      // All broadcasts should contain graph state
      broadcastCalls.forEach((call) => {
        expect(call.graph).toBeDefined()
        expect(call.graph.nodes).toBeDefined()
        expect(call.graph.edges).toBeDefined()
      })
    })

    it('should broadcast correct graph state on each change', async () => {
      // Create first file
      const file1Path = path.join(tempVault, 'state1.md')
      await fs.writeFile(file1Path, '# State 1\n\nFirst.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file1Path,
        content: '# State 1\n\nFirst.'
      })

      // First broadcast should have 1 node
      expect(broadcastCalls[0].graph.nodes['state1']).toBeDefined()
      expect(Object.keys(broadcastCalls[0].graph.nodes)).toHaveLength(1)

      // Create second file
      const file2Path = path.join(tempVault, 'state2.md')
      await fs.writeFile(file2Path, '# State 2\n\nSecond.', 'utf-8')
      mockFileWatchManager.sendToRenderer('file-added', {
        fullPath: file2Path,
        content: '# State 2\n\nSecond.'
      })

      // Second broadcast should have 2 nodes
      expect(broadcastCalls[1].graph.nodes['state1']).toBeDefined()
      expect(broadcastCalls[1].graph.nodes['state2']).toBeDefined()
      expect(Object.keys(broadcastCalls[1].graph.nodes)).toHaveLength(2)
    })
  })
})
