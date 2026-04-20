import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import {
  SelectionResponseSchema,
  SessionCreateResponseSchema,
} from '../contract.ts'
import { type DaemonHandle, startDaemon } from '../server.ts'
import { SessionRegistry } from '../session/registry.ts'
import { mountSelectionRoutes } from './selection.ts'

async function withTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-selection-test-'))
}

async function createSession(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
    method: 'POST',
  })
  expect(response.status).toBe(201)
  const body = SessionCreateResponseSchema.parse(await response.json())
  return body.sessionId
}

describe('selection routes', () => {
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

  test('POST /sessions/:sessionId/selection supports replace, add, and remove', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const replaceResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: ['a', 'b'], mode: 'replace' }),
      },
    )

    expect(replaceResponse.status).toBe(200)
    expect(
      SelectionResponseSchema.parse(await replaceResponse.json()),
    ).toEqual({ selection: ['a', 'b'] })

    const addResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: ['b', 'c'], mode: 'add' }),
      },
    )

    expect(addResponse.status).toBe(200)
    expect(SelectionResponseSchema.parse(await addResponse.json())).toEqual({
      selection: ['a', 'b', 'c'],
    })

    const removeResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: ['b'], mode: 'remove' }),
      },
    )

    expect(removeResponse.status).toBe(200)
    expect(
      SelectionResponseSchema.parse(await removeResponse.json()),
    ).toEqual({ selection: ['a', 'c'] })
  })

  test('POST /sessions/:sessionId/selection rejects invalid mode', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: ['a'], mode: 'noop' }),
      },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('POST /sessions/:sessionId/selection rejects invalid body shape', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: 'a', mode: 'replace' }),
      },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('POST /sessions/:sessionId/selection returns 404 for a missing session', async () => {
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: ['a'], mode: 'replace' }),
      },
    )

    expect(response.status).toBe(404)
  })

  test('selection mutations touch lastAccessedAt after the session lookup', async () => {
    const registry = new SessionRegistry()
    const session = registry.create()
    session.lastAccessedAt = 100

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(200).mockReturnValueOnce(300)

    const app = new Hono()
    mountSelectionRoutes(app, registry)

    const response = await app.fetch(
      new Request(`http://localhost/sessions/${session.id}/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeIds: ['a'], mode: 'replace' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(session.lastAccessedAt).toBe(300)
  })
})
