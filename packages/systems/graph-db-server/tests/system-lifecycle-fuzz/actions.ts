import path from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'
import { expect } from 'vitest'

import { pick, randInt } from './prng.ts'
import { fetchDaemonGraph, fetchJson, fileExists } from './daemon-http.ts'
import type { FuzzAction, TrackedState } from './types.ts'

export function generateAction(
  rng: () => number,
  vault: string,
  baseUrl: string,
  tracked: TrackedState,
  seqId: number,
  stepId: number,
): FuzzAction {
  const candidates: FuzzAction['type'][] = ['createFile', 'upsertNodeDelta', 'upsertNodeWithEdges', 'getGraph']

  if (tracked.filesOnDisk.size > 0) candidates.push('deleteFile')
  if (tracked.nodesViaApi.size > 0) {
    candidates.push('deleteNodeDelta')
    candidates.push('deleteNodeEndpoint')
    candidates.push('updateExistingNode')
  }

  const actionType = pick(rng, candidates)

  switch (actionType) {
    case 'createFile': return createFileAction(vault, tracked, seqId, stepId)
    case 'deleteFile': return deleteFileAction(rng, tracked)
    case 'upsertNodeDelta': return upsertNodeDeltaAction(baseUrl, vault, tracked, seqId, stepId)
    case 'upsertNodeWithEdges': return upsertNodeWithEdgesAction(rng, baseUrl, vault, tracked, seqId, stepId)
    case 'updateExistingNode': return updateExistingNodeAction(rng, baseUrl, tracked, seqId, stepId)
    case 'deleteNodeDelta': return deleteNodeDeltaAction(rng, baseUrl, tracked)
    case 'deleteNodeEndpoint': return deleteNodeEndpointAction(rng, baseUrl, tracked)
    case 'getGraph': return getGraphAction(baseUrl)
  }
}

function createFileAction(vault: string, tracked: TrackedState, seqId: number, stepId: number): FuzzAction {
  const fileName = `fuzz-${seqId}-${stepId}.md`
  const filePath = path.join(vault, fileName)
  const content = `# Fuzz ${seqId}-${stepId}\n\nContent seed=${seqId * 1000 + stepId}.\n`
  const fileContent = `---\n---\n${content}`
  return {
    type: 'createFile',
    execute: async () => {
      await writeFile(filePath, fileContent, 'utf8')
      tracked.filesOnDisk.set(filePath, content)
      tracked.testOwnedNodeIds.add(filePath)
    },
  }
}

function deleteFileAction(rng: () => number, tracked: TrackedState): FuzzAction {
  const filePath = pick(rng, [...tracked.filesOnDisk.keys()])
  return {
    type: 'deleteFile',
    execute: async () => {
      if (await fileExists(filePath)) {
        await unlink(filePath)
      }
      tracked.filesOnDisk.delete(filePath)
    },
  }
}

function upsertNodeDeltaAction(baseUrl: string, vault: string, tracked: TrackedState, seqId: number, stepId: number): FuzzAction {
  const nodePath = path.join(vault, `fuzz-api-${seqId}-${stepId}.md`)
  const content = `# API Node ${seqId}-${stepId}\n`
  return {
    type: 'upsertNodeDelta',
    execute: async () => {
      const delta = [
        {
          type: 'UpsertNode',
          nodeToUpsert: leafNode(nodePath, [], content),
          previousNode: { _tag: 'None' },
        },
      ]
      const { status } = await postDelta(baseUrl, delta)
      expect(status).toBe(200)
      tracked.nodesViaApi.set(nodePath, { id: nodePath, content, edges: [] })
      tracked.testOwnedNodeIds.add(nodePath)
    },
  }
}

function upsertNodeWithEdgesAction(rng: () => number, baseUrl: string, vault: string, tracked: TrackedState, seqId: number, stepId: number): FuzzAction {
  const nodePath = path.join(vault, `fuzz-edge-${seqId}-${stepId}.md`)
  const content = `# Edge Node ${seqId}-${stepId}\n`
  const existingIds = [...tracked.nodesViaApi.keys()]
  const edgeCount = existingIds.length > 0 ? randInt(rng, 1, Math.min(3, existingIds.length)) : 0
  const targets: string[] = []
  for (let i = 0; i < edgeCount; i++) targets.push(pick(rng, existingIds))
  const uniqueTargets = [...new Set(targets)]

  return {
    type: 'upsertNodeWithEdges',
    execute: async () => {
      const delta = [
        {
          type: 'UpsertNode',
          nodeToUpsert: leafNode(nodePath, uniqueTargets, content),
          previousNode: { _tag: 'None' },
        },
      ]
      const { status } = await postDelta(baseUrl, delta)
      expect(status).toBe(200)
      tracked.nodesViaApi.set(nodePath, { id: nodePath, content, edges: uniqueTargets })
      tracked.testOwnedNodeIds.add(nodePath)
    },
  }
}

