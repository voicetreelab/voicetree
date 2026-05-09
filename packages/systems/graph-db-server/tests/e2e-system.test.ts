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

describe('@vt/graph-db-server system contract', () => {
  let root: string
  let vault: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-system-'))
    vault = path.join(root, 'vault')
    await mkdir(vault, { recursive: true })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    handle = null
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  it('owns daemon lifecycle, vault state, file watching, sessions, projection, and shutdown over HTTP', async () => {
    handle = await startDaemon({
      vault,
      appSupportPath: path.join(root, 'app-support'),
      // Test owns the graph it creates — opt out of the daemon's first-run
      // starter-node side effect so layout.positions stays predictable.
      createStarterIfEmpty: false,
    })
    const baseUrl = `http://127.0.0.1:${handle.port}`

    expect(await readPortFile(vault)).toBe(handle.port)
    expect(HealthResponseSchema.parse(await (await fetch(`${baseUrl}/health`)).json())).toMatchObject({
      vault,
      sessionCount: 0,
    })

    const docs = path.join(vault, 'docs')
    await mkdir(docs, { recursive: true })
    const vaultResponse = await fetch(`${baseUrl}/vault/read-paths`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: docs }),
    })
    expect(vaultResponse.status).toBe(200)
    expect(VaultStateSchema.parse(await (await fetch(`${baseUrl}/vault`)).json())).toMatchObject({
      readPaths: [docs],
      vaultPath: vault,
      writePath: vault,
    })

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

    const httpNodePath = path.join(vault, 'http-created.md')
    const httpNode: GraphNode = {
      kind: 'leaf',
      outgoingEdges: [],
      absoluteFilePathIsID: httpNodePath,
      contentWithoutYamlOrLinks: '# HTTP Created\n\nCreated through the daemon API.\n',
      nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: new Map([['agent_name', 'e2e']]),
      },
    }
    const createDelta: GraphDelta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: httpNode,
        previousNode: O.none,
      },
    ]
    const createResponse = await fetch(`${baseUrl}/graph/delta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createDelta),
    })
    expect(createResponse.status).toBe(200)
    const graphAfterCreate = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
    expect(graphAfterCreate.nodes[httpNodePath]).toBeDefined()
    await expect(readFile(httpNodePath, 'utf8')).resolves.toContain('# HTTP Created')

    const deleteResponse = await fetch(
      `${baseUrl}/graph/node/${encodeURIComponent(httpNodePath)}`,
      { method: 'DELETE' },
    )
    expect(deleteResponse.status).toBe(200)
    const graphAfterDelete = await (await fetch(`${baseUrl}/graph`)).json() as { nodes: Record<string, unknown> }
    expect(graphAfterDelete.nodes[httpNodePath]).toBeUndefined()
    await expect(readFile(httpNodePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const createdSession = SessionCreateResponseSchema.parse(
      await (await fetch(`${baseUrl}/sessions`, { method: 'POST' })).json(),
    )
    expect(HealthResponseSchema.parse(await (await fetch(`${baseUrl}/health`)).json()).sessionCount).toBe(1)

    const folderId = `${docs}/`
    const collapse = await fetch(
      `${baseUrl}/sessions/${createdSession.sessionId}/collapse/${encodeURIComponent(folderId)}`,
      { method: 'POST' },
    )
    expect(collapse.status).toBe(200)

    const selection = await fetch(`${baseUrl}/sessions/${createdSession.sessionId}/selection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeIds: [notePath], mode: 'replace' }),
    })
    expect(selection.status).toBe(200)

    const layout = LayoutResponseSchema.parse(
      await (
        await fetch(`${baseUrl}/sessions/${createdSession.sessionId}/layout`, {
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

    const sessionState = LiveStateSnapshotSchema.parse(
      await (await fetch(`${baseUrl}/sessions/${createdSession.sessionId}/state`)).json(),
    )
    expect(sessionState.selection).toEqual([notePath])
    expect(sessionState.collapseSet).toEqual([folderId])
    expect(sessionState.layout.positions).toEqual([[notePath, { x: 10, y: 20 }]])
    expect(sessionState.layout.pan).toEqual({ x: 3, y: 4 })
    expect(sessionState.layout.zoom).toBe(1.5)

    const shutdown = ShutdownResponseSchema.parse(
      await (await fetch(`${baseUrl}/shutdown`, { method: 'POST' })).json(),
    )
    expect(shutdown).toEqual({ ok: true })
    await waitFor(async () => (await readPortFile(vault)) === null ? true : null)
    handle = null
  })
})
