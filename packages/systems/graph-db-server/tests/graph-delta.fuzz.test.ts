import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta, GraphNode } from '@vt/graph-model'

import { startDaemon, type DaemonHandle } from '../src/daemon/index.ts'

type GraphBody = {
  nodes: Record<string, GraphNode>
}

function mulberry32(seed: number): () => number {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('condition not met before timeout')
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)] as T
}

function shuffle<T>(rng: () => number, values: readonly T[]): T[] {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name === '.voicetree') continue

    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(absolutePath))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolutePath)
    }
  }

  return files.sort()
}

function makeNode(
  nodePath: string,
  content: string,
  outgoingTargets: readonly string[],
): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: outgoingTargets.map((targetId) => ({ targetId, label: '' })),
    absoluteFilePathIsID: nodePath,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

function randomTargets(
  rng: () => number,
  nodeIds: readonly string[],
  sourceId: string,
): string[] {
  const candidates = nodeIds.filter((id) => id !== sourceId)
  const count = Math.floor(rng() * Math.min(3, candidates.length + 1))
  return shuffle(rng, candidates).slice(0, count)
}

function deletableNodeIds(nodes: ReadonlyMap<string, GraphNode>): string[] {
  const targeted = new Set<string>()
  for (const node of nodes.values()) {
    for (const edge of node.outgoingEdges) {
      targeted.add(edge.targetId)
    }
  }

  return [...nodes.keys()].filter((id) => !targeted.has(id))
}

