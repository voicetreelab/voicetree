import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { projectToCytoscape } from '@/functional_graph/pure/cytoscape-deprecated/project-to-cytoscape'
import { Graph, GraphNode } from '@/functional_graph/pure/types'

describe('projectToCytoscape', () => {
  describe('empty graph', () => {
    it('should project empty graph to empty elements', () => {
      const emptyGraph: Graph = {
        nodes: {},
        edges: {}
      }

      const result = projectToCytoscape(emptyGraph)

      expect(result.nodes).toEqual([])
      expect(result.edges).toEqual([])
    })
  })

  describe('graph with nodes', () => {
    it('should project single node correctly', () => {
      const singleNodeGraph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Test GraphNode',
            content: 'Test content',
            summary: 'Test summary',
            color: O.none
          }
        },
        edges: {}
      }

      const result = projectToCytoscape(singleNodeGraph)

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0]).toEqual({
        data: {
          id: 'node1',
          label: 'Test GraphNode',
          content: 'Test content',
          summary: 'Test summary',
          color: undefined
        }
      })
      expect(result.edges).toEqual([])
    })

    it('should project multiple nodes correctly', () => {
      const multiNodeGraph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'First GraphNode',
            content: 'First content',
            summary: 'First summary',
            color: O.some('#FF0000')
          },
          'node2': {
            id: 'node2',
            title: 'Second GraphNode',
            content: 'Second content',
            summary: 'Second summary',
            color: O.none
          }
        },
        edges: {}
      }

      const result = projectToCytoscape(multiNodeGraph)

      expect(result.nodes).toHaveLength(2)
      expect(result.edges).toEqual([])

      // Check both nodes are present (order doesn't matter)
      const nodeIds = result.nodes.map(n => n.data.id)
      expect(nodeIds).toContain('node1')
      expect(nodeIds).toContain('node2')

      const node1 = result.nodes.find(n => n.data.id === 'node1')
      expect(node1?.data.label).toBe('First GraphNode')
      expect(node1?.data.color).toBe('#FF0000')

      const node2 = result.nodes.find(n => n.data.id === 'node2')
      expect(node2?.data.label).toBe('Second GraphNode')
      expect(node2?.data.color).toBeUndefined()
    })
  })

  describe('graph with outgoingEdges', () => {
    it('should project outgoingEdges from adjacency list', () => {
      const graphWithEdges: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Source GraphNode',
            content: 'Source content',
            summary: 'Source summary',
            color: O.none
          },
          'node2': {
            id: 'node2',
            title: 'Target GraphNode',
            content: 'Target content',
            summary: 'Target summary',
            color: O.none
          }
        },
        edges: {
          'node1': ['node2']
        }
      }

      const result = projectToCytoscape(graphWithEdges)

      expect(result.nodes).toHaveLength(2)
      expect(result.edges).toHaveLength(1)
      expect(result.edges[0]).toEqual({
        data: {
          id: 'node1-node2',
          source: 'node1',
          target: 'node2'
        }
      })
    })

    it('should project multiple outgoingEdges from same source', () => {
      const graphWithMultipleEdges: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Source',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          },
          'node2': {
            id: 'node2',
            title: 'Target 1',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          },
          'node3': {
            id: 'node3',
            title: 'Target 2',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          }
        },
        edges: {
          'node1': ['node2', 'node3']
        }
      }

      const result = projectToCytoscape(graphWithMultipleEdges)

      expect(result.nodes).toHaveLength(3)
      expect(result.edges).toHaveLength(2)

      const edgeIds = result.edges.map(e => e.data.id)
      expect(edgeIds).toContain('node1-node2')
      expect(edgeIds).toContain('node1-node3')
    })

    it('should project outgoingEdges from multiple sources', () => {
      const graphWithComplexEdges: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'GraphNode 1',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          },
          'node2': {
            id: 'node2',
            title: 'GraphNode 2',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          },
          'node3': {
            id: 'node3',
            title: 'GraphNode 3',
            content: 'Content',
            summary: 'Summary',
            color: O.none
          }
        },
        edges: {
          'node1': ['node2'],
          'node2': ['node3']
        }
      }

      const result = projectToCytoscape(graphWithComplexEdges)

      expect(result.nodes).toHaveLength(3)
      expect(result.edges).toHaveLength(2)

      const edges = result.edges
      expect(edges.find(e => e.data.source === 'node1' && e.data.target === 'node2')).toBeDefined()
      expect(edges.find(e => e.data.source === 'node2' && e.data.target === 'node3')).toBeDefined()
    })
  })

  describe('idempotency', () => {
    it('should produce identical output when called twice with same input', () => {
      const graph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Test',
            content: 'Content',
            summary: 'Summary',
            color: O.some('#0000FF')
          }
        },
        edges: {
          'node1': []
        }
      }

      const result1 = projectToCytoscape(graph)
      const result2 = projectToCytoscape(graph)

      expect(result1).toEqual(result2)
      expect(result1.nodes).toEqual(result2.nodes)
      expect(result1.edges).toEqual(result2.edges)
    })
  })

  describe('immutability', () => {
    it('should not mutate input graph', () => {
      const originalNodes = {
        'node1': {
          id: 'node1',
          title: 'Original',
          content: 'Original content',
          summary: 'Original summary',
          color: O.none
        }
      }

      const originalEdges = {
        'node1': ['node2']
      }

      const graph: Graph = {
        nodes: { ...originalNodes },
        edges: { ...originalEdges }
      }

      // Create a deep copy to compare
      const graphCopy = JSON.parse(JSON.stringify(graph))

      projectToCytoscape(graph)

      // Input should remain unchanged
      expect(graph.nodes).toEqual(graphCopy.nodes)
      expect(graph.edges).toEqual(graphCopy.edges)
      expect(graph.nodes['node1'].title).toBe('Original')
    })
  })

  describe('integration: complex graph', () => {
    it('should correctly project a complex graph with multiple nodes and outgoingEdges', () => {
      const complexGraph: Graph = {
        nodes: {
          'root': {
            id: 'root',
            title: 'Root GraphNode',
            content: 'Root content',
            summary: 'Root summary',
            color: O.some('#FF0000')
          },
          'child1': {
            id: 'child1',
            title: 'Child 1',
            content: 'Child 1 content',
            summary: 'Child 1 summary',
            color: O.none
          },
          'child2': {
            id: 'child2',
            title: 'Child 2',
            content: 'Child 2 content',
            summary: 'Child 2 summary',
            color: O.some('#00FF00')
          },
          'grandchild': {
            id: 'grandchild',
            title: 'Grandchild',
            content: 'Grandchild content',
            summary: 'Grandchild summary',
            color: O.none
          }
        },
        edges: {
          'root': ['child1', 'child2'],
          'child1': ['grandchild']
        }
      }

      const result = projectToCytoscape(complexGraph)

      // Verify structure
      expect(result.nodes).toHaveLength(4)
      expect(result.edges).toHaveLength(3)

      // Verify all nodes are present
      const nodeIds = result.nodes.map(n => n.data.id)
      expect(nodeIds).toContain('root')
      expect(nodeIds).toContain('child1')
      expect(nodeIds).toContain('child2')
      expect(nodeIds).toContain('grandchild')

      // Verify all outgoingEdges are present
      const edgeConnections = result.edges.map(e => `${e.data.source}-${e.data.target}`)
      expect(edgeConnections).toContain('root-child1')
      expect(edgeConnections).toContain('root-child2')
      expect(edgeConnections).toContain('child1-grandchild')
    })
  })
})
