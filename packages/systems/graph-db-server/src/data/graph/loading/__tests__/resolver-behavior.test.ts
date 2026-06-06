import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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
  type GraphNode,
} from '@vt/graph-model/graph'

import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import { setProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { applyGraphDeltaToMemState } from '../../mutations/applyGraphDelta'
import * as findFileByNameModule from '../findFileByName'

/**
 * BF-436 — Delta-scoped resolution; relative healing via the graph indexes;
 * preserved absolute-edge loading.
 *
 * Black-box against the real daemon hot path (`applyGraphDeltaToMemState`) and
 * real disk. These pin the *behavior* the cost rewrite must not regress.
 */

function addedEvent(absolutePath: string, content: string) {
  return { absolutePath, content, eventType: 'Added' as const }
}

function nodeId(root: string, name: string): string {
  return normalizePath(path.join(root, name))
}

function applyAdded(graph: Graph, absolutePath: string, content: string): Graph {
  return applyGraphDeltaToGraph(graph, addNodeToGraphWithEdgeHealingFromFSEvent(addedEvent(absolutePath, content), graph))
}

function deltaForAdded(graph: Graph, absolutePath: string, content: string): GraphDelta {
  return addNodeToGraphWithEdgeHealingFromFSEvent(addedEvent(absolutePath, content), graph)
}

function outgoingTargets(node: GraphNode): readonly string[] {
  return node.outgoingEdges.map(e => e.targetId)
}

let projectRoot: string | null = null
let outsideRoot: string | null = null

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bf436-project-'))
  outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bf436-outside-'))
  setGraph(createEmptyGraph())
  setProjectRoot(projectRoot)
})

afterEach(async () => {
  vi.restoreAllMocks()
  setGraph(createEmptyGraph())
  setProjectRoot(null)
  for (const dir of [projectRoot, outsideRoot]) {
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
  projectRoot = null
  outsideRoot = null
})

test('relative link resolves against an already-loaded node', async () => {
  const root = projectRoot!
  // Node B is loaded first.
  const withB: Graph = applyAdded(createEmptyGraph(), path.join(root, 'b.md'), '# B\n')
  setGraph(withB)

  // Upsert A with a relative link [[b]].
  const aDelta = deltaForAdded(withB, path.join(root, 'a.md'), '# A\n\n- ref [[b]]\n')
  await applyGraphDeltaToMemState(aDelta)

  const a = getGraph().nodes[nodeId(root, 'a.md')]
  expect(a).toBeDefined()
  expect(outgoingTargets(a)).toContain(nodeId(root, 'b.md'))
})

test('relative dangling link is not resurrected from disk, then resolves when its target loads', async () => {
  const root = projectRoot!

  // A real ghost.md exists on disk but is NOT loaded into the graph.
  await fs.writeFile(path.join(root, 'ghost.md'), '# Ghost\n')

  // Spy on the ripgrep IO boundary: it must never fire for relative links.
  const findFileSpy = vi.spyOn(findFileByNameModule, 'findFileByName').mockResolvedValue([])

  // Upsert A with [[ghost]] — no loaded ghost node.
  const aDelta = deltaForAdded(getGraph(), path.join(root, 'a.md'), '# A\n\n- ref [[ghost]]\n')
  await applyGraphDeltaToMemState(aDelta)

  // Dangling: the on-disk ghost.md is NOT loaded (relative links never crawl disk),
  // and A's edge stays the raw basename.
  expect(getGraph().nodes[nodeId(root, 'ghost.md')]).toBeUndefined()
  expect(outgoingTargets(getGraph().nodes[nodeId(root, 'a.md')])).toContain('ghost')

  // Upsert an unrelated node C — the resolver must do no disk work for ghost.
  const cDelta = deltaForAdded(getGraph(), path.join(root, 'c.md'), '# C\n')
  await applyGraphDeltaToMemState(cDelta)
  expect(getGraph().nodes[nodeId(root, 'ghost.md')]).toBeUndefined()
  expect(findFileSpy).not.toHaveBeenCalled()

  // Now load ghost.md as a node — A→ghost heals (graph-model edge indexes).
  const ghostDelta = deltaForAdded(getGraph(), path.join(root, 'ghost.md'), '# Ghost\n')
  await applyGraphDeltaToMemState(ghostDelta)

  expect(getGraph().nodes[nodeId(root, 'ghost.md')]).toBeDefined()
  expect(outgoingTargets(getGraph().nodes[nodeId(root, 'a.md')])).toContain(nodeId(root, 'ghost.md'))
  expect(findFileSpy).not.toHaveBeenCalled()
})

test('absolute link loads a file outside every loaded folder and outside the project root', async () => {
  const root = projectRoot!
  const outside = outsideRoot!

  // A real file living outside the project root entirely.
  const outsideFile = path.join(outside, 'outside-note.md')
  await fs.writeFile(outsideFile, '# Outside\n')
  const outsideFileId = normalizePath(outsideFile)

  // Upsert A (inside the project) with an absolute link to that outside file.
  const aDelta = deltaForAdded(getGraph(), path.join(root, 'a.md'), `# A\n\n- ref [[${outsideFile}]]\n`)
  await applyGraphDeltaToMemState(aDelta)

  // The outside file is loaded into the graph, and A points at it.
  expect(getGraph().nodes[outsideFileId]).toBeDefined()
  expect(outgoingTargets(getGraph().nodes[nodeId(root, 'a.md')])).toContain(outsideFileId)
})

test('project-relative link loads an exact file from an unloaded folder', async () => {
  const root = projectRoot!
  await fs.mkdir(path.join(root, 'archive'), { recursive: true })
  await fs.writeFile(path.join(root, 'archive', 'target.md'), '# Target\n')

  const aDelta = deltaForAdded(getGraph(), path.join(root, 'a.md'), '# A\n\n- ref [[archive/target]]\n')
  await applyGraphDeltaToMemState(aDelta)

  const targetId = nodeId(root, 'archive/target.md')
  expect(getGraph().nodes[targetId]).toBeDefined()
  expect(outgoingTargets(getGraph().nodes[nodeId(root, 'a.md')])).toContain(targetId)
})

test('missing project-relative exact path does not load a node', async () => {
  const root = projectRoot!

  const aDelta = deltaForAdded(getGraph(), path.join(root, 'a.md'), '# A\n\n- ref [[archive/missing]]\n')
  await applyGraphDeltaToMemState(aDelta)

  expect(getGraph().nodes[nodeId(root, 'archive/missing.md')]).toBeUndefined()
  expect(outgoingTargets(getGraph().nodes[nodeId(root, 'a.md')])).toContain('archive/missing')
})
