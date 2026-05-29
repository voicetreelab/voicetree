import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta, GraphNode } from '@vt/graph-model'
import { createEmptyGraph } from '@vt/graph-model'

import {
  startDaemon,
  type DaemonHandle,
} from '../src/daemon/index.ts'
import { clearWatchFolderState } from '../src/state/watch-folder-store.ts'
import { setGraph } from '../src/state/graph-store.ts'
import { addReadPath } from './e2e-system-helpers.ts'

type GraphResponse = {
  nodes: Record<string, GraphNode>
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 6000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('condition not met before timeout')
}

async function waitForSettle(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function makeNode(nodeId: string, content: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: nodeId,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
      isContextNode: false,
    },
  }
}

function makeCreateDelta(node: GraphNode): GraphDelta {
  return [
    {
      type: 'UpsertNode',
      nodeToUpsert: node,
      previousNode: O.none,
    },
  ]
}

async function readGraph(baseUrl: string): Promise<GraphResponse> {
  return await (await fetch(`${baseUrl}/graph`)).json() as GraphResponse
}

async function postGraphDelta(baseUrl: string, delta: GraphDelta): Promise<void> {
  const response = await fetch(`${baseUrl}/graph/delta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(delta),
  })
  expect(response.status).toBe(200)
}

async function deleteGraphNode(baseUrl: string, nodeId: string): Promise<void> {
  const response = await fetch(
    `${baseUrl}/graph/node/${encodeURIComponent(nodeId)}`,
    { method: 'DELETE' },
  )
  expect(response.status).toBe(200)
}

function expectNodeAppearsExactlyOnce(graph: GraphResponse, nodeId: string): void {
  expect(Object.keys(graph.nodes).filter((id) => id === nodeId)).toHaveLength(1)
  expect(graph.nodes[nodeId]).toBeDefined()
}

describe('pending-writes suppression over daemon HTTP API', () => {
  let root: string
  let vault: string
  let docs: string
  let baseUrl: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-pending-writes-'))
    vault = path.join(root, 'vault')
    docs = path.join(vault, 'docs')
    await mkdir(docs, { recursive: true })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    handle = await startDaemon({
      vault,
      voicetreeHomePath: path.join(root, 'app-support'),
    })
    baseUrl = `http://127.0.0.1:${handle.port}`
    // The default writeFolderPath is now a `voicetree-{date}` subfolder of the
    // vault (see resolveDefaultWriteFolderPath), so files written to vault/docs/
    // sit outside the watcher's allowlist until we mark docs/ as expanded.
    await addReadPath(baseUrl, docs)
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  it('does not double-process a node created through the HTTP CRUD path', async () => {
    const nodeId = path.join(docs, 'crud-created.md')
    const node = makeNode(nodeId, '# CRUD Created\n\nCreated through HTTP.\n')

    await postGraphDelta(baseUrl, makeCreateDelta(node))
    await waitForSettle()

    await expect(access(nodeId)).resolves.toBeUndefined()
    await expect(readFile(nodeId, 'utf8')).resolves.toContain('# CRUD Created')

    const graph = await readGraph(baseUrl)
    expectNodeAppearsExactlyOnce(graph, nodeId)
    expect(graph.nodes[nodeId].contentWithoutYamlOrLinks).toBe('# CRUD Created\n\nCreated through HTTP.\n')
  }, 12000)

  it('detects a direct external filesystem write through chokidar', async () => {
    const nodeId = path.join(docs, 'external-write.md')

    await writeFile(nodeId, '---\n---\n# External Write\n\nDetected by chokidar.\n', 'utf8')

    const graph = await waitFor(async () => {
      const candidate = await readGraph(baseUrl)
      return candidate.nodes[nodeId] ? candidate : null
    })

    expectNodeAppearsExactlyOnce(graph, nodeId)
    expect(graph.nodes[nodeId].contentWithoutYamlOrLinks).toBe('# External Write\n\nDetected by chokidar.\n')
  }, 12000)

  it('allows an external modification after a CRUD write to update graph content', async () => {
    const nodeId = path.join(docs, 'crud-then-external.md')
    const node = makeNode(nodeId, '# Original CRUD Content\n\nBefore external edit.\n')

    await postGraphDelta(baseUrl, makeCreateDelta(node))
    await waitFor(async () => {
      const candidate = await readGraph(baseUrl)
      return candidate.nodes[nodeId] ? candidate : null
    })
    await waitForSettle()

    await writeFile(nodeId, '---\n---\n# External Content\n\nAfter direct edit.\n', 'utf8')

    const graph = await waitFor(async () => {
      const candidate = await readGraph(baseUrl)
      return candidate.nodes[nodeId]?.contentWithoutYamlOrLinks === '# External Content\n\nAfter direct edit.\n'
        ? candidate
        : null
    })

    expectNodeAppearsExactlyOnce(graph, nodeId)
    expect(graph.nodes[nodeId].contentWithoutYamlOrLinks).toBe('# External Content\n\nAfter direct edit.\n')
  }, 12000)

  it('removes a CRUD-deleted node without a double-delete regression', async () => {
    const nodeId = path.join(docs, 'crud-deleted.md')
    const node = makeNode(nodeId, '# Delete Through HTTP\n\nWill be deleted.\n')

    await postGraphDelta(baseUrl, makeCreateDelta(node))
    await waitFor(async () => {
      const candidate = await readGraph(baseUrl)
      return candidate.nodes[nodeId] ? candidate : null
    })
    await expect(access(nodeId)).resolves.toBeUndefined()

    await deleteGraphNode(baseUrl, nodeId)
    await waitForSettle()

    await expect(access(nodeId)).rejects.toMatchObject({ code: 'ENOENT' })
    const graph = await readGraph(baseUrl)
    expect(graph.nodes[nodeId]).toBeUndefined()
  }, 12000)
})
