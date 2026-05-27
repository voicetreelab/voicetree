import { readFile } from 'node:fs/promises'
import { expect } from 'vitest'

import { fileExists, getGraph } from './graphApi.ts'
import type { TrackedState } from './types.ts'

export async function assertInvariants(
  baseUrl: string,
  tracked: TrackedState,
  ctx: string,
): Promise<void> {
  const graph = await getGraph(baseUrl)

  expect(graph, `[${ctx}] I1: GET /graph must return object`).toBeDefined()
  expect(typeof graph.nodes, `[${ctx}] I1: nodes must be an object`).toBe('object')

  for (const [nodeId] of tracked.nodesViaApi) {
    if (graph.nodes[nodeId]) {
      const exists = await fileExists(nodeId)
      expect(exists, `[${ctx}] I2: API node ${nodeId} in graph but missing on disk`).toBe(true)
    }
  }

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

  for (const [nodeId, trackedNode] of tracked.nodesViaApi) {
    if (graph.nodes[nodeId]) {
      const diskContent = await readFile(nodeId, 'utf8')
      expect(
        diskContent,
        `[${ctx}] I4: node ${nodeId} disk content must contain expected body`,
      ).toContain(trackedNode.content.trim())
    }
  }

  for (const [nodeId, trackedNode] of tracked.nodesViaApi) {
    const graphNode = graph.nodes[nodeId]
    if (graphNode && trackedNode.edges.length > 0) {
      const graphEdgeTargets = (graphNode.outgoingEdges || []).map((edge) => edge.targetId)
      for (const expectedTarget of trackedNode.edges) {
        if (graph.nodes[expectedTarget] && !tracked.deletedNodeIds.has(expectedTarget)) {
          expect(
            graphEdgeTargets,
            `[${ctx}] I5: node ${nodeId} should have edge to ${expectedTarget}`,
          ).toContain(expectedTarget)
        }
      }
    }
  }

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
