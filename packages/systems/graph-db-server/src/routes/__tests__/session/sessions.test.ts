import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import {
  HealthResponseSchema,
  SessionCreateResponseSchema,
  SessionInfoSchema,
} from '@vt/graph-db-server/contract'

async function withTempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-sessions-test-'))
}

describe('session routes', () => {
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

  test('create, read, delete, and health sessionCount round-trip', async () => {
    const handle = await startDaemon({ project })
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
    // setWriteFolderPath seeds the writeFolderPath as 'expanded' on cold mount, so a
    // freshly-created session sees one folder-state row (the writeFolderPath).
    expect(info.folderStateSize).toBe(1)
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
    const handle = await startDaemon({ project })
    handles.push(handle)

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000`,
    )

    expect(response.status).toBe(404)
  })

  test('show reports the folder-state size written via the PATCH route', async () => {
    // Regression: `session show` previously resolved the folder-state size
    // through a fresh independent db handle (`getFolderStateForActiveView`),
    // whose independent active-view resolution could diverge from the handle the
    // PATCH writer uses — pinning the reported size to 0 even after writes. This
    // proves the reader now observes the writer's rows through the same handle.
    const handle = await startDaemon({ project })
    handles.push(handle)

    const sessionId = SessionCreateResponseSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${handle.port}/sessions`, { method: 'POST' })
      ).json(),
    ).sessionId

    // Baseline: the cold-mount seed expands the writeFolderPath → one row.
    const before = SessionInfoSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${handle.port}/sessions/${sessionId}`)
      ).json(),
    )
    expect(before.folderStateSize).toBe(1)

    // Write two distinct folder-visibility rows through the PATCH writer path.
    const docsPath = join(project, 'docs')
    const srcPath = join(project, 'src')
    const batch = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/folder-state`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          updates: [
            { path: docsPath, state: 'collapsed' },
            { path: srcPath, state: 'hidden' },
          ],
        }),
      },
    )
    expect(batch.status).toBe(200)

    // show must now observe seed(1) + the two PATCHed rows = 3.
    const after = SessionInfoSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${handle.port}/sessions/${sessionId}`)
      ).json(),
    )
    expect(after.folderStateSize).toBe(3)
  })
})
