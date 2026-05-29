import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import { publish } from '../src/state/events/deltaEventBus.ts'
import { type DaemonHandle, startDaemon } from '../src/daemon/server.ts'
import { getGraph, setGraph } from '../src/state/graph-store.ts'

type SequencedProjectedGraph = ProjectedGraph & {
  readonly seq?: number
  readonly replayReset?: {
    readonly reason: 'buffer_evicted'
    readonly requestedSince: number
    readonly oldestSeq: number
    readonly currentSeq: number
  }
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

function parseSSEGraphEvents(text: string): readonly SequencedProjectedGraph[] {
  const graphs: SequencedProjectedGraph[] = []
  for (const block of text.split('\n\n').filter(Boolean)) {
    if (!block.includes('event: projectedGraph')) continue
    const dataLine = block.split('\n').find(line => line.startsWith('data:'))
    if (!dataLine) continue
    graphs.push(JSON.parse(dataLine.slice('data:'.length).trim()))
  }
  return graphs
}

async function readProjectedGraphsUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (graphs: readonly SequencedProjectedGraph[]) => boolean,
  timeoutMs = 5000,
): Promise<readonly SequencedProjectedGraph[]> {
  const decoder = new TextDecoder()
  const graphs: SequencedProjectedGraph[] = []
  let buffered = ''
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for projectedGraph replay')), remainingMs)
    })
    const result = await Promise.race([reader.read(), timeout])

    if (result.done) break
    buffered += decoder.decode(result.value, { stream: true })
    const blocks = buffered.split('\n\n')
    buffered = blocks.pop() ?? ''
    graphs.push(...parseSSEGraphEvents(blocks.join('\n\n') + '\n\n'))
    if (predicate(graphs)) return graphs
  }

  throw new Error('Timed out waiting for projectedGraph replay')
}

function requireSeq(graph: SequencedProjectedGraph): number {
  if (typeof graph.seq !== 'number') {
    throw new Error('Expected projectedGraph SSE payload to include numeric seq')
  }
  return graph.seq
}

async function createAppSupport(vault: string): Promise<string> {
  const appSupport = await mkdtemp(join(tmpdir(), 'graphd-sse-replay-appsupport-'))
  await writeFile(
    join(appSupport, 'voicetree-config.json'),
    JSON.stringify({ vaultConfig: { [vault]: { writeFolderPath: vault } } }),
  )
  return appSupport
}

