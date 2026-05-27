import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'

import { fileExists, fetchJson, getGraph } from './graphApi.ts'
import { pick, randInt } from './random.ts'
import type { ActionType, FuzzAction, TrackedState } from './types.ts'

export function generateAction(
  rng: () => number,
  vault: string,
  baseUrl: string,
  tracked: TrackedState,
  seqId: number,
  stepId: number,
): FuzzAction {
  const candidates: ActionType[] = ['createFile', 'upsertNodeDelta', 'upsertNodeWithEdges', 'getGraph']

  if (tracked.filesOnDisk.size > 0) candidates.push('deleteFile')
  if (tracked.nodesViaApi.size > 0) {
    candidates.push('deleteNodeDelta')
    candidates.push('deleteNodeEndpoint')
    candidates.push('updateExistingNode')
  }

  const actionType = pick(rng, candidates)

  switch (actionType) {
    case 'createFile':
      return createFileAction(vault, tracked, seqId, stepId)
    case 'deleteFile':
      return deleteFileAction(rng, tracked)
    case 'upsertNodeDelta':
      return upsertNodeDeltaAction(vault, baseUrl, tracked, seqId, stepId)
    case 'upsertNodeWithEdges':
      return upsertNodeWithEdgesAction(rng, vault, baseUrl, tracked, seqId, stepId)
    case 'updateExistingNode':
      return updateExistingNodeAction(rng, baseUrl, tracked, seqId, stepId)
    case 'deleteNodeDelta':
      return deleteNodeDeltaAction(rng, baseUrl, tracked)
    case 'deleteNodeEndpoint':
      return deleteNodeEndpointAction(rng, baseUrl, tracked)
    case 'getGraph':
      return readGraphAction(baseUrl)
  }
}

function createFileAction(
  vault: string,
  tracked: TrackedState,
  seqId: number,
  stepId: number,
): FuzzAction {
  const fileName = `fuzz-${seqId}-${stepId}.md`
  const filePath = path.join(vault, fileName)
  const content = `# Fuzz ${seqId}-${stepId}\n\nContent seed=${seqId * 1000 + stepId}.\n`
  const fileContent = `---\n---\n${content}`

  return {
    type: 'createFile',
    execute: async () => {
      await writeFile(filePath, fileContent, 'utf8')
      tracked.filesOnDisk.set(filePath, content)
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

function upsertNodeDeltaAction(
  vault: string,
  baseUrl: string,
  tracked: TrackedState,
  seqId: number,
  stepId: number,
): FuzzAction {
  const nodePath = path.join(vault, `fuzz-api-${seqId}-${stepId}.md`)
  const content = `# API Node ${seqId}-${stepId}\n`

  return {
    type: 'upsertNodeDelta',
    execute: async () => {
      const delta = [
        {
          type: 'UpsertNode',
          nodeToUpsert: {
            kind: 'leaf',
            absoluteFilePathIsID: nodePath,
            outgoingEdges: [],
            contentWithoutYamlOrLinks: content,
            nodeUIMetadata: {
              color: { _tag: 'None' },
              position: { _tag: 'None' },
              additionalYAMLProps: {},
            },
          },
          previousNode: { _tag: 'None' },
        },
      ]
      const { status } = await fetchJson(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delta),
      })
      expect(status).toBe(200)
      tracked.nodesViaApi.set(nodePath, { id: nodePath, content, edges: [] })
    },
  }
}

function upsertNodeWithEdgesAction(
  rng: () => number,
  vault: string,
  baseUrl: string,
  tracked: TrackedState,
  seqId: number,
  stepId: number,
): FuzzAction {
  const nodePath = path.join(vault, `fuzz-edge-${seqId}-${stepId}.md`)
  const content = `# Edge Node ${seqId}-${stepId}\n`
  const existingIds = [...tracked.nodesViaApi.keys()]
  const edgeCount = existingIds.length > 0 ? randInt(rng, 1, Math.min(3, existingIds.length)) : 0
  const targets: string[] = []
  for (let i = 0; i < edgeCount; i++) {
    targets.push(pick(rng, existingIds))
  }
  const uniqueTargets = [...new Set(targets)]

  return {
    type: 'upsertNodeWithEdges',
    execute: async () => {
      const delta = [
        {
          type: 'UpsertNode',
          nodeToUpsert: {
            kind: 'leaf',
            absoluteFilePathIsID: nodePath,
            outgoingEdges: uniqueTargets.map((targetId) => ({ targetId, edgeLabel: '' })),
            contentWithoutYamlOrLinks: content,
            nodeUIMetadata: {
              color: { _tag: 'None' },
              position: { _tag: 'None' },
              additionalYAMLProps: {},
            },
          },
          previousNode: { _tag: 'None' },
        },
      ]
      const { status } = await fetchJson(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delta),
      })
      expect(status).toBe(200)
      tracked.nodesViaApi.set(nodePath, { id: nodePath, content, edges: uniqueTargets })
    },
  }
}

