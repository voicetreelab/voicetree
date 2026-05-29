import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SelectionResponseSchema,
  SessionCreateResponseSchema,
} from '@vt/graph-db-server/contract'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'

async function withTempProject(): Promise<string> {
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

  test('POST /sessions/:sessionId/selection updates the selection', async () => {
    const handle = await start()
    const sessionId = await createSession(handle.port)

    const replaceResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeIds: ['alpha', 'beta'],
          mode: 'replace',
        }),
      },
    )

    expect(replaceResponse.status).toBe(200)
    expect(SelectionResponseSchema.parse(await replaceResponse.json())).toEqual({
      selection: ['alpha', 'beta'],
    })

    const removeResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/selection`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeIds: ['alpha'],
          mode: 'remove',
        }),
      },
    )

    expect(removeResponse.status).toBe(200)
    expect(SelectionResponseSchema.parse(await removeResponse.json())).toEqual({
      selection: ['beta'],
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
        body: JSON.stringify({
          nodeIds: ['alpha'],
          mode: 'toggle',
        }),
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
        body: JSON.stringify({
          nodeIds: ['alpha'],
          mode: 'replace',
        }),
      },
    )

    expect(response.status).toBe(404)
  })
})
