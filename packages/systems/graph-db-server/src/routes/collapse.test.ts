import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import {
  CollapseStateResponseSchema,
  SessionCreateResponseSchema,
} from '../contract.ts'
import { type DaemonHandle, startDaemon } from '../server.ts'
import { SessionRegistry } from '../session/registry.ts'
import { mountCollapseRoutes } from './collapse.ts'

async function withTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-collapse-test-'))
}

async function createSession(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
    method: 'POST',
  })
  expect(response.status).toBe(201)
  const body = SessionCreateResponseSchema.parse(await response.json())
  return body.sessionId
}

describe('collapse routes', () => {
  let vault: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    vault = await withTempVault()
    handles = []
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(vault, { recursive: true, force: true })
  })

  const start = async (): Promise<DaemonHandle> => {
    const handle = await startDaemon({ vault })
    handles.push(handle)
    return handle
  }

  test('POST /sessions/:sessionId/collapse/:folderId adds folderId to the session collapseSet', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/collapse/docs`,
      { method: 'POST' },
    )

    expect(response.status).toBe(200)
    const body = CollapseStateResponseSchema.parse(await response.json())
    expect(body.collapseSet).toEqual(['docs'])
  })

  test('DELETE /sessions/:sessionId/collapse/:folderId removes folderId from the session collapseSet', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/collapse/docs`,
      { method: 'POST' },
    )

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/collapse/docs`,
      { method: 'DELETE' },
    )

    expect(response.status).toBe(200)
    const body = CollapseStateResponseSchema.parse(await response.json())
    expect(body.collapseSet).toEqual([])
  })

  test('collapsing an already-collapsed folder is idempotent', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)
    const url = `http://127.0.0.1:${handle.port}/sessions/${sessionId}/collapse/docs`

    await fetch(url, { method: 'POST' })
    const response = await fetch(url, { method: 'POST' })

    expect(response.status).toBe(200)
    const body = CollapseStateResponseSchema.parse(await response.json())
    expect(body.collapseSet).toEqual(['docs'])
  })

  test('sessions remain isolated from each other', async () => {
    const handle = await start()
    const sessionA = await createSession(handle.port)
    const sessionB = await createSession(handle.port)

    await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionA}/collapse/docs`,
      { method: 'POST' },
    )
    await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionB}/collapse/assets`,
      { method: 'POST' },
    )

    const responseA = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionA}/collapse/docs`,
      { method: 'POST' },
    )
    const responseB = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionB}/collapse/assets`,
      { method: 'POST' },
    )

    expect(CollapseStateResponseSchema.parse(await responseA.json())).toEqual({
      collapseSet: ['docs'],
    })
    expect(CollapseStateResponseSchema.parse(await responseB.json())).toEqual({
      collapseSet: ['assets'],
    })
  })

  test('mutating a nonexistent session returns 404', async () => {
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000/collapse/docs`,
      { method: 'POST' },
    )

    expect(response.status).toBe(404)
  })

  test('collapse mutations touch lastAccessedAt after the session lookup', async () => {
    const registry = new SessionRegistry()
    const session = registry.create()
    session.lastAccessedAt = 100

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(200).mockReturnValueOnce(300)

    const app = new Hono()
    mountCollapseRoutes(app, registry)

    const response = await app.fetch(
      new Request(`http://localhost/sessions/${session.id}/collapse/docs`, {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(session.lastAccessedAt).toBe(300)
  })
})
