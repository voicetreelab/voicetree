import { afterEach, describe, expect, test, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'

const daemonMock = vi.hoisted(() => ({
  appliedDeltaLengths: [] as number[],
  client: {
    baseUrl: 'http://daemon.test:4321',
    createSession: async () => ({ sessionId: 'renderer-session-1' }),
    applyGraphDelta: async (delta: readonly unknown[]) => {
      daemonMock.appliedDeltaLengths.push(delta.length)
      return { ok: true }
    },
  },
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon', () => ({
  callDaemon: async <T>(fn: (client: typeof daemonMock.client) => Promise<T>): Promise<T> => {
    return await fn(daemonMock.client)
  },
}))

vi.mock('@/shell/edge/main/runtime/state/app-electron-state', () => ({
  getMainWindow: () => null,
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription', () => ({
  subscribeToDaemonSSE: () => undefined,
}))

import {
  applyGraphDeltaToGraph,
  createEmptyGraph,
  initGraphModel,
  type Graph,
  type GraphDelta,
  type GraphNode,
  type NodeIdAndFilePath,
} from '@vt/graph-model'
import {
  postDeltaThroughDaemonWithEditors,
} from '@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy'

function makeNode(
  id: NodeIdAndFilePath,
  content: string,
  position: { readonly x: number; readonly y: number } | null = null,
): GraphNode {
  return {
    kind: 'leaf',
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: position ? O.some(position) : O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

type Scenario = {
  readonly deltas: readonly GraphDelta[]
  readonly expectedGraph: Graph
  readonly coveredKinds: ReadonlySet<string>
}

function nextSeed(seed: number): number {
  return (seed * 1_664_525 + 1_013_904_223) >>> 0
}

function pick(seed: number, modulo: number): number {
  return seed % modulo
}

function buildScenario(seedInput: number, randomSteps: number): Scenario {
  let seed = seedInput
  let graph: Graph = createEmptyGraph()
  const deltas: GraphDelta[] = []
  const coveredKinds: Set<string> = new Set()

  function append(kind: string, delta: GraphDelta): void {
    coveredKinds.add(kind)
    deltas.push(delta)
    graph = applyGraphDeltaToGraph(graph, delta)
  }

  const first = makeNode('/project/a.md', 'create-a')
  append('create', [{ type: 'UpsertNode', nodeToUpsert: first, previousNode: O.none }])

  const updatedFirst = makeNode('/project/a.md', 'update-a')
  append('update', [{ type: 'UpsertNode', nodeToUpsert: updatedFirst, previousNode: O.some(first) }])

  const movedFirst = makeNode('/project/moved-a.md', 'move-a', { x: 10, y: 20 })
  append('move', [
    { type: 'DeleteNode', nodeId: first.absoluteFilePathIsID, deletedNode: O.some(updatedFirst) },
    { type: 'UpsertNode', nodeToUpsert: movedFirst, previousNode: O.some(updatedFirst) },
  ])

  append('delete', [
    { type: 'DeleteNode', nodeId: movedFirst.absoluteFilePathIsID, deletedNode: O.some(movedFirst) },
  ])

  for (let index = 0; index < randomSteps; index += 1) {
    seed = nextSeed(seed)
    const nodeId: NodeIdAndFilePath = `/project/random-${pick(seed, 5)}.md`
    const existing = graph.nodes[nodeId]
    const nextNode = makeNode(nodeId, `seed-${seed}-step-${index}`, {
      x: pick(seed, 100),
      y: pick(seed >>> 8, 100),
    })

    if (!existing || pick(seed, 4) < 2) {
      append(existing ? 'update' : 'create', [{
        type: 'UpsertNode',
        nodeToUpsert: nextNode,
        previousNode: existing ? O.some(existing) : O.none,
      }])
      continue
    }

    if (pick(seed, 4) === 2) {
      append('delete', [{ type: 'DeleteNode', nodeId, deletedNode: O.some(existing) }])
      continue
    }

    const movedId: NodeIdAndFilePath = `/project/random-${pick(seed, 5)}-moved-${index}.md`
    append('move', [
      { type: 'DeleteNode', nodeId, deletedNode: O.some(existing) },
      { type: 'UpsertNode', nodeToUpsert: makeNode(movedId, existing.contentWithoutYamlOrLinks), previousNode: O.some(existing) },
    ])
  }

  return { deltas, expectedGraph: graph, coveredKinds }
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('floating editor delta coalescing', () => {
  afterEach(() => {
    daemonMock.appliedDeltaLengths.splice(0)
    initGraphModel({})
  })

  test('merged microtask callback produces the same floating-editor state as individual callbacks', async () => {
    const scenario = buildScenario(12_345, 24)
    let observedGraph: Graph = createEmptyGraph()
    const callbackDeltas: GraphDelta[] = []

    initGraphModel({
      onFloatingEditorUpdate(delta: GraphDelta): void {
        callbackDeltas.push(delta)
        observedGraph = applyGraphDeltaToGraph(observedGraph, delta)
      },
    })
    const rendererSessionStore = { current: null }

    await Promise.all(
      scenario.deltas.map((delta) => postDeltaThroughDaemonWithEditors(delta, {
        rendererSessionStore,
      })),
    )
    await drainMicrotasks()

    expect(scenario.coveredKinds).toEqual(new Set(['create', 'update', 'move', 'delete']))
    expect(callbackDeltas).toHaveLength(1)
    expect(callbackDeltas[0]!.length).toBe(
      scenario.deltas.reduce((total, delta) => total + delta.length, 0),
    )
    expect(observedGraph).toEqual(scenario.expectedGraph)
    expect(daemonMock.appliedDeltaLengths).toEqual(scenario.deltas.map((delta) => delta.length))
  })
})
