// BF-335 · SSE graph-delta projection must not rescan the filesystem per
// delta. A burst of `publish(...)` events should arrive at the subscriber as
// one coalesced projectedGraph SSE event without invoking the folder-tree scanner.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AbsolutePath, DirectoryEntry } from '@vt/graph-model/folders'
import {
  applyGraphDeltaToGraph,
  createEmptyGraph,
  type GraphDelta,
  type GraphNode,
} from '@vt/graph-model/graph'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { getGraph, setGraph } from '../../../state/graph-store.ts'
import { publish } from '../../../state/events/deltaEventBus.ts'

type CountingScanner = {
  readonly fn: (root: AbsolutePath, maxDepth: number) => Promise<DirectoryEntry | null>
  callCount(): number
}

function createCountingScanner(): CountingScanner {
  let count = 0
  return {
    callCount: () => count,
    async fn(root: AbsolutePath): Promise<DirectoryEntry | null> {
      count += 1
      return {
        absolutePath: root,
        name: root.replace(/.*\//, '') || root,
        isDirectory: true,
        children: [],
      }
    },
  }
}

async function withTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-sse-norescan-test-'))
}

async function createAppSupport(vault: string): Promise<string> {
  const appSupport = await mkdtemp(join(tmpdir(), 'graphd-sse-norescan-appsupport-'))
  const config = {
    vaultConfig: {
      [vault]: { writeFolder: vault },
    },
  }
  await writeFile(join(appSupport, 'voicetree-config.json'), JSON.stringify(config))
  return appSupport
}

function parseSSEGraphEvents(text: string): readonly ProjectedGraph[] {
  const graphs: ProjectedGraph[] = []
  for (const block of text.split('\n\n').filter(Boolean)) {
    if (!block.includes('event: projectedGraph')) continue
    const dataLine = block.split('\n').find(l => l.startsWith('data:'))
    if (!dataLine) continue
    try {
      graphs.push(JSON.parse(dataLine.slice('data:'.length).trim()))
    } catch { /* skip */ }
  }
  return graphs
}

function makeNode(id: string, content: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

async function readUntilNGraphs(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
  timeoutMs = 6000,
): Promise<readonly ProjectedGraph[]> {
  const decoder = new TextDecoder()
  let buffered = ''
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${n} projectedGraph events`)), remaining)
    })
    const result = await Promise.race([reader.read(), timeout])
    if (result.done) break
    buffered += decoder.decode(result.value, { stream: true })
    const graphs = parseSSEGraphEvents(buffered)
    if (graphs.length >= n) return graphs
  }
  throw new Error(`Timed out waiting for ${n} projectedGraph events`)
}

describe('SSE delta projection does not rescan the filesystem', () => {
  let vault: string
  let appSupport: string
  let handles: DaemonHandle[]
  let sseController: AbortController | null

  beforeEach(async () => {
    vault = await withTempVault()
    appSupport = await createAppSupport(vault)
    handles = []
    sseController = null
  })

  afterEach(async () => {
    sseController?.abort()
    await new Promise(r => setTimeout(r, 50))
    for (const h of handles) await h.stop().catch(() => {})
    await rm(vault, { recursive: true, force: true })
    await rm(appSupport, { recursive: true, force: true })
  }, 15000)

  test('three graph deltas emit one coalesced projection without any folder-tree scan', async () => {
    const scanner = createCountingScanner()
    const handle = await startDaemon({
      vault,
      appSupportPath: appSupport,
      createStarterIfEmpty: false,
      folderTreeScanner: scanner.fn,
    })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`

    const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
    expect(createRes.status).toBe(201)
    const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

    sseController = new AbortController()
    const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, {
      signal: sseController.signal,
    })
    expect(sseRes.status).toBe(200)

    const reader = sseRes.body!.getReader()
    await reader.read()

    const countAtStart = scanner.callCount()

    setGraph(createEmptyGraph())
    for (let i = 0; i < 3; i++) {
      const nodePath = join(vault, `delta-${i}.md`)
      const delta: GraphDelta = [
        {
          type: 'UpsertNode',
          nodeToUpsert: makeNode(nodePath, `# delta ${i}`),
          previousNode: O.none,
        },
      ]
      setGraph(applyGraphDeltaToGraph(getGraph(), delta))
      publish({ delta, source: 'test:sseNoRescan' })
    }

    const graphs = await readUntilNGraphs(reader, 1)
    expect(graphs.at(-1)?.recentNodeIds).toEqual([
      join(vault, 'delta-0.md'),
      join(vault, 'delta-1.md'),
      join(vault, 'delta-2.md'),
    ])

    // SSE delta projection must use graph-derived projection (pure, no fs).
    // The scanner must not have been called for any of the three deltas.
    expect(scanner.callCount()).toBe(countAtStart)
  }, 20000)
})
