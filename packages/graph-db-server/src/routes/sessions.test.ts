import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../server.ts'
import {
  HealthResponseSchema,
  SessionCreateResponseSchema,
  SessionInfoSchema,
} from '../contract.ts'

async function withTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-sessions-test-'))
}

describe('session routes', () => {
  let vault: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    vault = await withTempVault()
    handles = []
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(vault, { recursive: true, force: true })
  })

  test('create, read, delete, and health sessionCount round-trip', async () => {
    const handle = await startDaemon({ vault })
    handles.push(handle)

    const createResponse = await fetch(`http://127.0.0.1:${handle.port}/sessions`, {
      method: 'POST',
    })
    expect(createResponse.status).toBe(201)
    const createBody = SessionCreateResponseSchema.parse(
      await createResponse.json(),
    )

    const getResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${createBody.sessionId}`,
    )
    expect(getResponse.status).toBe(200)
    const info = SessionInfoSchema.parse(await getResponse.json())
    expect(info.id).toBe(createBody.sessionId)
    expect(info.collapseSetSize).toBe(0)
    expect(info.selectionSize).toBe(0)

    const healthAfterCreate = HealthResponseSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${handle.port}/health`)
      ).json(),
    )
    expect(healthAfterCreate.sessionCount).toBe(1)

    const deleteResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${createBody.sessionId}`,
      { method: 'DELETE' },
    )
    expect(deleteResponse.status).toBe(204)

    const missingResponse = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${createBody.sessionId}`,
    )
    expect(missingResponse.status).toBe(404)

    const healthAfterDelete = HealthResponseSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${handle.port}/health`)
      ).json(),
    )
    expect(healthAfterDelete.sessionCount).toBe(0)
  })

  test('missing session returns 404', async () => {
    const handle = await startDaemon({ vault })
    handles.push(handle)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000`,
    )

    expect(response.status).toBe(404)
  })
})
