/**
 * Example usage of the functional graph loader in the main process
 *
 * This demonstrates how to use loadGraphFromDisk following the IO monad pattern.
 */

import { loadGraphFromDisk } from './load-graph-from-disk.ts'
import type { Graph } from '@/functional_graph/pure/types'

/**
 * Example 1: Basic usage in main process
 */
async function exampleBasicUsage() {
  const vaultPath = '/path/to/vault'

  // Create the IO effect (pure - no side effects yet)
  const loadGraph = loadGraphFromDisk(vaultPath)

  // Execute the IO effect (triggers file I/O)
  const graph: Graph = await loadGraph()

  console.log(`Loaded ${Object.keys(graph.nodes).length} nodes`)
  console.log(`Built ${Object.keys(graph.edges).length} edge lists`)

  return graph
}

/**
 * Example 2: Usage with global state (Phase 1 pattern)
 *
 * In Phase 1, we maintain a single mutable reference to the current graph state.
 * This is the ONLY mutation point in the entire system.
 */
async function exampleWithGlobalState() {
  const vaultPath = '/path/to/vault'

  // Global state - the ONLY mutable variable in the system
  const currentGraph: Graph = await loadGraphFromDisk(vaultPath)()

  console.log('Initial graph loaded:', Object.keys(currentGraph.nodes).length, 'nodes')

  // Later, when we want to update the graph (Phase 2+):
  // currentGraph = applyAction(currentGraph, someAction)
  // broadcastToRenderer(currentGraph)

  return currentGraph
}

/**
 * Example 3: Reloading the graph
 */
async function exampleReload() {
  const vaultPath = '/path/to/vault'

  // Load initial graph
  // eslint-disable-next-line functional/no-let
  let currentGraph: Graph = await loadGraphFromDisk(vaultPath)()

  // Later, reload from disk (e.g., after external changes)
  currentGraph = await loadGraphFromDisk(vaultPath)()

  console.log('Graph reloaded:', Object.keys(currentGraph.nodes).length, 'nodes')

  return currentGraph
}

/**
 * Example 4: Error handling
 */
async function exampleWithErrorHandling() {
  const vaultPath = '/path/to/vault'

  try {
    const graph = await loadGraphFromDisk(vaultPath)()
    console.log('Successfully loaded graph')
    return graph
  } catch (error) {
    console.error('Failed to load graph:', error)
    // Return empty graph as fallback
    return { nodes: {}, edges: {} }
  }
}

// Export examples for reference
export { exampleBasicUsage, exampleWithGlobalState, exampleReload, exampleWithErrorHandling }