describe('SSE replay buffer', () => {
  let vault: string
  let appSupport: string
  let handle: DaemonHandle | null
  let controllers: AbortController[]

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'graphd-sse-replay-vault-'))
    appSupport = await createAppSupport(vault)
    handle = null
    controllers = []
    setGraph(createEmptyGraph())
  })

  afterEach(async () => {
    for (const controller of controllers) controller.abort()
    await new Promise(resolve => setTimeout(resolve, 50))
    if (handle) await handle.stop().catch(() => {})
    await rm(vault, { recursive: true, force: true })
    await rm(appSupport, { recursive: true, force: true })
    setGraph(createEmptyGraph())
  }, 15_000)

  async function createSession(base: string): Promise<string> {
    const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
    expect(createRes.status).toBe(201)
    return SessionCreateResponseSchema.parse(await createRes.json()).sessionId
  }

  async function connect(base: string, sessionId: string, since: number) {
    const controller = new AbortController()
    controllers.push(controller)
    const res = await fetch(`${base}/sessions/${sessionId}/events?since=${since}`, {
      signal: controller.signal,
    })
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    await reader.read()
    return { controller, reader }
  }

  function publishNode(filename: string, content: string): string {
    const nodeId = join(vault, filename)
    const delta: GraphDelta = [{
      type: 'UpsertNode',
      nodeToUpsert: makeNode(nodeId, content),
      previousNode: O.none,
    }]
    setGraph(applyGraphDeltaToGraph(getGraph(), delta))
    publish({ delta, source: 'test:sse-replay-buffer' })
    return nodeId
  }

  test('publish before subscribe: subscriber connects with since=0 and receives the missed delta on replay', async () => {
    handle = await startDaemon({ vault, voicetreeHomePath: appSupport, createStarterIfEmpty: false })
    const base = `http://127.0.0.1:${handle.port}`
    const sessionId = await createSession(base)

    const nodeId = publishNode('before-subscribe.md', '# Before Subscribe')

    const { reader } = await connect(base, sessionId, 0)
    const graphs = await readProjectedGraphsUntil(
      reader,
      received => received.some(graph => graph.recentNodeIds.includes(nodeId)),
    )

    const replayed = graphs.find(graph => graph.recentNodeIds.includes(nodeId))
    expect(replayed).toBeDefined()
    expect(requireSeq(replayed!)).toBeGreaterThan(0)
    expect(replayed!.nodes.some(node => node.id === nodeId)).toBe(true)
  }, 20_000)

  test('reconnect with last seen seq receives only deltas missed while disconnected', async () => {
    handle = await startDaemon({ vault, voicetreeHomePath: appSupport, createStarterIfEmpty: false })
    const base = `http://127.0.0.1:${handle.port}`
    const sessionId = await createSession(base)

    const firstConnection = await connect(base, sessionId, 0)
    const firstNodeId = publishNode('first-live.md', '# First Live')
    const firstGraphs = await readProjectedGraphsUntil(
      firstConnection.reader,
      received => received.some(graph => graph.recentNodeIds.includes(firstNodeId)),
    )
    const lastSeenSeq = requireSeq(firstGraphs[firstGraphs.length - 1])
    firstConnection.controller.abort()
    await new Promise(resolve => setTimeout(resolve, 50))

    const missedNodeA = publishNode('missed-a.md', '# Missed A')
    const missedNodeB = publishNode('missed-b.md', '# Missed B')

    const { reader } = await connect(base, sessionId, lastSeenSeq)
    const replayed = await readProjectedGraphsUntil(
      reader,
      received =>
        received.some(graph => graph.recentNodeIds.includes(missedNodeA)) &&
        received.some(graph => graph.recentNodeIds.includes(missedNodeB)),
    )

    const replayedRecentNodeIds = replayed.flatMap(graph => graph.recentNodeIds)
    expect(replayedRecentNodeIds).not.toContain(firstNodeId)
    expect(replayedRecentNodeIds).toEqual([missedNodeA, missedNodeB])
    expect(replayed.map(requireSeq)).toEqual([...replayed.map(requireSeq)].sort((a, b) => a - b))
  }, 20_000)

  test('ring buffer cap: subscriber with stale since receives a full snapshot reset sentinel', async () => {
    handle = await startDaemon({ vault, voicetreeHomePath: appSupport, createStarterIfEmpty: false })
    const base = `http://127.0.0.1:${handle.port}`
    const sessionId = await createSession(base)

    const latestNodeId = Array.from({ length: 1001 }, (_, index) =>
      publishNode(`overflow-${index}.md`, `# Overflow ${index}`),
    ).at(-1)!

    const { reader } = await connect(base, sessionId, 0)
    const graphs = await readProjectedGraphsUntil(
      reader,
      received => received.some(graph => graph.replayReset?.reason === 'buffer_evicted'),
    )
    const resetGraph = graphs.find(graph => graph.replayReset?.reason === 'buffer_evicted')

    expect(resetGraph).toBeDefined()
    expect(resetGraph!.recentNodeIds).toEqual([])
    expect(requireSeq(resetGraph!)).toBeGreaterThan(0)
    expect(resetGraph!.replayReset).toMatchObject({
      reason: 'buffer_evicted',
      requestedSince: 0,
    })
    expect(resetGraph!.nodes.some(node => node.id === latestNodeId)).toBe(true)
  }, 30_000)
})
