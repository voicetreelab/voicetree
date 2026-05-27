import { unlink } from 'node:fs/promises'

import { generateAction } from './actions.ts'
import { fileExists, fetchJson, getGraph, waitFor } from './graphApi.ts'
import { assertInvariants } from './invariants.ts'
import { mulberry32, randInt } from './random.ts'
import type { TrackedState } from './types.ts'

interface LifecycleFuzzInput {
  baseUrl: string
  vault: string
  seed: number
  sequenceCount: number
}

export async function runLifecycleFuzz(input: LifecycleFuzzInput): Promise<void> {
  const topRng = mulberry32(input.seed)

  for (let seq = 0; seq < input.sequenceCount; seq++) {
    const seqSeed = (topRng() * 0xFFFFFFFF) >>> 0
    const seqRng = mulberry32(seqSeed)
    const seqLen = randInt(seqRng, 8, 20)
    const tracked = createTrackedState()

    for (let step = 0; step < seqLen; step++) {
      const action = generateAction(seqRng, input.vault, input.baseUrl, tracked, seq, step)
      const ctx = `seq=${seq} seed=0x${seqSeed.toString(16)} step=${step} action=${action.type}`

      await action.execute()
      await waitForWatcherIfNeeded(input.baseUrl, tracked, action.type)

      if (step % 3 === 0 || step === seqLen - 1) {
        await assertInvariants(input.baseUrl, tracked, ctx)
      }
    }

    await assertInvariants(input.baseUrl, tracked, `seq=${seq} seed=0x${seqSeed.toString(16)} final`)
    await cleanupTrackedState(input.baseUrl, tracked)
  }
}

function createTrackedState(): TrackedState {
  return {
    filesOnDisk: new Map(),
    nodesViaApi: new Map(),
    deletedNodeIds: new Set(),
  }
}

async function waitForWatcherIfNeeded(
  baseUrl: string,
  tracked: TrackedState,
  actionType: string,
): Promise<void> {
  if (actionType === 'createFile') {
    const createdFiles = [...tracked.filesOnDisk.keys()]
    const lastFile = createdFiles[createdFiles.length - 1]
    if (lastFile) {
      await waitFor(async () => {
        const graph = await getGraph(baseUrl)
        return !!graph.nodes[lastFile]
      }).catch(() => {
        // File watcher may need more time on slow CI; invariants catch real failures.
      })
    }
  }

  if (actionType === 'deleteFile') {
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

async function cleanupTrackedState(baseUrl: string, tracked: TrackedState): Promise<void> {
  for (const nodeId of tracked.nodesViaApi.keys()) {
    const graph = await getGraph(baseUrl)
    if (graph.nodes[nodeId]) {
      await fetchJson(
        `${baseUrl}/graph/node/${encodeURIComponent(nodeId)}`,
        { method: 'DELETE' },
      ).catch(() => {})
    }
  }

  for (const filePath of tracked.filesOnDisk.keys()) {
    if (await fileExists(filePath)) {
      await unlink(filePath).catch(() => {})
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 200))
  const postCleanup = await getGraph(baseUrl)
  const remainingApiNodes = [...tracked.nodesViaApi.keys()].filter((id) => postCleanup.nodes[id])

  if (remainingApiNodes.length > 0) {
    for (const id of remainingApiNodes) {
      await fetchJson(`${baseUrl}/graph/node/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
