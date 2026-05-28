import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta, GraphNode } from '@vt/graph-model'

import {
  HealthResponseSchema,
  LayoutResponseSchema,
  LiveStateSnapshotSchema,
  SessionCreateResponseSchema,
  ShutdownResponseSchema,
  VaultStateSchema,
  readPortFile,
  startDaemon,
  type DaemonHandle,
} from '../src/daemon/index.ts'
import { clearWatchFolderState } from '../src/state/watch-folder-store.ts'
import { setGraph } from '../src/state/graph-store.ts'
import { createEmptyGraph } from '@vt/graph-model'

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('condition not met before timeout')
}

function makeNode(absolutePath: string, content: string, agentName = 'e2e'): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: absolutePath,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: { agent_name: agentName },
    },
  }
}

function upsertDelta(node: GraphNode): GraphDelta {
  return [{ type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }]
}

async function addReadPath(baseUrl: string, p: string): Promise<void> {
  void baseUrl
  void p
}

describe('@vt/graph-db-server system contract', () => {
  let root: string
  let vault: string
  let docs: string
  let handle: DaemonHandle | null
  let baseUrl: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-system-'))
    vault = path.join(root, 'vault')
    docs = path.join(vault, 'docs')
    await mkdir(docs, { recursive: true })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    handle = await startDaemon({
      vault,
      appSupportPath: path.join(root, 'app-support'),
      // Test owns the graph it creates — opt out of the daemon's first-run
      // starter-node side effect so layout.positions stays predictable.
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

  describe('health endpoint', () => {
    it('writes a port file matching the daemon port and reports the open vault', async () => {
      expect(await readPortFile(vault)).toBe(handle!.port)
      const body = HealthResponseSchema.parse(await (await fetch(`${baseUrl}/health`)).json())
      expect(body).toMatchObject({ vault, sessionCount: 0 })
    })

    it('reflects session count after a session is created', async () => {
      await fetch(`${baseUrl}/sessions`, { method: 'POST' })
      const body = HealthResponseSchema.parse(await (await fetch(`${baseUrl}/health`)).json())
      expect(body.sessionCount).toBe(1)
    })
  })

  describe('vault endpoint', () => {
    it('sets the write path and reflects it in /vault', async () => {
      const res = await fetch(`${baseUrl}/vault/write-path`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: docs }),
      })
      expect(res.status).toBe(200)
      const vaultState = VaultStateSchema.parse(await (await fetch(`${baseUrl}/vault`)).json())
      expect(vaultState).toMatchObject({ projectRoot: vault, writeFolder: docs })
    })
  })

  describe('graph endpoint', () => {
    beforeEach(async () => {
      await addReadPath(baseUrl, docs)
    })

    it('reflects files written into a read-path via the watcher', async () => {
      const notePath = path.join(docs, 'alpha.md')
      await writeFile(
        notePath,
        '---\nposition:\n  x: 10\n  y: 20\n---\n# Alpha\n\nWatched content.\n',
        'utf8',
      )
      const graph = await waitFor(async () => {
        const body = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
        return body.nodes[notePath] ? body : null
      })
      expect(graph.nodes[notePath]).toBeDefined()
    })

    it('creates a node from POST /graph/delta and writes it to disk', async () => {
      const nodePath = path.join(vault, 'http-created.md')
      const res = await fetch(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upsertDelta(makeNode(nodePath, '# HTTP Created\n\nCreated through the daemon API.\n'))),
      })
      expect(res.status).toBe(200)
      const graph = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
      expect(graph.nodes[nodePath]).toBeDefined()
      await expect(readFile(nodePath, 'utf8')).resolves.toContain('# HTTP Created')
    })

    it('deletes a node via DELETE /graph/node/:id and removes the file', async () => {
      const nodePath = path.join(vault, 'to-delete.md')
      await fetch(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upsertDelta(makeNode(nodePath, '# To Delete\n'))),
      })
      const res = await fetch(`${baseUrl}/graph/node/${encodeURIComponent(nodePath)}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      const graph = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
      expect(graph.nodes[nodePath]).toBeUndefined()
      await expect(readFile(nodePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('sessions endpoint', () => {
    let sessionId: string
    let folderId: string
    let notePath: string

    beforeEach(async () => {
      await addReadPath(baseUrl, docs)
      notePath = path.join(docs, 'alpha.md')
      // Position frontmatter is what surfaces in state.layout.positions —
      // that field is projected from graph nodes, not from session.layout.
      await writeFile(
        notePath,
        '---\nposition:\n  x: 10\n  y: 20\n---\n# Alpha\n\nWatched content.\n',
        'utf8',
      )
      await waitFor(async () => {
        const body = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
        return body.nodes[notePath] ? body : null
      })
      const created = SessionCreateResponseSchema.parse(
        await (await fetch(`${baseUrl}/sessions`, { method: 'POST' })).json(),
      )
      sessionId = created.sessionId
      folderId = docs
    })

    it('creates a session via POST /sessions and returns a usable id', async () => {
      const info = await (await fetch(`${baseUrl}/sessions/${sessionId}`)).json()
      expect(info).toMatchObject({ id: sessionId })
    })

    it('sets folder state via PATCH /sessions/:id/folder-state/:folderId', async () => {
      const res = await fetch(
        `${baseUrl}/sessions/${sessionId}/folder-state/${encodeURIComponent(folderId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'collapsed' }),
        },
      )
      expect(res.status).toBe(200)
    })

    it('updates selection via POST /sessions/:id/selection', async () => {
      const res = await fetch(`${baseUrl}/sessions/${sessionId}/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: [notePath], mode: 'replace' }),
      })
      expect(res.status).toBe(200)
    })

    it('updates layout via PUT /sessions/:id/layout', async () => {
      const layout = LayoutResponseSchema.parse(
        await (
          await fetch(`${baseUrl}/sessions/${sessionId}/layout`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              positions: { [notePath]: { x: 10, y: 20 } },
              pan: { x: 3, y: 4 },
              zoom: 1.5,
            }),
          })
        ).json(),
      )
      expect(layout.layout.positions[notePath]).toEqual({ x: 10, y: 20 })
    })

    it('returns the live state snapshot composing folder state + selection + layout', async () => {
      await fetch(
        `${baseUrl}/sessions/${sessionId}/folder-state/${encodeURIComponent(folderId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'collapsed' }),
        },
      )
      await fetch(`${baseUrl}/sessions/${sessionId}/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: [notePath], mode: 'replace' }),
      })
      await fetch(`${baseUrl}/sessions/${sessionId}/layout`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          positions: { [notePath]: { x: 10, y: 20 } },
          pan: { x: 3, y: 4 },
          zoom: 1.5,
        }),
      })

      const sessionState = LiveStateSnapshotSchema.parse(
        await (await fetch(`${baseUrl}/sessions/${sessionId}/state`)).json(),
      )
      expect(sessionState.selection).toEqual([notePath])
      expect(sessionState.folderState).toEqual(expect.arrayContaining([[folderId, 'collapsed']]))
      expect(sessionState.layout.positions).toEqual([[notePath, { x: 10, y: 20 }]])
      expect(sessionState.layout.pan).toEqual({ x: 3, y: 4 })
      expect(sessionState.layout.zoom).toBe(1.5)
    })
  })

  describe('shutdown endpoint', () => {
    it('shuts down the daemon and deletes the port file', async () => {
      const shutdown = ShutdownResponseSchema.parse(
        await (await fetch(`${baseUrl}/shutdown`, { method: 'POST' })).json(),
      )
      expect(shutdown).toEqual({ ok: true })
      await waitFor(async () => ((await readPortFile(vault)) === null ? true : null))
      handle = null
    })
  })

  describe('concurrency stress', () => {
    beforeEach(async () => {
      await addReadPath(baseUrl, docs)
    })

    it('serves 30 concurrent layout updates on one session — all 200, session settles on a valid zoom', async () => {
      const notePath = path.join(vault, 'race.md')
      await fetch(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upsertDelta(makeNode(notePath, '# race\n'))),
      })
      const { sessionId } = SessionCreateResponseSchema.parse(
        await (await fetch(`${baseUrl}/sessions`, { method: 'POST' })).json(),
      )

      const zooms = Array.from({ length: 30 }, (_, i) => 1 + i * 0.01)
      const updates = zooms.map((zoom, i) =>
        fetch(`${baseUrl}/sessions/${sessionId}/layout`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            positions: { [notePath]: { x: i, y: i * 2 } },
            zoom,
          }),
        }).then(async (r) => {
          expect(r.status).toBe(200)
          return LayoutResponseSchema.parse(await r.json())
        }),
      )
      const results = await Promise.all(updates)
      for (const r of results) {
        expect(r.layout.positions[notePath]).toBeDefined()
      }

      // session.layout.zoom is last-write-wins; final zoom must be one we sent
      const state = LiveStateSnapshotSchema.parse(
        await (await fetch(`${baseUrl}/sessions/${sessionId}/state`)).json(),
      )
      expect(zooms).toContain(state.layout.zoom)
    })

    it('handles racing folder-state/selection/layout from multiple sessions on the same folder', async () => {
      const notePath = path.join(docs, 'multi.md')
      await writeFile(notePath, '# multi\n', 'utf8')
      await waitFor(async () => {
        const body = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
        return body.nodes[notePath] ? body : null
      })

      const sessionIds = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const r = await fetch(`${baseUrl}/sessions`, { method: 'POST' })
          return SessionCreateResponseSchema.parse(await r.json()).sessionId
        }),
      )

      const folderId = docs
      const ops: Array<Promise<Response>> = []
      for (const sid of sessionIds) {
        ops.push(
          fetch(`${baseUrl}/sessions/${sid}/folder-state/${encodeURIComponent(folderId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state: 'collapsed' }),
          }),
          fetch(`${baseUrl}/sessions/${sid}/folder-state/${encodeURIComponent(folderId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state: 'expanded' }),
          }),
          fetch(`${baseUrl}/sessions/${sid}/selection`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ nodeIds: [notePath], mode: 'replace' }),
          }),
          fetch(`${baseUrl}/sessions/${sid}/layout`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ positions: { [notePath]: { x: 1, y: 1 } } }),
          }),
        )
      }

      const responses = await Promise.all(ops)
      for (const r of responses) {
        expect(r.status).toBeLessThan(500)
      }

      const health = HealthResponseSchema.parse(await (await fetch(`${baseUrl}/health`)).json())
      expect(health.sessionCount).toBe(5)

      // Each session settles with the only nodeId we ever selected
      for (const sid of sessionIds) {
        const state = LiveStateSnapshotSchema.parse(
          await (await fetch(`${baseUrl}/sessions/${sid}/state`)).json(),
        )
        expect(state.selection).toEqual([notePath])
      }
    })

    it('accepts a single delta with 200 node upserts and reflects every node in /graph', async () => {
      const NODES = 200
      const delta: GraphDelta = Array.from({ length: NODES }, (_, i) => ({
        type: 'UpsertNode',
        nodeToUpsert: makeNode(path.join(vault, `bulk-${i}.md`), `# bulk-${i}\n`),
        previousNode: O.none,
      }))
      const res = await fetch(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delta),
      })
      expect(res.status).toBe(200)
      const graph = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
      for (let i = 0; i < NODES; i++) {
        expect(graph.nodes[path.join(vault, `bulk-${i}.md`)]).toBeDefined()
      }
    })

    it('eventually surfaces 20 concurrently written files in the graph without duplicates', async () => {
      const FILES = 20
      const filePaths = Array.from({ length: FILES }, (_, i) => path.join(docs, `concurrent-${i}.md`))
      await Promise.all(filePaths.map((p, i) => writeFile(p, `# concurrent-${i}\n`, 'utf8')))

      const finalGraph = await waitFor(async () => {
        const body = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
        return filePaths.every((p) => body.nodes[p]) ? body : null
      })

      // No duplicate node ids — graph.nodes is keyed by abs path so we just
      // assert each file appears exactly once in the keys.
      const seen = new Set<string>()
      for (const id of Object.keys(finalGraph.nodes)) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
      for (const p of filePaths) expect(seen.has(p)).toBe(true)
    })
  })

  describe('weird usage', () => {
    it('returns 400 INVALID_GRAPH_DELTA for malformed delta body', async () => {
      const res = await fetch(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nope: 'not an array' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: string; error: string }
      expect(body.code).toBe('INVALID_GRAPH_DELTA')
      expect(body.error).toMatch(/Invalid/i)
    })

    // Idempotency cases covered in delete-node-idempotent.test.ts.

    it('returns 404 on session-scoped routes when the session does not exist', async () => {
      const folderId = `${vault}/`
      const folderState = await fetch(
        `${baseUrl}/sessions/unknown-id/folder-state/${encodeURIComponent(folderId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'collapsed' }),
        },
      )
      expect(folderState.status).toBe(404)

      const selection = await fetch(`${baseUrl}/sessions/unknown-id/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: [], mode: 'replace' }),
      })
      expect(selection.status).toBe(404)

      const layout = await fetch(`${baseUrl}/sessions/unknown-id/layout`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: {} }),
      })
      expect(layout.status).toBe(404)

      const state = await fetch(`${baseUrl}/sessions/unknown-id/state`)
      expect(state.status).toBe(404)

      const info = await fetch(`${baseUrl}/sessions/unknown-id`)
      expect(info.status).toBe(404)
    })

    it('returns 400 PATH_NOT_FOUND when setting a missing write path', async () => {
      const res = await fetch(`${baseUrl}/vault/write-path`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: path.join(vault, 'never-existed') }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('PATH_NOT_FOUND')
    })

    it('rejects HTTP requests after /shutdown completes', async () => {
      await fetch(`${baseUrl}/shutdown`, { method: 'POST' })
      await waitFor(async () => ((await readPortFile(vault)) === null ? true : null))
      handle = null
      await expect(fetch(`${baseUrl}/health`)).rejects.toBeInstanceOf(Error)
    })

    it('accepts /graph/delta without an X-Session-Id header — defaults to anonymous', async () => {
      const notePath = path.join(vault, 'no-session.md')
      const res = await fetch(`${baseUrl}/graph/delta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upsertDelta(makeNode(notePath, '# anon\n'))),
      })
      expect(res.status).toBe(200)
      const graph = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
      expect(graph.nodes[notePath]).toBeDefined()
    })
  })
})
