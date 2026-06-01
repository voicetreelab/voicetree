import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import * as O from 'fp-ts/lib/Option.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyGraphDeltaToGraph,
  createEmptyGraph,
  type GraphDelta,
  type GraphNode,
} from '@vt/graph-model/graph'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { SessionRegistry } from '../../../application/session/registry.ts'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { getGraph, setGraph } from '../../../state/graph-store.ts'
import { publish } from '../../../state/events/deltaEventBus.ts'
import { mountSessionEventsRoute } from '../../session-endpoints/sessionEvents.ts'

async function withTempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-sse-test-'))
}

async function createVoicetreeHome(project: string): Promise<string> {
  const voicetreeHome = await mkdtemp(join(tmpdir(), 'graphd-sse-appsupport-'))
  const config = {
    projectConfig: {
      [project]: { writeFolderPath: project },
    },
  }
  await writeFile(join(voicetreeHome, 'voicetree-config.json'), JSON.stringify(config))
  return voicetreeHome
}

function parseSSEGraphEvents(text: string): readonly ProjectedGraph[] {
  const graphs: ProjectedGraph[] = []
  const blocks = text.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    if (!block.includes('event: projectedGraph')) continue
    const dataLine = block.split('\n').find(l => l.startsWith('data:'))
    if (dataLine) {
      const json = dataLine.slice('data:'.length).trim()
      try {
        graphs.push(JSON.parse(json))
      } catch { /* skip malformed */ }
    }
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

async function readProjectedGraph(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 5000,
): Promise<ProjectedGraph> {
  const decoder = new TextDecoder()
  let buffered = ''
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for projectedGraph SSE event')), remainingMs)
    })
    const result = await Promise.race([reader.read(), timeout])

    if (result.done) break
    buffered += decoder.decode(result.value, { stream: true })
    const graphs = parseSSEGraphEvents(buffered)
    if (graphs.length > 0) return graphs[graphs.length - 1]
  }

  throw new Error('Timed out waiting for projectedGraph SSE event')
}

describe('SSE session events', () => {
  let project: string
  let voicetreeHome: string
  let handles: DaemonHandle[]
  let sseController: AbortController | null

  beforeEach(async () => {
    project = await withTempProject()
    voicetreeHome = await createVoicetreeHome(project)
    handles = []
    sseController = null
  })

  afterEach(async () => {
    sseController?.abort()
    await new Promise(r => setTimeout(r, 50))
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(project, { recursive: true, force: true })
    await rm(voicetreeHome, { recursive: true, force: true })
  }, 15000)

  test('emits a ProjectedGraph containing a newly mutated node', async () => {
    const handle = await startDaemon({
      project,
      voicetreeHomePath: voicetreeHome,
      createStarterIfEmpty: false,
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
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream')

    const reader = sseRes.body!.getReader()
    await reader.read()

    const initialNodePath = join(project, 'initial-node.md')
    const mutatedNodePath = join(project, 'sse-projected-node.md')
    const initialDelta: GraphDelta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: makeNode(initialNodePath, '# Initial Node\nSeed content'),
        previousNode: O.none,
      },
    ]
    setGraph(applyGraphDeltaToGraph(createEmptyGraph(), initialDelta))

    const delta: GraphDelta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: makeNode(
          mutatedNodePath,
          '# SSE Projected Graph Node\nSearchable body text',
        ),
        previousNode: O.none,
      },
    ]
    setGraph(applyGraphDeltaToGraph(getGraph(), delta))

    publish({ delta, source: 'test:sessionEvents' })

    const graph = await readProjectedGraph(reader)
    expect(graph.edges).toBeDefined()
    expect(graph.recentNodeIds).toEqual([mutatedNodePath])
    const upsertedNode = graph.nodes.find(n => n.id === mutatedNodePath)
    expect(upsertedNode).toBeDefined()
    expect(upsertedNode).toMatchObject({
      id: mutatedNodePath,
      kind: 'file',
      label: 'sse-projected-node',
      basename: 'sse-projected-node',
      content: '# SSE Projected Graph Node\nSearchable body text',
    })
  }, 20000)

  test('returns 404 for non-existent session', async () => {
    const handle = await startDaemon({
      project,
      voicetreeHomePath: voicetreeHome,
      createStarterIfEmpty: false,
    })
    handles.push(handle)

    const res = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000/events`,
    )
    expect(res.status).toBe(404)
  })

  test('emits keepalive comments while the session event stream is open', async () => {
    vi.useFakeTimers()
    try {
      const app = new Hono()
      const registry = new SessionRegistry()
      const session = registry.create()
      mountSessionEventsRoute(app, registry)

      const res = await app.request(`/sessions/${session.id}/events`)
      expect(res.status).toBe(200)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      const connected = await reader.read()
      expect(decoder.decode(connected.value)).toBe(': connected\n\n')

      let keepalive: ReadableStreamReadResult<Uint8Array> | undefined
      void reader.read().then(result => {
        keepalive = result
      })

      await vi.advanceTimersByTimeAsync(20_000)

      if (!keepalive) {
        throw new Error('Expected SSE keepalive after advancing the interval')
      }
      expect(decoder.decode(keepalive.value)).toBe(': keepalive\n\n')

      await reader.cancel()
    } finally {
      vi.useRealTimers()
    }
  })
})
