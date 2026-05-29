// DELETE /graph/node/:id is idempotent per RFC 7231: a repeated call (or a
// call after the underlying file has already been removed out-of-band by the
// watcher / external editor / a racing API caller) produces the same
// observable post-condition — node absent from the graph — without surfacing
// an error to the caller.
//
// Two failure modes used to violate this:
//   - prepareDeleteGraphNode returned 404 when the node was already gone.
//   - deleteNodeFile let fs.unlink's ENOENT bubble out as a 500 and left the
//     in-memory node behind (the in-memory mutation runs as part of the same
//     delta application that the FS failure aborts).
// This suite asserts the post-fix contract.

import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta, GraphNode } from '@vt/graph-model'
import { createEmptyGraph } from '@vt/graph-model'

import { startDaemon, type DaemonHandle } from '../src/daemon/index.ts'
import { clearWatchFolderState } from '../src/state/watch-folder-store.ts'
import { setGraph } from '../src/state/graph-store.ts'

function leafNode(absolutePath: string, content: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: absolutePath,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: { agent_name: 'delete-idem-test' },
    },
  }
}

function upsertDelta(node: GraphNode): GraphDelta {
  return [{ type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }]
}

async function postUpsert(baseUrl: string, node: GraphNode): Promise<void> {
  const res = await fetch(`${baseUrl}/graph/delta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(upsertDelta(node)),
  })
  expect(res.status).toBe(200)
}

async function deleteNode(baseUrl: string, nodeId: string): Promise<{ status: number; body: { ok?: boolean; alreadyAbsent?: boolean } }> {
  const res = await fetch(`${baseUrl}/graph/node/${encodeURIComponent(nodeId)}`, { method: 'DELETE' })
  return { status: res.status, body: await res.json() as { ok?: boolean; alreadyAbsent?: boolean } }
}

async function getGraphNodes(baseUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/graph`)
  return (await res.json() as { nodes: Record<string, unknown> }).nodes
}

describe('DELETE /graph/node/:id idempotency', () => {
  let root: string
  let project: string
  let handle: DaemonHandle | null
  let baseUrl: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-delete-idem-'))
    project = path.join(root, 'project')
    await mkdir(project, { recursive: true })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    handle = await startDaemon({
      project,
      voicetreeHomePath: path.join(root, 'voicetree-home'),
      createStarterIfEmpty: false,
    })
    baseUrl = `http://127.0.0.1:${handle.port}`
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    handle = null
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  it('returns 200 with alreadyAbsent=true when the node was never in the graph', async () => {
    const ghost = path.join(project, 'never-existed.md')
    const { status, body } = await deleteNode(baseUrl, ghost)
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, alreadyAbsent: true })
  })

  it('returns 200 when the file is unlinked out-of-band before DELETE runs (no 500 ENOENT)', async () => {
    // Models the watcher-vs-api race that produced the original fuzz flake: the
    // graph still has the node, but the file is already gone from disk by the
    // time DELETE arrives. Pre-fix this raised 500 GRAPH_NODE_DELETE_FAILED
    // *and* left the in-memory node behind.
    const nodePath = path.join(project, 'racy-delete.md')
    await postUpsert(baseUrl, leafNode(nodePath, '# Racy\n'))
    await unlink(nodePath)

    const { status } = await deleteNode(baseUrl, nodePath)
    expect(status).toBe(200)

    const nodes = await getGraphNodes(baseUrl)
    expect(nodes[nodePath]).toBeUndefined()
  })

  it('a second DELETE on the same node is a no-op success', async () => {
    const nodePath = path.join(project, 'double-delete.md')
    await postUpsert(baseUrl, leafNode(nodePath, '# Twice\n'))

    const first = await deleteNode(baseUrl, nodePath)
    expect(first.status).toBe(200)
    expect(first.body.alreadyAbsent).toBeUndefined()

    const second = await deleteNode(baseUrl, nodePath)
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ ok: true, alreadyAbsent: true })
  })
})
