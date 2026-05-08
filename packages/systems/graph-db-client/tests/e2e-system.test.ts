import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

describe('@vt/graph-db-client system contract', () => {
  let root: string
  let vault: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphdb-client-system-'))
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

  it('uses typed client helpers against a live daemon and shared session', async () => {
    handle = await startDaemon({
      vault,
      appSupportPath: path.join(root, 'app-support'),
    })
    const client = await GraphDbClient.connect({ vault })

    await expect(client.health()).resolves.toMatchObject({ vault })
    await expect(client.addReadPath(path.join(vault, 'missing'))).rejects.toMatchObject({
      name: 'GraphDbClientError',
      status: 400,
      code: 'PATH_NOT_FOUND',
    })

    const docs = path.join(vault, 'docs')
    await mkdir(docs, { recursive: true })
    await expect(client.addReadPath(docs)).resolves.toMatchObject({
      readPaths: [docs],
      vaultPath: vault,
    })

    const notePath = path.join(docs, 'alpha.md')
    await writeFile(notePath, '# Alpha\n\nClient watched content.\n', 'utf8')
    const graph = await waitFor(async () => {
      const value = await client.getGraph()
      return value.nodes[notePath] ? value : null
    })
    expect(graph.nodes[notePath]).toBeDefined()

    const { sessionId } = await client.createSession()
    const clientA = await GraphDbClient.connect({ vault, sessionId })
    const clientB = await GraphDbClient.connect({ vault, sessionId })

    await expect(clientA.collapse(sessionId, `${docs}/`)).resolves.toHaveProperty('nodes')
    await expect(clientB.setSelection(sessionId, {
      nodeIds: [notePath],
      mode: 'replace',
    })).resolves.toEqual({
      selection: [notePath],
    })
    await expect(clientA.updateLayout(sessionId, {
      positions: { [notePath]: { x: 5, y: 7 } },
      zoom: 1.25,
      pan: { x: 1, y: 2 },
    })).resolves.toMatchObject({
      layout: {
        positions: { [notePath]: { x: 5, y: 7 } },
      },
    })

    await expect(clientB.getSessionState(sessionId)).resolves.toMatchObject({
      collapseSet: [`${docs}/`],
      selection: [notePath],
    })

    await client.deleteSession(sessionId)
    await expect(clientA.getSession(sessionId)).rejects.toBeInstanceOf(GraphDbClientError)

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
