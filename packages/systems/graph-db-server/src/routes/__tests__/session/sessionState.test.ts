import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import {
  LiveStateSnapshotSchema,
  SessionCreateResponseSchema,
} from '../../../daemon/contract.ts'

// Files placed at the vault root are always visible in the projection;
// files inside subdirectories require explicit folder expansion via
// folderState, which a fresh session does not have.
async function withTempVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), 'graphd-session-state-test-'))
  await writeFile(join(vault, 'one.md'), '# one')
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
    // setWritePath seeds the writePath as 'expanded' so the sidebar can show
    // its contents on mount. Children remain collapsed by default.
    expect(body.folderState).toEqual([[vault, 'expanded']])
    expect(body.activeView.name).toBe('main')
    expect(body.selection).toEqual([])
    expect(Array.isArray(body.roots.folderTree)).toBe(true)
    expect(typeof body.graph.nodes).toBe('object')
  })

  test('omits graph node markdown content when content=omit is requested', async () => {
    const handle = await startDaemon({ vault })
    handles.push(handle)

    const created = await fetch(`http://127.0.0.1:${handle.port}/sessions`, {
      method: 'POST',
    })
    expect(created.status).toBe(201)
    const { sessionId } = SessionCreateResponseSchema.parse(await created.json())

    const fullRes = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/state`,
    )
    expect(fullRes.status).toBe(200)
    const fullBody = LiveStateSnapshotSchema.parse(await fullRes.json())
    const notePath = join(vault, 'one.md')
    expect(fullBody.graph.nodes[notePath]).toHaveProperty('contentWithoutYamlOrLinks')

    const omittedRes = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/${sessionId}/state?content=omit`,
    )
    expect(omittedRes.status).toBe(200)
    const omittedBody = LiveStateSnapshotSchema.parse(await omittedRes.json())

    expect(omittedBody.graph.nodes[notePath]).toBeDefined()
    expect(omittedBody.graph.nodes[notePath]).not.toHaveProperty('contentWithoutYamlOrLinks')
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
