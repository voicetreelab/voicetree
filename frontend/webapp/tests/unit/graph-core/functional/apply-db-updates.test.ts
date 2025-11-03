import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/Option'
import { apply_db_updates_to_graph } from '@/graph-core/functional/apply-db-updates'
import { Graph, FSUpdate, GraphNode } from '@/graph-core/functional/types'

describe('apply_db_updates_to_graph', () => {
  // Mock broadcast function for testing
  const mockBroadcast = (_graph: Graph) => {
    // No-op for tests
  }

  // Create the curried function with mock broadcast
  const applyUpdate = apply_db_updates_to_graph(mockBroadcast)

  // Test helper to create a minimal empty graph
  const createEmptyGraph = (): Graph => ({
    nodes: {},
    edges: {}
  })

  // Test helper to create a graph with a single node
  const createGraphWithNode = (nodeId: string): Graph => {
    const node: GraphNode = {
      id: nodeId,
      title: 'Test Node',
      content: '# Test Node\n\nSome content',
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

  describe('Added event', () => {
    it('should accept an Added FSUpdate and return a graph and UIIO effect', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        path: '/test/new-node.md',
        content: '# New Node\n\nContent',
        eventType: 'Added'
      }

      const [updatedGraph, uiEffect] = applyUpdate(graph, update)

      // Verify function signature - returns tuple of [Graph, UIIO]
      expect(updatedGraph).toBeDefined()
      expect(updatedGraph.nodes).toBeDefined()
      expect(updatedGraph.edges).toBeDefined()
      expect(typeof uiEffect).toBe('function')
    })

    it('should return a valid Graph structure for Added event', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        path: '/test/new-node.md',
        content: '# New Node',
        eventType: 'Added'
      }

      const [updatedGraph] = applyUpdate(graph, update)

      // Verify graph structure
      expect(updatedGraph).toHaveProperty('nodes')
      expect(updatedGraph).toHaveProperty('edges')
      expect(typeof updatedGraph.nodes).toBe('object')
      expect(typeof updatedGraph.edges).toBe('object')
    })

    it('should return an executable IO effect for Added event', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        path: '/test/new-node.md',
        content: '# New Node',
        eventType: 'Added'
      }

      const [, uiEffect] = applyUpdate(graph, update)

      // Verify the effect is executable (doesn't throw)
      expect(() => uiEffect()).not.toThrow()
    })
  })

  describe('Changed event', () => {
    it('should accept a Changed FSUpdate and return a graph and UIIO effect', () => {
      const graph = createGraphWithNode('test-node')
      const update: FSUpdate = {
        path: '/test/test-node.md',
        content: '# Updated Node\n\nUpdated content',
        eventType: 'Changed'
      }

      const [updatedGraph, uiEffect] = applyUpdate(graph, update)

      // Verify function signature
      expect(updatedGraph).toBeDefined()
      expect(updatedGraph.nodes).toBeDefined()
      expect(updatedGraph.edges).toBeDefined()
      expect(typeof uiEffect).toBe('function')
    })

    it('should return a valid Graph structure for Changed event', () => {
      const graph = createGraphWithNode('test-node')
      const update: FSUpdate = {
        path: '/test/test-node.md',
        content: '# Updated Node',
        eventType: 'Changed'
      }

      const [updatedGraph] = applyUpdate(graph, update)

      // Verify graph structure
      expect(updatedGraph).toHaveProperty('nodes')
      expect(updatedGraph).toHaveProperty('edges')
      expect(typeof updatedGraph.nodes).toBe('object')
      expect(typeof updatedGraph.edges).toBe('object')
    })

    it('should return an executable IO effect for Changed event', () => {
      const graph = createGraphWithNode('test-node')
      const update: FSUpdate = {
        path: '/test/test-node.md',
        content: '# Updated Node',
        eventType: 'Changed'
      }

      const [, uiEffect] = applyUpdate(graph, update)

      // Verify the effect is executable
      expect(() => uiEffect()).not.toThrow()
    })
  })

  describe('Deleted event', () => {
    it('should accept a Deleted FSUpdate and return a graph and UIIO effect', () => {
      const graph = createGraphWithNode('test-node')
      const update: FSUpdate = {
        path: '/test/test-node.md',
        content: '',
        eventType: 'Deleted'
      }

      const [updatedGraph, uiEffect] = applyUpdate(graph, update)

      // Verify function signature
      expect(updatedGraph).toBeDefined()
      expect(updatedGraph.nodes).toBeDefined()
      expect(updatedGraph.edges).toBeDefined()
      expect(typeof uiEffect).toBe('function')
    })

    it('should return a valid Graph structure for Deleted event', () => {
      const graph = createGraphWithNode('test-node')
      const update: FSUpdate = {
        path: '/test/test-node.md',
        content: '',
        eventType: 'Deleted'
      }

      const [updatedGraph] = applyUpdate(graph, update)

      // Verify graph structure
      expect(updatedGraph).toHaveProperty('nodes')
      expect(updatedGraph).toHaveProperty('edges')
      expect(typeof updatedGraph.nodes).toBe('object')
      expect(typeof updatedGraph.edges).toBe('object')
    })

    it('should return an executable IO effect for Deleted event', () => {
      const graph = createGraphWithNode('test-node')
      const update: FSUpdate = {
        path: '/test/test-node.md',
        content: '',
        eventType: 'Deleted'
      }

      const [, uiEffect] = applyUpdate(graph, update)

      // Verify the effect is executable
      expect(() => uiEffect()).not.toThrow()
    })
  })

  describe('Functional properties', () => {
    it('should be a pure function - same inputs produce same outputs', () => {
      const graph = createEmptyGraph()
      const update: FSUpdate = {
        path: '/test/node.md',
        content: '# Node',
        eventType: 'Added'
      }

      const [graph1, effect1] = applyUpdate(graph, update)
      const [graph2, effect2] = applyUpdate(graph, update)

      // Both calls should produce equivalent graph structures
      expect(graph1.nodes).toEqual(graph2.nodes)
      expect(graph1.edges).toEqual(graph2.edges)
      expect(typeof effect1).toBe(typeof effect2)
    })

    it('should not mutate the input graph', () => {
      const graph = createEmptyGraph()
      const originalNodes = { ...graph.nodes }
      const originalEdges = { ...graph.edges }

      const update: FSUpdate = {
        path: '/test/node.md',
        content: '# Node',
        eventType: 'Added'
      }

      applyUpdate(graph, update)

      // Original graph should be unchanged
      expect(graph.nodes).toEqual(originalNodes)
      expect(graph.edges).toEqual(originalEdges)
    })
  })
})
