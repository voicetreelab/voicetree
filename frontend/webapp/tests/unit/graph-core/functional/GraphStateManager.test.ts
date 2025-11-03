import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as O from 'fp-ts/Option'
import { GraphStateManager } from '@/graph-core/functional/GraphStateManager'
import type { Graph } from '@/graph-core/functional/types'
import cytoscape, { Core as CytoscapeCore } from 'cytoscape'

describe('GraphStateManager', () => {
  let cy: CytoscapeCore
  let manager: GraphStateManager

  beforeEach(() => {
    // Create a headless Cytoscape instance for testing
    cy = cytoscape({
      headless: true,
      elements: []
    })

    manager = new GraphStateManager(cy)
  })

  describe('initialization', () => {
    it('should initialize with no graph state', () => {
      const currentGraph = manager.getCurrentGraph()
      expect(currentGraph).toBeNull()
    })

    it('should not crash when electronAPI is not available', () => {
      // In test environment, electronAPI won't be available
      // This should not throw an error
      expect(() => new GraphStateManager(cy)).not.toThrow()
    })
  })

  describe('reconciliation', () => {
    it('should add nodes to empty graph', () => {
      const graph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Test Node',
            content: '# Test',
            summary: 'Summary',
            color: O.none
          }
        },
        edges: {}
      }

      // Use forceRender to manually trigger reconciliation in tests
      // (since we don't have electronAPI events)
      ;(manager as any).currentGraph = graph
      manager.forceRender()

      expect(cy.nodes().length).toBe(1)
      expect(cy.getElementById('node1').data('label')).toBe('Test Node')
      expect(cy.getElementById('node1').data('content')).toBe('# Test')
    })

    it('should add edges between nodes', () => {
      const graph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Source',
            content: '# Source',
            summary: '',
            color: O.none
          },
          'node2': {
            id: 'node2',
            title: 'Target',
            content: '# Target',
            summary: '',
            color: O.none
          }
        },
        edges: {
          'node1': ['node2']
        }
      }

      ;(manager as any).currentGraph = graph
      manager.forceRender()

      expect(cy.nodes().length).toBe(2)
      expect(cy.edges().length).toBe(1)

      const edge = cy.getElementById('node1-node2')
      expect(edge.data('source')).toBe('node1')
      expect(edge.data('target')).toBe('node2')
    })

    it('should remove nodes not in graph', () => {
      // First, add a node manually
      cy.add({
        group: 'nodes',
        data: { id: 'old-node', label: 'Old Node' }
      })

      expect(cy.nodes().length).toBe(1)

      // Now reconcile with a graph that doesn't have this node
      const graph: Graph = {
        nodes: {
          'new-node': {
            id: 'new-node',
            title: 'New Node',
            content: '# New',
            summary: '',
            color: O.none
          }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = graph
      manager.forceRender()

      expect(cy.nodes().length).toBe(1)
      expect(cy.getElementById('old-node').length).toBe(0)
      expect(cy.getElementById('new-node').length).toBe(1)
    })

    it('should remove edges not in graph', () => {
      // Add nodes and edge manually
      cy.add([
        { group: 'nodes', data: { id: 'node1' } },
        { group: 'nodes', data: { id: 'node2' } },
        { group: 'edges', data: { id: 'edge1', source: 'node1', target: 'node2' } }
      ])

      expect(cy.edges().length).toBe(1)

      // Reconcile with graph that has nodes but no edges
      const graph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Node 1',
            content: '# 1',
            summary: '',
            color: O.none
          },
          'node2': {
            id: 'node2',
            title: 'Node 2',
            content: '# 2',
            summary: '',
            color: O.none
          }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = graph
      manager.forceRender()

      expect(cy.nodes().length).toBe(2)
      expect(cy.edges().length).toBe(0)
    })

    it('should preserve ghost root and floating window nodes', () => {
      // Add special nodes that should not be removed
      cy.add([
        { group: 'nodes', data: { id: 'ghost-root', isGhostRoot: true } },
        { group: 'nodes', data: { id: 'window-1', isFloatingWindow: true } }
      ])

      // Reconcile with empty graph
      const graph: Graph = {
        nodes: {},
        edges: {}
      }

      ;(manager as any).currentGraph = graph
      manager.forceRender()

      // Special nodes should still be present
      expect(cy.getElementById('ghost-root').length).toBe(1)
      expect(cy.getElementById('window-1').length).toBe(1)
    })

    it('should update node data when it changes', () => {
      // Add initial node
      const initialGraph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Original Title',
            content: '# Original',
            summary: 'Original summary',
            color: O.none
          }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = initialGraph
      manager.forceRender()

      expect(cy.getElementById('node1').data('label')).toBe('Original Title')

      // Update with new data
      const updatedGraph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Updated Title',
            content: '# Updated',
            summary: 'Updated summary',
            color: O.some('#FF0000')
          }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = updatedGraph
      manager.forceRender()

      expect(cy.getElementById('node1').data('label')).toBe('Updated Title')
      expect(cy.getElementById('node1').data('content')).toBe('# Updated')
      expect(cy.getElementById('node1').data('summary')).toBe('Updated summary')
    })
  })

  describe('idempotency', () => {
    it('should be idempotent - rendering same graph twice has no effect', () => {
      const graph: Graph = {
        nodes: {
          'node1': {
            id: 'node1',
            title: 'Test',
            content: '# Test',
            summary: 'Summary',
            color: O.none
          },
          'node2': {
            id: 'node2',
            title: 'Test 2',
            content: '# Test 2',
            summary: 'Summary 2',
            color: O.some('#0000FF')
          }
        },
        edges: {
          'node1': ['node2']
        }
      }

      ;(manager as any).currentGraph = graph
      manager.forceRender()

      // Capture state after first render
      const nodeCount1 = cy.nodes().length
      const edgeCount1 = cy.edges().length
      const node1Data1 = cy.getElementById('node1').data()

      // Render again with same graph
      manager.forceRender()

      // State should be identical
      const nodeCount2 = cy.nodes().length
      const edgeCount2 = cy.edges().length
      const node1Data2 = cy.getElementById('node1').data()

      expect(nodeCount1).toBe(nodeCount2)
      expect(edgeCount1).toBe(edgeCount2)
      expect(node1Data1).toEqual(node1Data2)
    })

    it('should be idempotent even after multiple renders', () => {
      const graph: Graph = {
        nodes: {
          'a': {
            id: 'a',
            title: 'A',
            content: '# A',
            summary: '',
            color: O.none
          },
          'b': {
            id: 'b',
            title: 'B',
            content: '# B',
            summary: '',
            color: O.none
          }
        },
        edges: {
          'a': ['b']
        }
      }

      ;(manager as any).currentGraph = graph

      // Render 5 times
      for (let i = 0; i < 5; i++) {
        manager.forceRender()
      }

      // Should still have correct state
      expect(cy.nodes().length).toBe(2)
      expect(cy.edges().length).toBe(1)
      expect(cy.getElementById('a').length).toBe(1)
      expect(cy.getElementById('b').length).toBe(1)
    })
  })

  describe('getCurrentGraph', () => {
    it('should return current graph state', () => {
      const graph: Graph = {
        nodes: {
          'test': {
            id: 'test',
            title: 'Test',
            content: '# Test',
            summary: '',
            color: O.none
          }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = graph

      const retrieved = manager.getCurrentGraph()
      expect(retrieved).toEqual(graph)
    })

    it('should return null if no graph loaded', () => {
      const manager = new GraphStateManager(cy)
      expect(manager.getCurrentGraph()).toBeNull()
    })
  })

  describe('complex scenarios', () => {
    it('should handle adding and removing nodes in sequence', () => {
      // Start with 2 nodes
      const graph1: Graph = {
        nodes: {
          'node1': { id: 'node1', title: 'Node 1', content: '# 1', summary: '', color: O.none },
          'node2': { id: 'node2', title: 'Node 2', content: '# 2', summary: '', color: O.none }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = graph1
      manager.forceRender()
      expect(cy.nodes().length).toBe(2)

      // Add a third node
      const graph2: Graph = {
        nodes: {
          'node1': { id: 'node1', title: 'Node 1', content: '# 1', summary: '', color: O.none },
          'node2': { id: 'node2', title: 'Node 2', content: '# 2', summary: '', color: O.none },
          'node3': { id: 'node3', title: 'Node 3', content: '# 3', summary: '', color: O.none }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = graph2
      manager.forceRender()
      expect(cy.nodes().length).toBe(3)

      // Remove first node
      const graph3: Graph = {
        nodes: {
          'node2': { id: 'node2', title: 'Node 2', content: '# 2', summary: '', color: O.none },
          'node3': { id: 'node3', title: 'Node 3', content: '# 3', summary: '', color: O.none }
        },
        edges: {}
      }

      ;(manager as any).currentGraph = graph3
      manager.forceRender()
      expect(cy.nodes().length).toBe(2)
      expect(cy.getElementById('node1').length).toBe(0)
      expect(cy.getElementById('node2').length).toBe(1)
      expect(cy.getElementById('node3').length).toBe(1)
    })

    it('should handle complex graph with multiple edges', () => {
      const graph: Graph = {
        nodes: {
          'root': { id: 'root', title: 'Root', content: '# Root', summary: '', color: O.none },
          'child1': { id: 'child1', title: 'Child 1', content: '# C1', summary: '', color: O.none },
          'child2': { id: 'child2', title: 'Child 2', content: '# C2', summary: '', color: O.none },
          'grandchild': { id: 'grandchild', title: 'Grandchild', content: '# GC', summary: '', color: O.none }
        },
        edges: {
          'root': ['child1', 'child2'],
          'child1': ['grandchild']
        }
      }

      ;(manager as any).currentGraph = graph
      manager.forceRender()

      expect(cy.nodes().length).toBe(4)
      expect(cy.edges().length).toBe(3)

      // Verify specific edges exist
      expect(cy.getElementById('root-child1').length).toBe(1)
      expect(cy.getElementById('root-child2').length).toBe(1)
      expect(cy.getElementById('child1-grandchild').length).toBe(1)
    })
  })
})
