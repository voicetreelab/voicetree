import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { createEmptyGraph } from '@vt/graph-model'
import { startDaemon, type DaemonHandle } from '@vt/graph-db-server'
import { setGraph } from '@vt/graph-db-server/state/graph-store'
import { clearWatchFolderState } from '@vt/graph-db-server/state/watch-folder-store'
import { DaemonUnreachableError, GraphDbClient, GraphDbClientError } from '../src'

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('condition not met before timeout')
}

async function addReadPath(client: GraphDbClient, p: string): Promise<void> {
  const { sessionId } = await client.createSession()
  try {
    await client.setFolderState(sessionId, p, 'expanded')
  } finally {
    await client.deleteSession(sessionId).catch(() => {})
  }
}

describe('@vt/graph-db-client system contract', () => {
  let root: string
  let vault: string
  let docs: string
  let handle: DaemonHandle | null
  let client: GraphDbClient

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphdb-client-system-'))
    vault = path.join(root, 'vault')
    docs = path.join(vault, 'docs')
    await mkdir(docs, { recursive: true })
    await saveVaultConfigForDirectory(vault, { writeFolder: '.' })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    handle = await startDaemon({
      vault,
      voicetreeHomePath: path.join(root, 'app-support'),
      createStarterIfEmpty: false,
    })
    client = await GraphDbClient.connect({ vault })
    await addReadPath(client, docs)
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    handle = null
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  describe('connection', () => {
    it('exposes the daemon health for the bound vault', async () => {
      await expect(client.health()).resolves.toMatchObject({ vault })
    })
  })

  describe('vault write path', () => {
    it('rejects missing write paths with a typed error', async () => {
      await expect(client.setWriteFolder(path.join(vault, 'missing'))).rejects.toMatchObject({
        name: 'GraphDbClientError',
        status: 400,
        code: 'PATH_NOT_FOUND',
      })
    })

    it('sets an existing write path and returns the updated vault state', async () => {
      await expect(client.setWriteFolder(docs)).resolves.toMatchObject({
        writeFolder: docs,
        projectRoot: vault,
      })
    })
  })

  describe('graph watcher', () => {
    it('reflects files written into the vault via the daemon watcher', async () => {
      const notePath = path.join(docs, 'alpha.md')
      await writeFile(notePath, '# Alpha\n\nClient watched content.\n', 'utf8')
      const graph = await waitFor(async () => {
        const value = await client.getGraph()
        return value.nodes[notePath] ? value : null
      })
      expect(graph.nodes[notePath]).toBeDefined()
    })
  })

  describe('sessions', () => {
    let sessionId: string
    let notePath: string

    beforeEach(async () => {
      notePath = path.join(docs, 'alpha.md')
      await writeFile(notePath, '# Alpha\n', 'utf8')
      await waitFor(async () => {
        const value = await client.getGraph()
        return value.nodes[notePath] ? value : null
      })
      const created = await client.createSession()
      sessionId = created.sessionId
    })

    it('lets two clients share one session and observe each other’s mutations', async () => {
      const clientA = await GraphDbClient.connect({ vault, sessionId })
      const clientB = await GraphDbClient.connect({ vault, sessionId })

      await expect(clientA.setFolderState(sessionId, docs, 'collapsed')).resolves.toMatchObject({
        folderState: expect.arrayContaining([[docs, 'collapsed']]),
      })
      await expect(
        clientB.setSelection(sessionId, { nodeIds: [notePath], mode: 'replace' }),
      ).resolves.toEqual({ selection: [notePath] })
      await expect(
        clientA.updateLayout(sessionId, {
          positions: { [notePath]: { x: 5, y: 7 } },
          zoom: 1.25,
          pan: { x: 1, y: 2 },
        }),
      ).resolves.toMatchObject({
        layout: { positions: { [notePath]: { x: 5, y: 7 } } },
      })

      await expect(clientB.getSessionState(sessionId)).resolves.toMatchObject({
        folderState: expect.arrayContaining([[docs, 'collapsed']]),
        selection: [notePath],
      })
    })

    it('returns a typed error when reading a deleted session', async () => {
      await client.deleteSession(sessionId)
      await expect(client.getSession(sessionId)).rejects.toBeInstanceOf(GraphDbClientError)
    })
  })

  describe('shutdown', () => {
    it('shuts down the daemon and subsequent connects fail with DaemonUnreachableError', async () => {
      await expect(client.shutdown()).resolves.toEqual({ ok: true })
      await waitFor(async () => {
        try {
          await client.health()
          return null
        } catch {
          return true
        }
      })
      handle = null

      await expect(GraphDbClient.connect({ vault })).rejects.toBeInstanceOf(DaemonUnreachableError)
    })
  })

  describe('concurrency stress', () => {
    it('serves 30 rapid concurrent layout updates from 5 clients on one session', async () => {
      const notePath = path.join(docs, 'race.md')
      await writeFile(notePath, '# race\n', 'utf8')
      await waitFor(async () => {
        const value = await client.getGraph()
        return value.nodes[notePath] ? value : null
      })

      const { sessionId } = await client.createSession()
      const clients = await Promise.all(
        Array.from({ length: 5 }, () => GraphDbClient.connect({ vault, sessionId })),
      )

      const updates = Array.from({ length: 30 }, (_, i) =>
        clients[i % clients.length].updateLayout(sessionId, {
          positions: { [notePath]: { x: i, y: i * 2 } },
          zoom: 1 + i * 0.01,
        }),
      )
      const responses = await Promise.all(updates)
      for (const r of responses) {
        expect(r.layout.positions[notePath]).toBeDefined()
      }

      const state = await client.getSessionState(sessionId)
      expect(state.layout.zoom).toBeGreaterThanOrEqual(1)
      expect(state.layout.zoom).toBeLessThanOrEqual(1 + 0.01 * 29)
    })

    it('survives 5 rapid connect cycles against the same daemon', async () => {
      for (let i = 0; i < 5; i++) {
        const fresh = await GraphDbClient.connect({ vault })
        await expect(fresh.health()).resolves.toMatchObject({ vault })
      }
    })

    it('lets a 200-node delta land via the typed client', async () => {
      const delta = Array.from({ length: 200 }, (_, i) => ({
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          outgoingEdges: [],
          absoluteFilePathIsID: path.join(vault, `bulk-${i}.md`),
          contentWithoutYamlOrLinks: `# bulk-${i}\n`,
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'None' },
            additionalYAMLProps: { agent_name: 'e2e' },
          },
        },
        previousNode: { _tag: 'None' },
      }))
      await expect(client.postDelta(delta)).resolves.toBeUndefined()

      const graph = await client.getGraph()
      for (let i = 0; i < 200; i++) {
        expect(graph.nodes[path.join(vault, `bulk-${i}.md`)]).toBeDefined()
      }
    })
  })

  describe('weird usage', () => {
    it('surfaces server validation errors as GraphDbClientError', async () => {
      // postDelta accepts unknown[]; we send a clearly malformed delta and
      // expect the server's INVALID_GRAPH_DELTA to round-trip into the client.
      const malformed = [{ type: 'NopeNotARealAction' } as unknown]
      await expect(client.postDelta(malformed)).rejects.toMatchObject({
        name: 'GraphDbClientError',
        status: 400,
        code: 'INVALID_GRAPH_DELTA',
      })
    })

    it('rejects deleting an unknown session with a typed 404 error', async () => {
      // DELETE on /sessions/:id returns 204 on success and 404 when missing.
      // The client treats !response.ok as an error — unknown ids reject.
      await expect(client.deleteSession('never-existed-id')).rejects.toMatchObject({
        name: 'GraphDbClientError',
        status: 404,
      })
    })

    it('rejects layout updates against unknown sessions with a typed error', async () => {
      await expect(
        client.updateLayout('never-existed-id', { positions: {} }),
      ).rejects.toBeInstanceOf(GraphDbClientError)
    })

    it('rejects requests after the daemon shuts down', async () => {
      await client.shutdown()
      await waitFor(async () => {
        try {
          await client.health()
          return null
        } catch {
          return true
        }
      })
      handle = null
      // Subsequent calls on the stale client now fail (network error)
      await expect(client.health()).rejects.toBeInstanceOf(Error)
    })
  })
})