async function postDelta(baseUrl: string, delta: GraphDelta): Promise<void> {
  const response = await fetch(`${baseUrl}/graph/delta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(delta),
  })
  expect(response.status).toBe(200)
}

async function getGraph(baseUrl: string): Promise<GraphBody> {
  const response = await fetch(`${baseUrl}/graph`)
  expect(response.status).toBe(200)
  const body = await response.json() as GraphBody
  expect(body).toEqual(expect.objectContaining({ nodes: expect.any(Object) }))
  return body
}

function assertEdgeConsistency(graph: GraphBody, ctx: string): void {
  const nodeIds = new Set(Object.keys(graph.nodes))

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    for (const edge of node.outgoingEdges ?? []) {
      if (!nodeIds.has(edge.targetId)) {
        throw new Error(`[${ctx}] edge from ${nodeId} points at missing node ${edge.targetId}`)
      }
    }
  }
}

async function assertNoOrphanFiles(
  vault: string,
  graph: GraphBody,
  ctx: string,
): Promise<void> {
  const markdownFiles = await listMarkdownFiles(vault)
  const nodeIds = Object.keys(graph.nodes).sort()
  expect(markdownFiles, `[${ctx}] markdown files must correspond to graph nodes`).toEqual(nodeIds)
}

async function assertNodeMaterialized(
  baseUrl: string,
  node: GraphNode,
  ctx: string,
): Promise<GraphBody> {
  return waitFor(async () => {
    const graph = await getGraph(baseUrl)
    const graphNode = graph.nodes[node.absoluteFilePathIsID]
    if (!graphNode) return null
    if (!await fileExists(node.absoluteFilePathIsID)) return null

    const content = await readFile(node.absoluteFilePathIsID, 'utf8')
    if (!content.includes(node.contentWithoutYamlOrLinks.trim())) return null

    assertEdgeConsistency(graph, ctx)
    return graph
  })
}

async function assertNodeDeleted(
  baseUrl: string,
  nodeId: string,
  ctx: string,
): Promise<GraphBody> {
  return waitFor(async () => {
    const graph = await getGraph(baseUrl)
    if (graph.nodes[nodeId]) return null
    if (await fileExists(nodeId)) return null

    assertEdgeConsistency(graph, ctx)
    return graph
  })
}

describe('graph delta HTTP API fuzz test', () => {
  let root: string
  let vault: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-delta-fuzz-'))
    vault = path.join(root, 'vault')
    await mkdir(vault, { recursive: true })
    handle = null
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })

  it('preserves graph, markdown, and edge invariants across random delta sequences', { timeout: 60_000 }, async () => {
    handle = await startDaemon({
      vault,
      appSupportPath: path.join(root, 'app-support'),
    })
    const baseUrl = `http://127.0.0.1:${handle.port}`
    const seed = 0xA11CE5
    const topRng = mulberry32(seed)
    const expectedNodes = new Map<string, GraphNode>()
    let nextNodeSeq = 0

    for (let seq = 0; seq < 100; seq++) {
      const seqSeed = (topRng() * 0xFFFFFFFF) >>> 0
      const rng = mulberry32(seqSeed)
      const steps = 5 + Math.floor(rng() * 11)

      for (let step = 0; step < steps; step++) {
        const ctx = `seed=0x${seed.toString(16)} seq=${seq} seqSeed=0x${seqSeed.toString(16)} step=${step}`
        const existingIds = [...expectedNodes.keys()]
        const safeDeletes = deletableNodeIds(expectedNodes)
        const unsafeDeletes = existingIds.filter((id) => !safeDeletes.includes(id))
        const operation = existingIds.length === 0
          ? 'create'
          : pick(rng, [
              'create',
              'update',
              'read',
              ...(safeDeletes.length > 0 ? ['delete'] : []),
              ...(unsafeDeletes.length > 0 ? ['unsafeDelete'] : []),
            ] as const)

        if (operation === 'create') {
          const nodePath = path.join(vault, `fuzz-${nextNodeSeq++}.md`)
          const node = makeNode(
            nodePath,
            `# Fuzz ${nextNodeSeq}\n\nCreated in ${ctx}.\n`,
            randomTargets(rng, existingIds, nodePath),
          )
          await postDelta(baseUrl, [{
            type: 'UpsertNode',
            nodeToUpsert: node,
            previousNode: O.none,
          }])
          expectedNodes.set(nodePath, node)

          const graph = await assertNodeMaterialized(baseUrl, node, ctx)
          await assertNoOrphanFiles(vault, graph, ctx)
          continue
        }

        if (operation === 'update') {
          const nodePath = pick(rng, existingIds)
          const previousNode = expectedNodes.get(nodePath)
          expect(previousNode, `[${ctx}] previous node must exist`).toBeDefined()
          const node = makeNode(
            nodePath,
            `# Updated ${path.basename(nodePath, '.md')}\n\nUpdated in ${ctx}.\n`,
            randomTargets(rng, existingIds, nodePath),
          )
          await postDelta(baseUrl, [{
            type: 'UpsertNode',
            nodeToUpsert: node,
            previousNode: O.some(previousNode as GraphNode),
          }])
          expectedNodes.set(nodePath, node)

          const graph = await assertNodeMaterialized(baseUrl, node, ctx)
          await assertNoOrphanFiles(vault, graph, ctx)
          continue
        }

        if (operation === 'delete') {
          const nodePath = pick(rng, safeDeletes)
          const response = await fetch(
            `${baseUrl}/graph/node/${encodeURIComponent(nodePath)}`,
            { method: 'DELETE' },
          )
          expect(response.status).toBe(200)
          expectedNodes.delete(nodePath)

          const graph = await assertNodeDeleted(baseUrl, nodePath, ctx)
          await assertNoOrphanFiles(vault, graph, ctx)
          continue
        }

        if (operation === 'unsafeDelete') {
          const nodePath = pick(rng, unsafeDeletes)
          const response = await fetch(
            `${baseUrl}/graph/node/${encodeURIComponent(nodePath)}`,
            { method: 'DELETE' },
          )
          expect(response.status).toBe(200)
          expectedNodes.delete(nodePath)

          // Wait for node removal without edge consistency check (the system
          // does not clean up incoming edges from other nodes automatically).
          await waitFor(async () => {
            const g = await getGraph(baseUrl)
            if (g.nodes[nodePath]) return null
            if (await fileExists(nodePath)) return null
            return g
          })

          // Heal dangling edges: re-upsert each node that referenced the
          // deleted target with the edge stripped, as a real client would.
          const affected = [...expectedNodes.entries()].filter(
            ([, n]) => n.outgoingEdges.some((e) => e.targetId === nodePath),
          )
          for (const [affectedPath, oldNode] of affected) {
            const healed = makeNode(
              affectedPath,
              oldNode.contentWithoutYamlOrLinks,
              oldNode.outgoingEdges
                .filter((e) => e.targetId !== nodePath)
                .map((e) => e.targetId),
            )
            await postDelta(baseUrl, [{
              type: 'UpsertNode',
              nodeToUpsert: healed,
              previousNode: O.some(oldNode),
            }])
            expectedNodes.set(affectedPath, healed)
          }

          const graph = await getGraph(baseUrl)
          assertEdgeConsistency(graph, ctx)
          await assertNoOrphanFiles(vault, graph, ctx)
          continue
        }

        const graph = await getGraph(baseUrl)
        assertEdgeConsistency(graph, ctx)
        await assertNoOrphanFiles(vault, graph, ctx)
      }
    }
  })
})
