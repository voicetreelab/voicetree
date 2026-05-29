// Benchmark: measure latency from `publish(delta)` to SSE consumer receiving
// the projected-graph event. This is the variable leg of the spawn-agent race
// (daemon write -> deltaEventBus -> sessionEvents.ts -> hono stream -> consumer).
// Run with:
//   cd packages/systems/graph-db-server
//   npx vitest run tests/sse-roundtrip-bench.test.ts --reporter=verbose
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
import { type DaemonHandle, startDaemon } from '../src/daemon/server.ts'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { getGraph, setGraph } from '../src/state/graph-store.ts'
import { publish } from '../src/state/events/deltaEventBus.ts'

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

function parseSSEGraphEvents(text: string): readonly ProjectedGraph[] {
  const graphs: ProjectedGraph[] = []
  for (const block of text.split('\n\n').filter(Boolean)) {
    if (!block.includes('event: projectedGraph')) continue
    const dataLine = block.split('\n').find(l => l.startsWith('data:'))
    if (!dataLine) continue
    try {
      graphs.push(JSON.parse(dataLine.slice('data:'.length).trim()))
    } catch { /* malformed */ }
  }
  return graphs
}

function pct(arr: readonly number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

describe('SSE round-trip benchmark', () => {
  let vault: string
  let appSupport: string
  let handle: DaemonHandle | null
  let abort: AbortController | null

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'sse-bench-vault-'))
    appSupport = await mkdtemp(join(tmpdir(), 'sse-bench-app-'))
    await writeFile(
      join(appSupport, 'voicetree-config.json'),
      JSON.stringify({ vaultConfig: { [vault]: { writeFolderPath: vault } } }),
    )
    handle = null
    abort = null
  })

  afterEach(async () => {
    abort?.abort()
    await new Promise(r => setTimeout(r, 50))
    if (handle) await handle.stop().catch(() => {})
    await rm(vault, { recursive: true, force: true })
    await rm(appSupport, { recursive: true, force: true })
  }, 15_000)

  test('publish -> SSE consumer latency over 50 iterations', async () => {
    handle = await startDaemon({ vault, voicetreeHomePath: appSupport, createStarterIfEmpty: false })
    const base = `http://127.0.0.1:${handle.port}`

    const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
    const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

    abort = new AbortController()
    const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, { signal: abort.signal })
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()

    // Drain the initial ': connected\n\n' line so we don't bias the first iteration.
    await reader.read()

    // Seed graph so that publishing deltas projects something non-trivial.
    setGraph(applyGraphDeltaToGraph(createEmptyGraph(), [{
      type: 'UpsertNode',
      nodeToUpsert: makeNode(join(vault, 'seed.md'), '# seed'),
      previousNode: O.none,
    }]))

    const N = 50
    const latencies: number[] = []
    let buffered = ''

    for (let i = 0; i < N; i++) {
      const nodeId = join(vault, `bench-${i}.md`)
      const delta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: makeNode(nodeId, `# bench ${i}`),
        previousNode: O.none,
      }]
      setGraph(applyGraphDeltaToGraph(getGraph(), delta))

      const t0 = performance.now()
      publish({ delta, source: 'bench' })

      // Drain SSE until we see a projectedGraph event whose recentNodeIds includes our node.
      let received: ProjectedGraph | null = null
      while (received === null) {
        const result = await reader.read()
        if (result.done) throw new Error('SSE closed mid-bench')
        buffered += decoder.decode(result.value, { stream: true })
        const blocks = buffered.split('\n\n')
        buffered = blocks.pop() ?? ''
        const graphs = parseSSEGraphEvents(blocks.join('\n\n') + '\n\n')
        for (const g of graphs) {
          if (g.recentNodeIds?.includes(nodeId)) {
            received = g
            break
          }
        }
      }
      const t1 = performance.now()
      latencies.push(t1 - t0)
    }

    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const min = Math.min(...latencies)
    const max = Math.max(...latencies)
    const p50 = pct(latencies, 0.5)
    const p95 = pct(latencies, 0.95)
    const p99 = pct(latencies, 0.99)

    // Output a histogram-ish summary
    const buckets = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
    const dist = buckets.map(b => latencies.filter(l => l < b).length)

    /* eslint-disable no-console */
    console.log('\n=== SSE publish→consumer latency (ms) ===')
    console.log(`N=${N}`)
    console.log(`min  ${min.toFixed(1)}`)
    console.log(`p50  ${p50.toFixed(1)}`)
    console.log(`mean ${mean.toFixed(1)}`)
    console.log(`p95  ${p95.toFixed(1)}`)
    console.log(`p99  ${p99.toFixed(1)}`)
    console.log(`max  ${max.toFixed(1)}`)
    console.log('\ncumulative count under threshold:')
    buckets.forEach((b, i) => console.log(`  <${b.toString().padStart(4)}ms : ${dist[i]}/${N}`))
    console.log(`\nraw: ${latencies.map(l => l.toFixed(0)).join(' ')}\n`)
    /* eslint-enable no-console */

    // Don't fail on numbers — this is diagnostic. Just sanity check.
    expect(latencies.length).toBe(N)
  }, 60_000)

  test('cold-start: time-to-first-delta on a freshly connected SSE consumer', async () => {
    handle = await startDaemon({ vault, voicetreeHomePath: appSupport, createStarterIfEmpty: false })
    const base = `http://127.0.0.1:${handle.port}`

    setGraph(applyGraphDeltaToGraph(createEmptyGraph(), [{
      type: 'UpsertNode',
      nodeToUpsert: makeNode(join(vault, 'seed.md'), '# seed'),
      previousNode: O.none,
    }]))

    const N = 20
    const cold: number[] = []

    for (let i = 0; i < N; i++) {
      const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
      const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

      // SIMULATE the production race: fire the publish in the same tick we begin
      // the SSE connect. This mirrors spawnAgentTool firing both paths together.
      const ctrl = new AbortController()
      const nodeId = join(vault, `cold-${i}.md`)
      const delta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: makeNode(nodeId, `# cold ${i}`),
        previousNode: O.none,
      }]
      setGraph(applyGraphDeltaToGraph(getGraph(), delta))

      const t0 = performance.now()
      // Kick the publish AFTER establishing the SSE connection so the consumer is ready.
      // (This is the optimistic case; the pessimistic race is publish-before-connect.)
      const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, { signal: ctrl.signal })
      const reader = sseRes.body!.getReader()
      const decoder = new TextDecoder()
      // Drain ': connected'
      await reader.read()

      publish({ delta, source: 'bench-cold' })

      // Read until we get our delta
      let buffered = ''
      let received: ProjectedGraph | null = null
      while (received === null) {
        const r = await reader.read()
        if (r.done) throw new Error('SSE closed')
        buffered += decoder.decode(r.value, { stream: true })
        const blocks = buffered.split('\n\n')
        buffered = blocks.pop() ?? ''
        for (const g of parseSSEGraphEvents(blocks.join('\n\n') + '\n\n')) {
          if (g.recentNodeIds?.includes(nodeId)) { received = g; break }
        }
      }
      cold.push(performance.now() - t0)
      ctrl.abort()
      await new Promise(r => setTimeout(r, 10))
    }

    const min = Math.min(...cold)
    const max = Math.max(...cold)
    const p50 = pct(cold, 0.5)
    const p95 = pct(cold, 0.95)
    const p99 = pct(cold, 0.99)

    /* eslint-disable no-console */
    console.log('\n=== Cold-start: connect + first delta latency (ms) ===')
    console.log(`N=${N}`)
    console.log(`min  ${min.toFixed(1)}`)
    console.log(`p50  ${p50.toFixed(1)}`)
    console.log(`p95  ${p95.toFixed(1)}`)
    console.log(`p99  ${p99.toFixed(1)}`)
    console.log(`max  ${max.toFixed(1)}`)
    console.log(`raw: ${cold.map(l => l.toFixed(0)).join(' ')}\n`)
    /* eslint-enable no-console */

    expect(cold.length).toBe(N)
  }, 60_000)

  test('publish-before-connect: pessimistic race (delta published while SSE is still connecting)', async () => {
    handle = await startDaemon({ vault, voicetreeHomePath: appSupport, createStarterIfEmpty: false })
    const base = `http://127.0.0.1:${handle.port}`

    setGraph(applyGraphDeltaToGraph(createEmptyGraph(), [{
      type: 'UpsertNode',
      nodeToUpsert: makeNode(join(vault, 'seed.md'), '# seed'),
      previousNode: O.none,
    }]))

    const N = 10
    const results: { lostMessage: boolean, latencyMs: number | null }[] = []

    for (let i = 0; i < N; i++) {
      const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
      const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

      const nodeId = join(vault, `prerace-${i}.md`)
      const delta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: makeNode(nodeId, `# prerace ${i}`),
        previousNode: O.none,
      }]
      setGraph(applyGraphDeltaToGraph(getGraph(), delta))

      // Fire publish IMMEDIATELY then start SSE — simulates renderer firing
      // both the IPC and depending on SSE for the same node.
      const t0 = performance.now()
      publish({ delta, source: 'bench-prerace' })

      const ctrl = new AbortController()
      const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, { signal: ctrl.signal })
      const reader = sseRes.body!.getReader()
      const decoder = new TextDecoder()
      await reader.read() // drain ': connected'

      // Wait up to 2s for the delta to arrive
      let received: ProjectedGraph | null = null
      let buffered = ''
      const deadline = Date.now() + 2000
      try {
        while (received === null && Date.now() < deadline) {
          const remaining = deadline - Date.now()
          const t = new Promise<{ done: true }>(resolve =>
            setTimeout(() => resolve({ done: true } as { done: true }), remaining))
          const r = await Promise.race([reader.read(), t])
          if (r.done) break
          buffered += decoder.decode(r.value, { stream: true })
          const blocks = buffered.split('\n\n')
          buffered = blocks.pop() ?? ''
          for (const g of parseSSEGraphEvents(blocks.join('\n\n') + '\n\n')) {
            if (g.recentNodeIds?.includes(nodeId)) { received = g; break }
          }
        }
      } catch { /* fallthrough */ }

      if (received) {
        results.push({ lostMessage: false, latencyMs: performance.now() - t0 })
      } else {
        results.push({ lostMessage: true, latencyMs: null })
      }
      ctrl.abort()
      await new Promise(r => setTimeout(r, 10))
    }

    const lost = results.filter(r => r.lostMessage).length
    const got = results.filter(r => !r.lostMessage).map(r => r.latencyMs!)

    /* eslint-disable no-console */
    console.log('\n=== Publish-before-connect: did the late subscriber miss the delta? ===')
    console.log(`N=${N}`)
    console.log(`messages lost: ${lost}/${N}`)
    if (got.length > 0) {
      console.log(`for received: min ${Math.min(...got).toFixed(1)}, max ${Math.max(...got).toFixed(1)}, p50 ${pct(got, 0.5).toFixed(1)}`)
    }
    console.log(`raw: ${results.map(r => r.lostMessage ? 'LOST' : `${r.latencyMs!.toFixed(0)}ms`).join(' ')}\n`)
    /* eslint-enable no-console */

    expect(results.length).toBe(N)
  }, 60_000)
})
