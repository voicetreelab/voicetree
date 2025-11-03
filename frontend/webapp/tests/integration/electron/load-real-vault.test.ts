import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { loadGraphFromDisk } from '../../../src/functional_graph/shell/main/load-graph-from-disk'

describe('loadGraphFromDisk - integration test with real vault', () => {
  // Use the root markdownTreeVault which has actual content
  const vaultPath = path.resolve(__dirname, '../../../../../markdownTreeVault')

  it('should load the real vault successfully', async () => {
    const loadGraph = loadGraphFromDisk(vaultPath)
    const graph = await loadGraph()

    // Verify we loaded some nodes
    const nodeCount = Object.keys(graph.nodes).length
    expect(nodeCount).toBeGreaterThan(0)

    console.log(`Loaded ${nodeCount} nodes from real vault`)

    // Verify each node has required properties
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      expect(node.id).toBe(nodeId)
      expect(node.title).toBeDefined()
      expect(typeof node.title).toBe('string')
      expect(node.content).toBeDefined()
      expect(typeof node.summary).toBe('string')
      expect(node.color).toBeDefined()
    }
  })

  it('should build valid edges from real vault', async () => {
    const loadGraph = loadGraphFromDisk(vaultPath)
    const graph = await loadGraph()

    const edgeCount = Object.keys(graph.edges).length
    expect(edgeCount).toBeGreaterThan(0)

    console.log(`Built ${edgeCount} edge lists from real vault`)

    // Verify all edge targets exist as nodes
    for (const [sourceId, targetIds] of Object.entries(graph.edges)) {
      expect(graph.nodes[sourceId]).toBeDefined()

      for (const targetId of targetIds) {
        expect(graph.nodes[targetId]).toBeDefined()
      }
    }
  })

  it('should have consistent node and edge counts', async () => {
    const loadGraph = loadGraphFromDisk(vaultPath)
    const graph = await loadGraph()

    // Every node should have an edge entry (even if empty array)
    const nodeIds = Object.keys(graph.nodes).sort()
    const edgeIds = Object.keys(graph.edges).sort()

    expect(nodeIds).toEqual(edgeIds)
  })
})
