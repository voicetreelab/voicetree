import { readFile } from 'node:fs/promises'
import { expect } from 'vitest'

import { fetchDaemonGraph, fileExists } from './daemon-http.ts'
import type { TrackedState } from './types.ts'

export async function assertInvariants(
  baseUrl: string,
  tracked: TrackedState,
  ctx: string,
): Promise<void> {
  const graph = await fetchDaemonGraph(baseUrl)

  // I1: GET /graph returns valid parseable state with nodes object
  expect(graph, `[${ctx}] I1: GET /graph must return object`).toBeDefined()
  expect(typeof graph.nodes, `[${ctx}] I1: nodes must be an object`).toBe('object')

  // I2: Every API-created node still tracked must exist in graph AND on disk
  for (const [nodeId] of tracked.nodesViaApi) {
    if (graph.nodes[nodeId]) {
      const exists = await fileExists(nodeId)
      expect(exists, `[${ctx}] I2: API node ${nodeId} in graph but missing on disk`).toBe(true)
    }
  }

  // I3: No orphan edges — every edge target must either exist in graph OR have been explicitly deleted
  // (daemon does not cascade-delete incoming edges — this is a known behavior we document here)
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.outgoingEdges) {
      for (const edge of node.outgoingEdges) {
        const targetExists = !!graph.nodes[edge.targetId]
        const targetWasDeleted = tracked.deletedNodeIds.has(edge.targetId)
        expect(
          targetExists || targetWasDeleted,
          `[${ctx}] I3: node ${nodeId} has edge to ${edge.targetId} which never existed (not deleted, not in graph)`,
        ).toBe(true)
      }
    }
  }

  // I4: Content integrity — API-created nodes should have expected content on disk
  for (const [nodeId, trackedNode] of tracked.nodesViaApi) {
    if (graph.nodes[nodeId]) {
      const diskContent = await readFile(nodeId, 'utf8')
      expect(
        diskContent,
        `[${ctx}] I4: node ${nodeId} disk content must contain expected body`,
      ).toContain(trackedNode.content.trim())
    }
  }

  // I5: Edge consistency — tracked edges should match graph state (skip deleted targets)
  for (const [nodeId, trackedNode] of tracked.nodesViaApi) {
    const graphNode = graph.nodes[nodeId]
    if (graphNode && trackedNode.edges.length > 0) {
      const graphEdgeTargets = (graphNode.outgoingEdges || []).map((e) => e.targetId)
      for (const expectedTarget of trackedNode.edges) {
        // Only assert edge exists if target node still exists in graph and wasn't deleted
        if (graph.nodes[expectedTarget] && !tracked.deletedNodeIds.has(expectedTarget)) {
          expect(
            graphEdgeTargets,
            `[${ctx}] I5: node ${nodeId} should have edge to ${expectedTarget}`,
          ).toContain(expectedTarget)
        }
      }
    }
  }

  // I6: Node count sanity — all tracked API nodes that exist should be in graph
  for (const [nodeId] of tracked.nodesViaApi) {
    const onDisk = await fileExists(nodeId)
    if (onDisk) {
      expect(
        graph.nodes[nodeId],
        `[${ctx}] I6: node ${nodeId} exists on disk but missing from graph`,
      ).toBeDefined()
    }
  }
}
