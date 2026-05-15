import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEmptyGraph } from '@vt/graph-model'
import { setGraph } from '@vt/graph-db-server/state/graph-store'
import { clearWatchFolderState } from '@vt/graph-db-server/state/watch-folder-store'
import { type DaemonHandle, startDaemon } from '@vt/graph-db-server/server'
import { GraphDbClient } from '../GraphDbClient.ts'
import { DaemonUnreachableError, GraphDbClientError } from '../errors.ts'

type Harness = {
  appSupportPath: string
  root: string
  vault: string
}

async function createHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'graph-db-client-test-'))
  const appSupportPath = join(root, 'app-support')
  const vault = join(root, 'vault')

  await mkdir(appSupportPath, { recursive: true })
  await mkdir(vault, { recursive: true })

  return { appSupportPath, root, vault }
}

async function waitFor<T>(
  fn: () => Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 2000
  const intervalMs = opts.intervalMs ?? 50
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const value = await fn()
    if (value !== null) {
      return value
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`condition not met within ${timeoutMs}ms`)
}

describe('GraphDbClient', () => {
  let harness: Harness
  let handles: DaemonHandle[]
  let originalAppSupportPath: string | undefined

  beforeEach(async () => {
    harness = await createHarness()
    handles = []
    originalAppSupportPath = process.env.VOICETREE_APP_SUPPORT
    process.env.VOICETREE_APP_SUPPORT = harness.appSupportPath
    clearWatchFolderState()
    setGraph(createEmptyGraph())
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    if (originalAppSupportPath === undefined) {
      delete process.env.VOICETREE_APP_SUPPORT
    } else {
      process.env.VOICETREE_APP_SUPPORT = originalAppSupportPath
    }
    await rm(harness.root, { recursive: true, force: true })
  })

  const start = async (): Promise<DaemonHandle> => {
    const handle = await startDaemon({ vault: harness.vault })
    handles.push(handle)
    return handle
  }

  const connect = async (sessionId?: string): Promise<GraphDbClient> => {
    return await GraphDbClient.connect({ vault: harness.vault, sessionId })
  }

  describe('lifecycle', () => {
    test('connect verifies health and shutdown returns the typed response', async () => {
      const handle = await start()
      const client = await connect()

      await expect(client.health()).resolves.toMatchObject({
        vault: harness.vault,
        sessionCount: 0,
      })
      await expect(client.shutdown()).resolves.toEqual({ ok: true })

      await waitFor(async () => {
        try {
          await fetch(`http://127.0.0.1:${handle.port}/health`)
          return null
        } catch {
          return true
        }
      })
    })

    test('connect rejects when the discovered port does not answer health', async () => {
      await mkdir(join(harness.vault, '.voicetree'), { recursive: true })
      await writeFile(
        join(harness.vault, '.voicetree', 'graphd.port'),
        '1\n',
        'utf8',
      )

      await expect(connect()).rejects.toBeInstanceOf(DaemonUnreachableError)
    })
  })

  describe('vault endpoints', () => {
    test('reads and mutates vault state through typed helpers', async () => {
      await start()
      const client = await connect()
      const docsPath = join(harness.vault, 'docs')
      const outPath = join(harness.vault, 'out')

      await mkdir(docsPath, { recursive: true })
      await mkdir(outPath, { recursive: true })

      await expect(client.getVault()).resolves.toEqual({
        vaultPath: harness.vault,
        readPaths: [],
        writePath: harness.vault,
      })

      await expect(client.addReadPath(docsPath)).resolves.toEqual({
        vaultPath: harness.vault,
        readPaths: [docsPath],
        writePath: harness.vault,
      })

      const afterWritePath = await client.setWritePath(outPath)
      expect(afterWritePath).toMatchObject({
        vaultPath: harness.vault,
        writePath: outPath,
      })
      expect(afterWritePath.readPaths).toEqual(expect.arrayContaining([docsPath]))

      const afterRemoveReadPath = await client.removeReadPath(docsPath)
      expect(afterRemoveReadPath).toMatchObject({
        vaultPath: harness.vault,
        writePath: outPath,
      })
      expect(afterRemoveReadPath.readPaths).not.toContain(docsPath)
    })

    test('surfaces daemon 4xx responses as GraphDbClientError', async () => {
      await start()
      const client = await connect()
      const missingPath = join(harness.vault, 'missing')

      await expect(client.addReadPath(missingPath)).rejects.toMatchObject({
        name: 'GraphDbClientError',
        status: 400,
        code: 'PATH_NOT_FOUND',
      })
    })
  })

  describe('graph endpoint', () => {
    test('sends wave 5 graph mutation helper request shapes', async () => {
      const calls: Array<{ body: unknown; headers: Headers; method: string; path: string }> = []

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
          const path = new URL(requestUrl).pathname
          const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
          const applyDeltaBody = body as { delta?: unknown[] } | undefined
          calls.push({
            body,
            headers: new Headers(init?.headers),
            method: init?.method ?? 'GET',
            path,
          })

          const responseByPath: Record<string, unknown> = {
            '/graph/apply-delta': { delta: applyDeltaBody?.delta ?? [], graph: {} },
            '/graph/context-node-from-selected-nodes': { nodeId: 'ctx.md' },
            '/graph/unseen-nodes-around-context-node': {
              nodes: [{ nodeId: 'node.md', content: '# Node' }],
            },
            '/graph/context-node-contained-ids': { updated: true },
          }

          return new Response(JSON.stringify(responseByPath[path]), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          })
        }),
      )

      const client = new GraphDbClient({ baseUrl: 'http://127.0.0.1:9191' })
      const delta = [{ type: 'DeleteNode', nodeId: 'old.md', deletedNode: { _tag: 'None' } }]

      await expect(
        client.applyGraphDelta(delta, { recordForUndo: false, sessionId: 'session-1' }),
      ).resolves.toBeUndefined()
      await expect(
        client.createContextNodeFromSelectedNodes('task.md', ['a.md', 'b.md']),
      ).resolves.toEqual({ nodeId: 'ctx.md' })
      await expect(client.getUnseenNodesAroundContextNode('ctx.md', 'task.md')).resolves.toEqual([
        { nodeId: 'node.md', content: '# Node' },
      ])
      await expect(
        client.updateContextNodeContainedIds('ctx.md', ['node.md']),
      ).resolves.toBeUndefined()

      expect(calls).toMatchObject([
        {
          body: { delta, recordForUndo: false },
          method: 'POST',
          path: '/graph/apply-delta',
        },
        {
          body: { taskNodeId: 'task.md', selectedNodeIds: ['a.md', 'b.md'] },
          method: 'POST',
          path: '/graph/context-node-from-selected-nodes',
        },
        {
          body: { contextNodeId: 'ctx.md', searchFromNode: 'task.md' },
          method: 'POST',
          path: '/graph/unseen-nodes-around-context-node',
        },
        {
          body: { contextNodeId: 'ctx.md', newNodeIds: ['node.md'] },
          method: 'PATCH',
          path: '/graph/context-node-contained-ids',
        },
      ])
      expect(calls[0].headers.get('X-Session-Id')).toBe('session-1')
    })

    test('returns graph state after watcher-driven updates', async () => {
      await start()
      const client = await connect()
      const docsPath = join(harness.vault, 'docs')
      const filePath = join(docsPath, 'hello.md')

      await mkdir(docsPath, { recursive: true })
      await client.addReadPath(docsPath)
      await writeFile(filePath, '# Hello\n\nwatch me\n', 'utf8')

      const graph = await waitFor(async () => {
        const value = await client.getGraph()
        return value.nodes[filePath] ? value : null
      })

      expect(graph.nodes[filePath]).toBeDefined()
    })

    test('creates context nodes and writes positions through graph helpers', async () => {
      await start()
      const client = await connect()
      const filePath = join(harness.vault, 'source.md')

      await writeFile(filePath, '# Source\n\nbody\n', 'utf8')

      await waitFor(async () => {
        const graph = await client.getGraph()
        return graph.nodes[filePath] ? true : null
      })

      const contextNode = await client.createContextNode(filePath, [])
      expect(contextNode.nodeId).toContain('ctx-nodes')
      await expect(readFile(contextNode.nodeId, 'utf8')).resolves.toContain('# ctx')

      await expect(
        client.writePositions({
          [filePath]: { x: 12.4, y: 99.6 },
          missing: { x: 1, y: 2 },
        }),
      ).resolves.toEqual({ written: 1 })

      const positions = JSON.parse(
        await readFile(join(harness.vault, '.voicetree', 'positions.json'), 'utf8'),
      )
      expect(positions[filePath]).toEqual({ x: 12, y: 100 })
      expect(positions.missing).toBeUndefined()
    })
  })

  describe('session endpoints', () => {
    test('round-trips create, read, state, collapse, selection, layout, expand, and delete', async () => {
      await start()
      const client = await connect()

      const created = await client.createSession()
      expect(created.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )

      await expect(client.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        collapseSetSize: 0,
        selectionSize: 0,
      })

      await expect(client.getSessionState(created.sessionId)).resolves.toMatchObject(
        {
          collapseSet: [],
          selection: [],
        },
      )

      await expect(client.collapse(created.sessionId, 'docs')).resolves.toHaveProperty('collapseSet')

      await expect(
        client.setSelection(created.sessionId, {
          nodeIds: ['alpha', 'beta'],
          mode: 'replace',
        }),
      ).resolves.toEqual({
        selection: ['alpha', 'beta'],
      })

      await expect(
        client.updateLayout(created.sessionId, {
          positions: {
            alpha: { x: 1, y: 2 },
          },
          pan: { x: 10, y: 20 },
          zoom: 1.25,
        }),
      ).resolves.toEqual({
        layout: {
          positions: {
            alpha: { x: 1, y: 2 },
          },
          pan: { x: 10, y: 20 },
          zoom: 1.25,
        },
      })

      await expect(client.expand(created.sessionId, 'docs')).resolves.toHaveProperty('collapseSet')

      await expect(client.deleteSession(created.sessionId)).resolves.toBeUndefined()

      await expect(client.getSession(created.sessionId)).rejects.toBeInstanceOf(
        GraphDbClientError,
      )
    })
  })

  describe('pinned-session sharing', () => {
    test('two clients sharing one sessionId see each others mutations', async () => {
      await start()
      const bootstrap = await connect()
      const { sessionId } = await bootstrap.createSession()
      const clientA = await connect(sessionId)
      const clientB = await connect(sessionId)

      await clientA.collapse(sessionId, 'docs')
      await expect(clientB.getSessionState(sessionId)).resolves.toMatchObject({
        collapseSet: ['docs'],
      })

      await clientB.setSelection(sessionId, {
        nodeIds: ['shared-node'],
        mode: 'replace',
      })
      await expect(clientA.getSessionState(sessionId)).resolves.toMatchObject({
        selection: ['shared-node'],
      })
    })
  })
})