function updateExistingNodeAction(rng: () => number, baseUrl: string, tracked: TrackedState, seqId: number, stepId: number): FuzzAction {
  const nodeId = pick(rng, [...tracked.nodesViaApi.keys()])
  const newContent = `# Updated ${seqId}-${stepId}\n`
  const existingIds = [...tracked.nodesViaApi.keys()].filter((id) => id !== nodeId)
  const newEdgeCount = existingIds.length > 0 ? randInt(rng, 0, Math.min(2, existingIds.length)) : 0
  const newEdges: string[] = []
  for (let i = 0; i < newEdgeCount; i++) newEdges.push(pick(rng, existingIds))
  const uniqueEdges = [...new Set(newEdges)]

  return {
    type: 'updateExistingNode',
    execute: async () => {
      const graph = await fetchDaemonGraph(baseUrl)
      if (!graph.nodes[nodeId]) {
        tracked.nodesViaApi.delete(nodeId)
        return
      }
      const delta = [
        {
          type: 'UpsertNode',
          nodeToUpsert: leafNode(nodeId, uniqueEdges, newContent),
          previousNode: { _tag: 'Some', value: graph.nodes[nodeId] },
        },
      ]
      const { status } = await postDelta(baseUrl, delta)
      expect(status).toBe(200)
      tracked.nodesViaApi.set(nodeId, { id: nodeId, content: newContent, edges: uniqueEdges })
    },
  }
}

function deleteNodeDeltaAction(rng: () => number, baseUrl: string, tracked: TrackedState): FuzzAction {
  const nodeId = pick(rng, [...tracked.nodesViaApi.keys()])
  return {
    type: 'deleteNodeDelta',
    execute: async () => {
      const graph = await fetchDaemonGraph(baseUrl)
      if (!graph.nodes[nodeId]) {
        tracked.nodesViaApi.delete(nodeId)
        return
      }
      const delta = [
        {
          type: 'DeleteNode',
          nodeId,
          deletedNode: { _tag: 'Some', value: graph.nodes[nodeId] },
        },
      ]
      const { status } = await postDelta(baseUrl, delta)
      expect(status).toBe(200)
      tracked.nodesViaApi.delete(nodeId)
      tracked.deletedNodeIds.add(nodeId)
    },
  }
}

function deleteNodeEndpointAction(rng: () => number, baseUrl: string, tracked: TrackedState): FuzzAction {
  const nodeId = pick(rng, [...tracked.nodesViaApi.keys()])
  return {
    type: 'deleteNodeEndpoint',
    execute: async () => {
      const graph = await fetchDaemonGraph(baseUrl)
      if (!graph.nodes[nodeId]) {
        tracked.nodesViaApi.delete(nodeId)
        return
      }
      const { status } = await fetchJson(
        `${baseUrl}/graph/node/${encodeURIComponent(nodeId)}`,
        { method: 'DELETE' },
      )
      expect(status).toBe(200)
      tracked.nodesViaApi.delete(nodeId)
      tracked.deletedNodeIds.add(nodeId)
    },
  }
}

function getGraphAction(baseUrl: string): FuzzAction {
  return {
    type: 'getGraph',
    execute: async () => {
      const graph = await fetchDaemonGraph(baseUrl)
      expect(graph).toBeDefined()
      expect(graph.nodes).toBeDefined()
      expect(typeof graph.nodes).toBe('object')
    },
  }
}

function leafNode(nodePath: string, edgeTargets: readonly string[], content: string) {
  return {
    kind: 'leaf',
    absoluteFilePathIsID: nodePath,
    outgoingEdges: edgeTargets.map((t) => ({ targetId: t, edgeLabel: '' })),
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: { _tag: 'None' },
      position: { _tag: 'None' },
      additionalYAMLProps: {},
    },
  }
}

async function postDelta(baseUrl: string, delta: unknown): Promise<{ status: number; body: unknown }> {
  return fetchJson(`${baseUrl}/graph/delta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(delta),
  })
}
