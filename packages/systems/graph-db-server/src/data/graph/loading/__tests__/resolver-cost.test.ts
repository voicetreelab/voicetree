import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { performance } from 'node:perf_hooks'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import normalizePath from 'normalize-path'

import {
  addNodeToGraphWithEdgeHealingFromFSEvent,
  applyGraphDeltaToGraph,
  createEmptyGraph,
  type Graph,
  type GraphDelta,
} from '@vt/graph-model/graph'

import { setGraph } from '@vt/graph-db-server/state/graph-store'
import { setProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { applyGraphDeltaToMemState } from '../../mutations/applyGraphDelta'
import * as findFileByNameModule from '../findFileByName'

/**
 * BF-434 — Red bench pinning the resolver's cost.
 *
 * A graph carrying many *relative* dangling wikilinks (targets that exist on
 * neither disk nor in any loaded node) must not drive the upsert hot path to
 * crawl the monorepo with ripgrep. The cost is observed two ways:
 *
 *  - PRIMARY (IO boundary): the ripgrep helper `findFileByName` — whose sole
 *    job is to spawn an `rg` subprocess — must not be invoked on the upsert
 *    path. We count invocations at that external IO boundary.
 *  - PRIMARY (graph state): the dangling relative targets must NOT be resurrected
 *    into the graph (the resolver must not load same-named files from disk).
 *  - SECONDARY (timing): the upsert must complete well under the old 14–58 s.
 *
 * On `main` this FAILS: the resolver rescans every node and spawns one ripgrep
 * per dangling relative target.
 */

const DANGLING_LINK_COUNT = 320

function addedEvent(absolutePath: string, content: string) {
  return { absolutePath, content, eventType: 'Added' as const }
}

function noteId(root: string, index: number): string {
  return normalizePath(path.join(root, `note-${index}.md`))
}

/** Build an in-memory graph of N nodes, each with one relative link to a target that does not exist. */
function buildGraphWithDanglingRelativeLinks(root: string, count: number): Graph {
  let graph: Graph = createEmptyGraph()
  for (let i = 0; i < count; i += 1) {
    const content = `# note-${i}\n\n- ref [[ghost-${i}]]\n`
    const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(
      addedEvent(path.join(root, `note-${i}.md`), content),
      graph,
    )
    graph = applyGraphDeltaToGraph(graph, delta)
  }
  return graph
}

let tempRoot: string | null = null

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bf434-resolver-cost-'))
  setGraph(createEmptyGraph())
})

afterEach(async () => {
  vi.restoreAllMocks()
  setGraph(createEmptyGraph())
  setProjectRoot(null)
  if (tempRoot !== null) {
    await fs.rm(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

test('upsert with hundreds of dangling relative links spawns zero ripgreps and stays fast', async () => {
  const root = tempRoot!
  const seeded = buildGraphWithDanglingRelativeLinks(root, DANGLING_LINK_COUNT)
  expect(seeded.unresolvedLinksIndex.size).toBe(DANGLING_LINK_COUNT)

  setGraph(seeded)
  setProjectRoot(root)

  // Count invocations of the ripgrep IO boundary; never let a real rg spawn.
  const findFileSpy = vi
    .spyOn(findFileByNameModule, 'findFileByName')
    .mockResolvedValue([])

  // One more node upsert, itself carrying a relative dangling link.
  const triggerContent = `# trigger\n\n- ref [[ghost-also]]\n`
  const triggerDelta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(
    addedEvent(path.join(root, 'trigger.md'), triggerContent),
    seeded,
  )

  const startedAt = performance.now()
  await applyGraphDeltaToMemState(triggerDelta)
  const elapsedMs = performance.now() - startedAt

  // PRIMARY: the ripgrep IO boundary is never touched on the hot path.
  expect(findFileSpy).not.toHaveBeenCalled()

  // PRIMARY: none of the dangling relative targets were resurrected into the graph.
  const { getGraph } = await import('@vt/graph-db-server/state/graph-store')
  const finalGraph = getGraph()
  for (let i = 0; i < DANGLING_LINK_COUNT; i += 1) {
    expect(finalGraph.nodes[normalizePath(path.join(root, `ghost-${i}.md`))]).toBeUndefined()
  }
  // The seeded notes plus the trigger are present (nothing dropped).
  expect(finalGraph.nodes[noteId(root, 0)]).toBeDefined()
  expect(finalGraph.nodes[normalizePath(path.join(root, 'trigger.md'))]).toBeDefined()

  // SECONDARY: timing guard (was 14–58 s on the ripgrep-per-link path).
  expect(elapsedMs).toBeLessThan(50)
})
