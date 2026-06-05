import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { SessionRegistry } from '../../../application/session/registry.ts'
import { createDaemonApp } from '../../daemonApp.ts'
import {
  closeFolderVisibilityForProject,
  openFolderVisibilityForProject,
  updateCurrentFolderState,
} from '../../../data/views/folderVisibilityResource.ts'
import {
  clearWatchFolderState,
  setProjectRoot,
} from '../../../state/watch-folder-store.ts'
import {
  subscribeToProjectedGraph,
  type ProjectedGraphEvent,
} from '../../../state/events/projectedGraphEventBus.ts'

async function createTempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-folder-state-test-'))
}

async function createSession(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/sessions`, { method: 'POST' })
  expect(response.status).toBe(201)
  return SessionCreateResponseSchema.parse(await response.json()).sessionId
}

describe('folderState routes', () => {
  let project: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    project = await createTempProject()
    handles = []
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await closeFolderVisibilityForProject().catch(() => {})
    clearWatchFolderState()
    await rm(project, { recursive: true, force: true })
  })

  async function start(): Promise<DaemonHandle> {
    const handle = await startDaemon({ project })
    handles.push(handle)
    return handle
  }

  test('GET returns folderState and activeView for the session project', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/folder-state`,
    )

    expect(response.status).toBe(200)
    // setWriteFolderPath seeds the writeFolderPath as 'expanded' on cold mount so the
    // sidebar can show its contents. With no saved config the default
    // writeFolderPath is a `voicetree-{day}-{month}` subfolder of the project.
    const body = await response.json() as { folderState: [string, string][]; activeView: { name: string } }
    expect(body.activeView.name).toBe('main')
    const expandedRows: [string, string][] = body.folderState.filter(([, state]: [string, string]) => state === 'expanded')
    expect(expandedRows).toHaveLength(1)
    const [expandedPath] = expandedRows[0]
    expect(expandedPath).toMatch(new RegExp(`^${project}/voicetree-\\d{1,2}-\\d{1,2}(-\\d+)?$`))
  })

  test('PATCH single and batch write active-view rows', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)
    const docsPath = join(project, 'docs')
    const srcPath = join(project, 'src')
    const tmpPath = join(project, 'tmp')
    const notesPath = join(project, 'notes')

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
    const body = await batch.json() as { folderState: [string, string][] }
    // The PATCHed rows are interleaved (by path ASC) with the seeded
    // [<writeFolderPath>, 'expanded'] row. The default writeFolderPath for an
    // unconfigured project is a `voicetree-{day}-{month}` subfolder.
    const patchedRows: [string, string][] = body.folderState.filter(
      ([rowPath]: [string, string]) => rowPath === docsPath || rowPath === notesPath || rowPath === srcPath || rowPath === tmpPath,
    )
    expect(patchedRows).toEqual([
      [docsPath, 'collapsed'],
      [notesPath, 'collapsed'],
      [srcPath, 'expanded'],
      [tmpPath, 'hidden'],
    ])
    const seededExpanded: [string, string][] = body.folderState.filter(
      ([rowPath]: [string, string]) => rowPath.startsWith(`${project}/voicetree-`),
    )
    expect(seededExpanded).toHaveLength(1)
    expect(seededExpanded[0][1]).toBe('expanded')
  })

  test('PATCH syncs the active session collapseSet used by projection', async () => {
    await openFolderVisibilityForProject(project)
    setProjectRoot(project as never)
    const registry = new SessionRegistry()
    const app = createDaemonApp({
      registry,
      readHealth: () => ({
        version: 'test',
        project,
        uptimeSeconds: 0,
        sessionCount: registry.size(),
        owner: null,
      }),
      onShutdown: () => {},
    })
    const session = registry.create()
    const docsPath = join(project, 'docs')
    const notesPath = join(project, 'notes')

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

  test('PATCH collapsed broadcasts a re-projection to live renderers', async () => {
    await openFolderVisibilityForProject(project)
    setProjectRoot(project as never)
    const registry = new SessionRegistry()
    const app = createDaemonApp({
      registry,
      readHealth: () => ({
        version: 'test',
        project,
        uptimeSeconds: 0,
        sessionCount: registry.size(),
        owner: null,
      }),
      onShutdown: () => {},
    })
    const session = registry.create()
    const docsPath = join(project, 'docs')

    const broadcasts: ProjectedGraphEvent[] = []
    const unsubscribe = subscribeToProjectedGraph((event) => {
      if (event.sessionId === session.id) broadcasts.push(event)
    })

    try {
      const collapsed = await app.request(
        `/sessions/${session.id}/folder-state/${encodeURIComponent(docsPath)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'collapsed' }),
        },
      )
      expect(collapsed.status).toBe(200)
    } finally {
      unsubscribe()
    }

    // A `collapsed` transition changes the projection (hides loaded nodes) but
    // not the node set, so no graph delta fires. The route must therefore push
    // a fresh projection itself; otherwise live renderers never see the change.
    expect(broadcasts.length).toBeGreaterThan(0)
  })

  test('new sessions hydrate collapseSet from current folder visibility rows', async () => {
    await openFolderVisibilityForProject(project)
    const docsPath = join(project, 'docs')
    updateCurrentFolderState(docsPath, 'collapsed')

    const session = new SessionRegistry().create()

    expect(session.collapseSet).toEqual(new Set([`${docsPath}/`]))
  })
})
