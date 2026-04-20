import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../server.ts'
import {
  LiveStateSnapshotSchema,
  SessionCreateResponseSchema,
} from '../contract.ts'

async function withTempVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), 'graphd-session-state-test-'))
  await mkdir(join(vault, 'docs'), { recursive: true })
  await writeFile(join(vault, 'docs', 'one.md'), '# one')
  return vault
}

describe('GET /sessions/:sessionId/state', () => {
  let vault: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    vault = await withTempVault()
    handles = []
  })

  afterEach(async () => {
    for (const h of handles) await h.stop().catch(() => {})
    await rm(vault, { recursive: true, force: true })
  })

  test('returns a schema-valid snapshot with the expected top-level keys', async () => {
    const handle = await startDaemon({ vault })
    handles.push(handle)

    const created = await fetch(`http://127.0.0.1:${handle.port}/sessions`, {
      method: 'POST',
    })
    expect(created.status).toBe(201)
    const { sessionId } = SessionCreateResponseSchema.parse(await created.json())

    const res = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/state`,
    )
    expect(res.status).toBe(200)
    const body = LiveStateSnapshotSchema.parse(await res.json())

    expect(body.meta.schemaVersion).toBe(1)
    expect(body.collapseSet).toEqual([])
    expect(body.selection).toEqual([])
    expect(Array.isArray(body.roots.folderTree)).toBe(true)
    expect(Array.isArray(body.roots.loaded)).toBe(true)
    expect(typeof body.graph.nodes).toBe('object')
  })

  test('returns 404 for unknown session', async () => {
    const handle = await startDaemon({ vault })
    handles.push(handle)

    const res = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000/state`,
    )
    expect(res.status).toBe(404)
  })
})
