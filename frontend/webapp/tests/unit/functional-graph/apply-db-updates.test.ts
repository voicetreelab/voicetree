import { describe, it, expect, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { apply_db_updates_to_graph } from '@/functional_graph/pure/applyFSEventToGraph'
import { Graph, FSUpdate, GraphNode, Env } from '@/functional_graph/pure/types'

describe('apply_db_updates_to_graph', () => {
  // Mock environment for testing
  const mockBroadcast = vi.fn()
  const testEnv: Env = {
    vaultPath: '/tmp/test-vault',
    broadcast: mockBroadcast
  }

  // Test helper to create a minimal empty graph
  const createEmptyGraph = (): Graph => ({
    nodes: {},
    edges: {}
  })

  // Test helper to create a graph with a single node
  const createGraphWithNode = (nodeId: string): Graph => {
    const node: GraphNode = {
      id: nodeId,
      title: 'Test GraphNode',
      content: '# Test GraphNode\n\nSome content',
      summary: 'Test node summary',
      color: O.none
    }

    return {
      nodes: {
        [nodeId]: node
      },
      edges: {
        [nodeId]: []
      }
    }
  }

  beforeEach(() => {
    mockBroadcast.mockClear()
  })

  describe('Added event', () => {
    it('should add a new node to empty graph with correct ID, title, and content', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        absolutePath: '/test/my-note.md',
        content: '# My Note Title\n\nSome content here',
        eventType: 'Added'
      }

      const effect = apply_db_updates_to_graph(graph, update)
      const updatedGraph = effect(testEnv)

      // Verify node was added
      expect(Object.keys(updatedGraph.nodes)).toHaveLength(1)
      expect(updatedGraph.nodes['my-note']).toBeDefined()
      expect(updatedGraph.nodes['my-note'].id).toBe('my-note')
      expect(updatedGraph.nodes['my-note'].title).toBe('My Note Title')
      expect(updatedGraph.nodes['my-note'].content).toBe('# My Note Title\n\nSome content here')
    })

    it('should parse links from content and add them as outgoingEdges', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        absolutePath: '/test/node-a.md',
        content: '# GraphNode A\n\nLinks to [[node-b]] and [[node-c]]',
        eventType: 'Added'
      }

      const effect = apply_db_updates_to_graph(graph, update)
      const updatedGraph = effect(testEnv)

      // Verify outgoingEdges were parsed
      expect(updatedGraph.edges['node-a']).toEqual(['node-b', 'node-c'])
    })

    it('should handle content with no links (empty outgoingEdges array)', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        absolutePath: '/test/node-a.md',
        content: '# GraphNode A\n\nNo links here',
        eventType: 'Added'
      }

      const effect = apply_db_updates_to_graph(graph, update)
      const updatedGraph = effect(testEnv)

      // Verify empty outgoingEdges
      expect(updatedGraph.edges['node-a']).toEqual([])
    })

    it('should add multiple nodes sequentially to the graph', () => {
      const graph = createEmptyGraph()

      const update1: FSUpdate = {
        absolutePath: '/test/node-1.md',
        content: '# GraphNode 1',
        eventType: 'Added'
      }
      const graph1 = apply_db_updates_to_graph(graph, update1)(testEnv)

      const update2: FSUpdate = {
        absolutePath: '/test/node-2.md',
        content: '# GraphNode 2',
        eventType: 'Added'
      }
      const graph2 = apply_db_updates_to_graph(graph1, update2)(testEnv)

      // Both nodes should exist
      expect(Object.keys(graph2.nodes)).toHaveLength(2)
      expect(graph2.nodes['node-1']).toBeDefined()
      expect(graph2.nodes['node-2']).toBeDefined()
    })

    it('should treat duplicate addition as update (node already exists)', () => {
      const existingGraph = createGraphWithNode('existing-node')

      const update: FSUpdate = {
        absolutePath: '/test/existing-node.md',
        content: '# Updated Title\n\nNew content',
        eventType: 'Added'
      }

      const updatedGraph = apply_db_updates_to_graph(existingGraph, update)(testEnv)

      // Should have updated the existing node, not added a duplicate
      expect(Object.keys(updatedGraph.nodes)).toHaveLength(1)
      expect(updatedGraph.nodes['existing-node'].title).toBe('Updated Title')
      expect(updatedGraph.nodes['existing-node'].content).toBe('# Updated Title\n\nNew content')
    })

    it('should preserve relative absolutePath in node ID for nested files', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        absolutePath: '/tmp/test-vault/subfolder/nested-note.md',
        content: '# Nested Note\n\nContent in subfolder',
        eventType: 'Added'
      }

      const effect = apply_db_updates_to_graph(graph, update)
      const updatedGraph = effect(testEnv)

      // Verify node ID includes the relative absolutePath
      expect(updatedGraph.nodes['subfolder/nested-note']).toBeDefined()
      expect(updatedGraph.nodes['subfolder/nested-note'].id).toBe('subfolder/nested-note')
      expect(updatedGraph.nodes['subfolder/nested-note'].title).toBe('Nested Note')
    })

    it('should handle deeply nested paths correctly', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        absolutePath: '/tmp/test-vault/a/b/c/deep.md',
        content: '# Deep Note',
        eventType: 'Added'
      }

      const effect = apply_db_updates_to_graph(graph, update)
      const updatedGraph = effect(testEnv)

      // Verify full relative absolutePath is preserved
      expect(updatedGraph.nodes['a/b/c/deep']).toBeDefined()
      expect(updatedGraph.nodes['a/b/c/deep'].id).toBe('a/b/c/deep')
    })
  })

  describe('Changed event', () => {
    it('should update existing node content and title', () => {
      const graph = createGraphWithNode('my-note')

      const update: FSUpdate = {
        absolutePath: '/test/my-note.md',
        content: '# Updated Title\n\nUpdated content',
        eventType: 'Changed'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // Verify node was updated
      expect(updatedGraph.nodes['my-note'].title).toBe('Updated Title')
      expect(updatedGraph.nodes['my-note'].content).toBe('# Updated Title\n\nUpdated content')
    })

    it('should update outgoingEdges when links in content change', () => {
      const graph: Graph = {
        nodes: {
          'node-a': {
            id: 'node-a',
            title: 'GraphNode A',
            content: '# GraphNode A\n\nLinks to [[node-b]]',
            summary: '',
            color: O.none
          }
        },
        edges: {
          'node-a': ['node-b']
        }
      }

      const update: FSUpdate = {
        absolutePath: '/test/node-a.md',
        content: '# GraphNode A\n\nNow links to [[node-c]] and [[node-d]]',
        eventType: 'Changed'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // Edges should reflect new links
      expect(updatedGraph.edges['node-a']).toEqual(['node-c', 'node-d'])
    })

    it('should preserve other nodes when updating one node', () => {
      const graph: Graph = {
        nodes: {
          'node-a': { id: 'node-a', title: 'A', content: '# A', summary: '', color: O.none },
          'node-b': { id: 'node-b', title: 'B', content: '# B', summary: '', color: O.none }
        },
        edges: {
          'node-a': [],
          'node-b': []
        }
      }

      const update: FSUpdate = {
        absolutePath: '/test/node-a.md',
        content: '# A Updated',
        eventType: 'Changed'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // node-a updated, node-b unchanged
      expect(updatedGraph.nodes['node-a'].title).toBe('A Updated')
      expect(updatedGraph.nodes['node-b'].title).toBe('B')
    })

    it('should treat change of non-existent node as addition', () => {
      const graph = createEmptyGraph()

      const update: FSUpdate = {
        absolutePath: '/test/new-node.md',
        content: '# New GraphNode',
        eventType: 'Changed'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // Should have added the node
      expect(updatedGraph.nodes['new-node']).toBeDefined()
      expect(updatedGraph.nodes['new-node'].title).toBe('New GraphNode')
    })
  })

  describe('Deleted event', () => {
    it('should remove node from graph', () => {
      const graph = createGraphWithNode('node-to-delete')

      const update: FSUpdate = {
        absolutePath: '/test/node-to-delete.md',
        content: '',
        eventType: 'Deleted'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // GraphNode should be removed
      expect(updatedGraph.nodes['node-to-delete']).toBeUndefined()
      expect(Object.keys(updatedGraph.nodes)).toHaveLength(0)
    })

    it('should remove outgoingEdges from the deleted node', () => {
      const graph: Graph = {
        nodes: {
          'node-a': { id: 'node-a', title: 'A', content: '# A', summary: '', color: O.none }
        },
        edges: {
          'node-a': ['node-b', 'node-c']
        }
      }

      const update: FSUpdate = {
        absolutePath: '/test/node-a.md',
        content: '',
        eventType: 'Deleted'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // Edges from deleted node should be removed
      expect(updatedGraph.edges['node-a']).toBeUndefined()
    })

    it('should remove references to deleted node from other nodes outgoingEdges', () => {
      const graph: Graph = {
        nodes: {
          'node-a': { id: 'node-a', title: 'A', content: '# A', summary: '', color: O.none },
          'node-b': { id: 'node-b', title: 'B', content: '# B', summary: '', color: O.none },
          'node-c': { id: 'node-c', title: 'C', content: '# C', summary: '', color: O.none }
        },
        edges: {
          'node-a': ['node-b', 'node-c'],
          'node-b': ['node-a', 'node-c'],
          'node-c': ['node-a']
        }
      }

      const update: FSUpdate = {
        absolutePath: '/test/node-a.md',
        content: '',
        eventType: 'Deleted'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // node-a deleted, all references to it removed from other outgoingEdges
      expect(updatedGraph.nodes['node-a']).toBeUndefined()
      expect(updatedGraph.edges['node-a']).toBeUndefined()
      expect(updatedGraph.edges['node-b']).toEqual(['node-c']) // node-a removed
      expect(updatedGraph.edges['node-c']).toEqual([]) // node-a removed
    })

    it('should preserve other nodes when deleting one node', () => {
      const graph: Graph = {
        nodes: {
          'node-a': { id: 'node-a', title: 'A', content: '# A', summary: '', color: O.none },
          'node-b': { id: 'node-b', title: 'B', content: '# B', summary: '', color: O.none }
        },
        edges: {
          'node-a': [],
          'node-b': []
        }
      }

      const update: FSUpdate = {
        absolutePath: '/test/node-a.md',
        content: '',
        eventType: 'Deleted'
      }

      const updatedGraph = apply_db_updates_to_graph(graph, update)(testEnv)

      // node-b should remain
      expect(updatedGraph.nodes['node-b']).toBeDefined()
      expect(updatedGraph.nodes['node-b'].title).toBe('B')
    })
  })

  describe('Functional properties', () => {
    it('should be a pure function - same inputs produce same outputs', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        absolutePath: '/test/node.md',
        content: '# GraphNode',
        eventType: 'Added'
      }

      const effect = apply_db_updates_to_graph(graph, update)
      const graph1 = effect(testEnv)
      const graph2 = effect(testEnv)

      // Both calls should produce equivalent graph structures
      expect(graph1.nodes).toEqual(graph2.nodes)
      expect(graph1.edges).toEqual(graph2.edges)
    })

    it('should not mutate the input graph', () => {
      const graph = createEmptyGraph()
      const originalNodes = { ...graph.nodes }
      const originalEdges = { ...graph.edges }

      const update: FSUpdate = {
        absolutePath: '/test/node.md',
        content: '# GraphNode',
        eventType: 'Added'
      }

      const effect = apply_db_updates_to_graph(graph, update)
      effect(testEnv)

      // Original graph should be unchanged
      expect(graph.nodes).toEqual(originalNodes)
      expect(graph.edges).toEqual(originalEdges)
    })

    it('should use Reader pattern (environment provided at execution)', () => {
      // Test with different environments
      const broadcast1 = vi.fn()
      const broadcast2 = vi.fn()

      const env1: Env = {
        vaultPath: '/vault1',
        broadcast: broadcast1
      }

      const env2: Env = {
        vaultPath: '/vault2',
        broadcast: broadcast2
      }

      const graph = createEmptyGraph()
      const update: FSUpdate = {
        absolutePath: '/test/node.md',
        content: '# GraphNode',
        eventType: 'Added'
      }

      // Same effect, different environments
      const effect = apply_db_updates_to_graph(graph, update)

      // Execute with different environments
      const graph1 = effect(env1)
      const graph2 = effect(env2)

      // Pure function should NOT call broadcast - graphs should be identical
      expect(broadcast1).not.toHaveBeenCalled()
      expect(broadcast2).not.toHaveBeenCalled()
      expect(graph1.nodes).toEqual(graph2.nodes)
      expect(graph1.edges).toEqual(graph2.edges)
    })
  })
})