function updateExistingNodeAction(
  rng: () => number,
  baseUrl: string,
  tracked: TrackedState,
  seqId: number,
  stepId: number,
): FuzzAction {
  const nodeId = pick(rng, [...tracked.nodesViaApi.keys()])
  const newContent = `# Updated ${seqId}-${stepId}\n`
  const existingIds = [...tracked.nodesViaApi.keys()].filter((id) => id !== nodeId)
  const newEdgeCount = existingIds.length > 0 ? randInt(rng, 0, Math.min(2, existingIds.length)) : 0
  const newEdges: string[] = []
  for (let i = 0; i < newEdgeCount; i++) {
    newEdges.push(pick(rng, existingIds))
  }
  const uniqueEdges = [...new Set(newEdges)]

  return {
    type: 'updateExistingNode',
    execute: async () => {
      const graph = await getGraph(baseUrl)
      if (!graph.nodes[nodeId]) {
        tracked.nodesViaApi.delete(nodeId)
        return
      }
      const delta = [
        {
          type: 'UpsertNode',
          nodeToUpsert: {
            kind: 'leaf',
            absoluteFilePathIsID: nodeId,
            outgoingEdges: uniqueEdges.map((targetId) => ({ targetId, edgeLabel: '' })),
            contentWithoutYamlOrLinks: newContent,
            nodeUIMetadata: {
              color: { _tag: 'None' },
              position: { _tag: 'None' },
              additionalYAMLProps: {},
            },
          },
          previousNode: { _tag: 'Some', value: graph.nodes[nodeId] },
        },
      ]
      const { status } = await fetchJson(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delta),
      })
      expect(status).toBe(200)
      tracked.nodesViaApi.set(nodeId, { id: nodeId, content: newContent, edges: uniqueEdges })
    },
  }
}

function deleteNodeDeltaAction(
  rng: () => number,
  baseUrl: string,
  tracked: TrackedState,
): FuzzAction {
  const nodeId = pick(rng, [...tracked.nodesViaApi.keys()])

  return {
    type: 'deleteNodeDelta',
    execute: async () => {
      const graph = await getGraph(baseUrl)
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
      const { status } = await fetchJson(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delta),
      })
      expect(status).toBe(200)
      tracked.nodesViaApi.delete(nodeId)
      tracked.deletedNodeIds.add(nodeId)
    },
  }
}

function deleteNodeEndpointAction(
  rng: () => number,
  baseUrl: string,
  tracked: TrackedState,
): FuzzAction {
  const nodeId = pick(rng, [...tracked.nodesViaApi.keys()])

  return {
    type: 'deleteNodeEndpoint',
    execute: async () => {
      const graph = await getGraph(baseUrl)
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

function readGraphAction(baseUrl: string): FuzzAction {
  return {
    type: 'getGraph',
    execute: async () => {
      const graph = await getGraph(baseUrl)
      expect(graph).toBeDefined()
      expect(graph.nodes).toBeDefined()
      expect(typeof graph.nodes).toBe('object')
    },
  }
}
