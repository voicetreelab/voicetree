import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'

describe('legacy routes gone', () => {
  let project: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'graphd-legacy-routes-test-'))
    handles = []
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(project, { recursive: true, force: true })
  })

  async function start(): Promise<DaemonHandle> {
    const handle = await startDaemon({ project })
    handles.push(handle)
    return handle
  }

  test('old collapse and read-path routes return 404', async () => {
    const handle = await start()
    const baseUrl = `http://127.0.0.1:${handle.port}`
    const sessionId = '00000000-0000-4000-8000-000000000000'

    await expect(fetch(`${baseUrl}/sessions/${sessionId}/collapse/docs`, { method: 'POST' }))
      .resolves.toHaveProperty('status', 404)
    await expect(fetch(`${baseUrl}/sessions/${sessionId}/collapse/docs`, { method: 'DELETE' }))
      .resolves.toHaveProperty('status', 404)
    await expect(fetch(`${baseUrl}/project/read-paths`, { method: 'POST' }))
      .resolves.toHaveProperty('status', 404)
    await expect(fetch(`${baseUrl}/project/read-paths/${encodeURIComponent(project)}`, { method: 'DELETE' }))
      .resolves.toHaveProperty('status', 404)
  })
})
