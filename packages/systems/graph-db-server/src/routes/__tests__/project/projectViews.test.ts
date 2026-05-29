import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'

async function createTempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-project-views-test-'))
}

describe('projectViews routes', () => {
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
    await rm(project, { recursive: true, force: true })
  })

  async function start(): Promise<DaemonHandle> {
    const handle = await startDaemon({ project })
    handles.push(handle)
    return handle
  }

  test('creates, lists, activates, clones, and deletes views', async () => {
    const handle = await start()
    const baseUrl = `http://127.0.0.1:${handle.port}`

    const initial = await (await fetch(`${baseUrl}/project/views`)).json()
    expect(initial).toMatchObject([{ name: 'main', isActive: true }])

    const created = await fetch(`${baseUrl}/project/views`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alt' }),
    })
    expect(created.status).toBe(200)
    const alt = await created.json() as { viewId: string; name: string; isActive: boolean }
    expect(alt).toMatchObject({ name: 'alt', isActive: false })

    const activated = await fetch(`${baseUrl}/project/views/${alt.viewId}/activate`, {
      method: 'POST',
    })
    expect(activated.status).toBe(200)
    expect(await activated.json()).toMatchObject({ viewId: alt.viewId, isActive: true })

    const deleteActive = await fetch(`${baseUrl}/project/views/${alt.viewId}`, {
      method: 'DELETE',
    })
    expect(deleteActive.status).toBe(409)
    expect(await deleteActive.json()).toMatchObject({ error: 'active view' })

    const cloned = await fetch(`${baseUrl}/project/views/${alt.viewId}/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'copy' }),
    })
    expect(cloned.status).toBe(200)
    const copy = await cloned.json() as { viewId: string }

    const deleted = await fetch(`${baseUrl}/project/views/${copy.viewId}`, {
      method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
  })
})
