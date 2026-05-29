import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LayoutResponseSchema,
  SessionCreateResponseSchema,
} from '@vt/graph-db-server/contract'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'

async function withTempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-layout-test-'))
}

async function createSession(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/sessions`, {
    method: 'POST',
  })
  expect(response.status).toBe(201)
  const body = SessionCreateResponseSchema.parse(await response.json())
  return body.sessionId
}

describe('layout routes', () => {
  let project: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    project = await withTempProject()
    handles = []
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(project, { recursive: true, force: true })
  })

  const start = async (): Promise<DaemonHandle> => {
    const handle = await startDaemon({ project })
    handles.push(handle)
    return handle
  }

  test('PUT /sessions/:sessionId/layout merges positions and preserves omitted pan/zoom', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const seedResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/layout`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          positions: {
            alpha: { x: 1, y: 2 },
            beta: { x: 3, y: 4 },
          },
          pan: { x: 10, y: 20 },
          zoom: 1.5,
        }),
      },
    )

    expect(seedResponse.status).toBe(200)

    const mergeResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/layout`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          positions: {
            beta: { x: 30, y: 40 },
            gamma: { x: 5, y: 6 },
          },
        }),
      },
    )

    expect(mergeResponse.status).toBe(200)
    expect(LayoutResponseSchema.parse(await mergeResponse.json())).toEqual({
      layout: {
        positions: {
          alpha: { x: 1, y: 2 },
          beta: { x: 30, y: 40 },
          gamma: { x: 5, y: 6 },
        },
        pan: { x: 10, y: 20 },
        zoom: 1.5,
      },
    })
  })

  test('PUT /sessions/:sessionId/layout replaces pan and zoom when provided', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    await fetch(`http://127.0.0.1:${handle.port}/sessions/${sessionId}/layout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        positions: {
          alpha: { x: 1, y: 2 },
        },
        pan: { x: 10, y: 20 },
        zoom: 1.25,
      }),
    })

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/layout`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pan: { x: -5, y: 8 },
          zoom: 2,
        }),
      },
    )

    expect(response.status).toBe(200)
    expect(LayoutResponseSchema.parse(await response.json())).toEqual({
      layout: {
        positions: {
          alpha: { x: 1, y: 2 },
        },
        pan: { x: -5, y: 8 },
        zoom: 2,
      },
    })
  })

  test('PUT /sessions/:sessionId/layout rejects invalid body shape', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/layout`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pan: { x: 'bad', y: 2 },
        }),
      },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('PUT /sessions/:sessionId/layout returns 404 for a missing session', async () => {
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000/layout`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          zoom: 2,
        }),
      },
    )

    expect(response.status).toBe(404)
  })
})
