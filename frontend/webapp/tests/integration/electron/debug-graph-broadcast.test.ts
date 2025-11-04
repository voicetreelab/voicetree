/**
 * Integration test to debug graph broadcasting
 *
 * This test verifies that:
 * 1. Graph is loaded from disk when watching starts
 * 2. Graph is broadcast to renderer
 * 3. File events trigger graph updates and broadcasts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import type { Graph } from '@/functional_graph/pure/types'
import { setupFileWatchHandlerForTests } from '../../../electron/handlers/file-watch-handler'

// State managed by mocked globals
let currentGraph: Graph = { nodes: {}, edges: {} }
let mockWindow: Pick<BrowserWindow, 'webContents'> | null = null

// Mock ../main module
vi.mock('../../../electron/main', () => ({
  getGraph: () => currentGraph,
  setGraph: (graph: Graph) => {
    currentGraph = graph
  },
  getVaultPath: () => '/test/vault',
  getMainWindow: () => mockWindow
}))

describe('Debug: Graph Broadcasting', () => {
  let broadcastEvents: Array<{ channel: string; data: any }>
  let mockFileWatchManager: any

  beforeEach(() => {
    // Reset state
    broadcastEvents = []
    currentGraph = {
      nodes: {
        'test-node': {
          id: 'test-node',
          title: 'Test Node',
          content: '# Test Node',
          summary: '',
          color: { _tag: 'None' }
        }
      },
      edges: {}
    }

    // Mock BrowserWindow
    mockWindow = {
      webContents: {
        send: (channel: string, data: any) => {
          console.log(`[Mock] Broadcasting: ${channel}`, data)
          broadcastEvents.push({ channel, data })
        }
      } as any
    }

    // Mock FileWatchManager
    mockFileWatchManager = {
      sendToRenderer: vi.fn()
    }
  })

  it('should broadcast graph when initial-files-loaded event is sent', () => {
    // Setup handlers
    setupFileWatchHandlerForTests(
      mockFileWatchManager,
      () => currentGraph,
      (graph: Graph) => { currentGraph = graph },
      mockWindow,
      '/test/vault'
    )

    // Trigger initial-files-loaded event
    mockFileWatchManager.sendToRenderer('initial-files-loaded', {})

    // Verify broadcast was sent
    expect(broadcastEvents.length).toBe(1)
    expect(broadcastEvents[0].channel).toBe('graph:stateChanged')
    expect(broadcastEvents[0].data.nodes['test-node']).toBeDefined()
    expect(broadcastEvents[0].data.nodes['test-node'].title).toBe('Test Node')
  })

  it('should update graph and broadcast when file-added event is sent', () => {
    // Setup handlers
    setupFileWatchHandlerForTests(
      mockFileWatchManager,
      () => currentGraph,
      (graph: Graph) => { currentGraph = graph },
      mockWindow,
      '/test/vault'
    )

    // Trigger file-added event
    mockFileWatchManager.sendToRenderer('file-added', {
      fullPath: '/test/vault/new-note.md',
      content: '# New Note\n\nSome content'
    })

    // Verify graph was updated
    expect(currentGraph.nodes['new-note']).toBeDefined()
    expect(currentGraph.nodes['new-note'].title).toBe('New Note')

    // Verify broadcast was sent
    expect(broadcastEvents.length).toBe(1)
    expect(broadcastEvents[0].channel).toBe('graph:stateChanged')
    expect(broadcastEvents[0].data.nodes['new-note']).toBeDefined()
  })

  it('should update graph with wikilinks and broadcast', () => {
    // Setup handlers
    setupFileWatchHandlerForTests(
      mockFileWatchManager,
      () => currentGraph,
      (graph: Graph) => { currentGraph = graph },
      mockWindow,
      '/test/vault'
    )

    // Add a node with wikilinks
    mockFileWatchManager.sendToRenderer('file-added', {
      fullPath: '/test/vault/linked-note.md',
      content: '# Linked Note\n\nLinks to [[test-node]]'
    })

    // Verify graph has edges
    expect(currentGraph.edges['linked-note']).toBeDefined()
    expect(currentGraph.edges['linked-note']).toContain('test-node')

    // Verify broadcast includes the edge
    expect(broadcastEvents[0].data.edges['linked-note']).toContain('test-node')
  })
})
