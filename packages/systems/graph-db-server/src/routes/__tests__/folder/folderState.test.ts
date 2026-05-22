import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionCreateResponseSchema } from '../../../daemon/contract.ts'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { SessionRegistry } from '../../../application/session/registry.ts'
import { createDaemonApp } from '../../daemonApp.ts'
import {
  closeFolderVisibilityForVault,
  openFolderVisibilityForVault,
  updateCurrentFolderState,
} from '../../../data/views/folderVisibilityResource.ts'
import {
  clearWatchFolderState,
  setProjectRootWatchedDirectory,
} from '../../../state/watch-folder-store.ts'

async function createTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-folder-state-test-'))
}

async function createSession(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/sessions`, { method: 'POST' })
  expect(response.status).toBe(201)
  return SessionCreateResponseSchema.parse(await response.json()).sessionId
}

describe('folderState routes', () => {
  let vault: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    vault = await createTempVault()
    handles = []
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await closeFolderVisibilityForVault().catch(() => {})
    clearWatchFolderState()
    await rm(vault, { recursive: true, force: true })
  })

  async function start(): Promise<DaemonHandle> {
    const handle = await startDaemon({ vault })
    handles.push(handle)
    return handle
  }

  test('GET returns folderState and activeView for the session vault', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/folder-state`,
    )

    expect(response.status).toBe(200)
    // setWritePath seeds the writePath as 'expanded' on cold mount so the
    // sidebar can show its contents. Children default collapsed.
    expect(await response.json()).toMatchObject({
      folderState: [[vault, 'expanded']],
      activeView: { name: 'main' },
    })
  })

  test('PATCH single and batch write active-view rows', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)
    const docsPath = join(vault, 'docs')
    const srcPath = join(vault, 'src')
    const tmpPath = join(vault, 'tmp')
    const notesPath = join(vault, 'notes')

    const single = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/folder-state/${encodeURIComponent(docsPath)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'collapsed' }),
      },
    )
    expect(single.status).toBe(200)

    const batch = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/folder-state`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          updates: [
            { path: srcPath, state: 'expanded' },
            { path: tmpPath, state: 'hidden' },
            { path: notesPath, state: 'collapsed' },
          ],
        }),
      },
    )

    expect(batch.status).toBe(200)
    const body = await batch.json()
    // folderState is ordered by path ASC. The PATCHed rows are interleaved
    // with the seeded [vault, 'expanded'] writePath row (children of vault
    // sort after vault itself).
    expect(body.folderState).toEqual([
      [vault, 'expanded'],
      [docsPath, 'collapsed'],
      [notesPath, 'collapsed'],
      [srcPath, 'expanded'],
      [tmpPath, 'hidden'],
    ])
  })

  test('PATCH syncs the active session collapseSet used by projection', async () => {
    await openFolderVisibilityForVault(vault)
    setProjectRootWatchedDirectory(vault as never)
    const registry = new SessionRegistry()
    const app = createDaemonApp({
      registry,
      readHealth: () => ({
        version: 'test',
        vault,
        uptimeSeconds: 0,
        sessionCount: registry.size(),
        owner: null,
      }),
      onShutdown: () => {},
    })
    const session = registry.create()
    const docsPath = join(vault, 'docs')
    const notesPath = join(vault, 'notes')

    const collapsed = await app.request(
      `/sessions/${session.id}/folder-state/${encodeURIComponent(docsPath)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'collapsed' }),
      },
    )
    expect(collapsed.status).toBe(200)
    expect(registry.get(session.id)?.collapseSet).toEqual(new Set([`${docsPath}/`]))

    const batch = await app.request(
      `/sessions/${session.id}/folder-state`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          updates: [
            { path: docsPath, state: 'expanded' },
            { path: notesPath, state: 'collapsed' },
          ],
        }),
      },
    )
    expect(batch.status).toBe(200)
    expect(registry.get(session.id)?.collapseSet).toEqual(new Set([`${notesPath}/`]))
  })

  test('new sessions hydrate collapseSet from current folder visibility rows', async () => {
    await openFolderVisibilityForVault(vault)
    const docsPath = join(vault, 'docs')
    updateCurrentFolderState(docsPath, 'collapsed')

    const session = new SessionRegistry().create()

    expect(session.collapseSet).toEqual(new Set([`${docsPath}/`]))
  })
})
