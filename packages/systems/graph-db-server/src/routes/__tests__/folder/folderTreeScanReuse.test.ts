// BF-334 · Behavioural regression coverage for daemon-folder-tree scan reuse.
//
// We inject a counting scanner via `startDaemon({ folderTreeScanner })` and
// then assert that the count stays bounded across repeated /state and
// /projected-graph reads, and that explicit invalidation (chokidar add/unlink
// events) is what triggers a fresh scan. There is no `vi.mock` of any internal
// module — the test seam is the public `folderTreeScanner` option, and
// observations are made on the scanner closure's own counter.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AbsolutePath, DirectoryEntry } from '@vt/graph-model/folders'
import { toAbsolutePath } from '@vt/graph-model/folders'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import { handleFSEventWithStateAndUISides } from '../../../data/graph/watching/handleFSEvent.ts'

type CountingScanner = {
  readonly fn: (root: AbsolutePath, maxDepth: number) => Promise<DirectoryEntry | null>
  callCount(): number
}

function buildEmptyDirectoryEntry(root: AbsolutePath): DirectoryEntry {
  return {
    absolutePath: root,
    name: root.replace(/.*\//, '') || root,
    isDirectory: true,
    children: [],
  }
}

function createCountingScanner(): CountingScanner {
  let count = 0
  return {
    callCount: () => count,
    async fn(root: AbsolutePath): Promise<DirectoryEntry | null> {
      count += 1
      return buildEmptyDirectoryEntry(root)
    },
  }
}

async function withTempProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'graphd-scan-reuse-test-'))
  await writeFile(join(project, 'one.md'), '# one')
  return project
}

async function createSession(base: string): Promise<string> {
  const created = await fetch(`${base}/sessions`, { method: 'POST' })
  expect(created.status).toBe(201)
  const { sessionId } = SessionCreateResponseSchema.parse(await created.json())
  return sessionId
}

describe('daemon folder-tree scan reuse', () => {
  let project: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    project = await withTempProject()
    handles = []
  })

  afterEach(async () => {
    for (const h of handles) await h.stop().catch(() => {})
    await rm(project, { recursive: true, force: true })
  })

  test('two /state reads share one scan', async () => {
    const scanner = createCountingScanner()
    const handle = await startDaemon({ project, folderTreeScanner: scanner.fn })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`
    const countBefore = scanner.callCount()

    const sessionId = await createSession(base)
    await fetch(`${base}/sessions/${sessionId}/state`).then(r => r.json())
    const afterFirst = scanner.callCount()
    await fetch(`${base}/sessions/${sessionId}/state`).then(r => r.json())
    const afterSecond = scanner.callCount()

    // First read may or may not scan depending on whether `/state` actually
    // needs the read model (it does); the contract is that the second read
    // MUST NOT trigger a fresh scan.
    expect(afterFirst).toBeGreaterThanOrEqual(countBefore + 1)
    expect(afterSecond).toBe(afterFirst)
  })

  test('/projected-graph does not invoke the folder-tree scanner', async () => {
    const scanner = createCountingScanner()
    const handle = await startDaemon({ project, folderTreeScanner: scanner.fn })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`

    const sessionId = await createSession(base)
    const countBefore = scanner.callCount()

    // Three projected-graph reads in a row should remain cache-or-pure;
    // graph-derived projection means projected reads SHALL never scan.
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${base}/sessions/${sessionId}/projected-graph`)
      expect(res.status).toBe(200)
      await res.json()
    }

    expect(scanner.callCount()).toBe(countBefore)
  })

  test('/state followed by /projected-graph reuses the folder-tree cache', async () => {
    const scanner = createCountingScanner()
    const handle = await startDaemon({ project, folderTreeScanner: scanner.fn })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`

    const sessionId = await createSession(base)
    await fetch(`${base}/sessions/${sessionId}/state`).then(r => r.json())
    const afterState = scanner.callCount()
    await fetch(`${base}/sessions/${sessionId}/projected-graph`).then(r => r.json())
    await fetch(`${base}/sessions/${sessionId}/projected-graph`).then(r => r.json())

    expect(scanner.callCount()).toBe(afterState)
  })

  test('chokidar add event invalidates the read model and forces a fresh scan', async () => {
    const scanner = createCountingScanner()
    const handle = await startDaemon({ project, folderTreeScanner: scanner.fn })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`

    const sessionId = await createSession(base)
    await fetch(`${base}/sessions/${sessionId}/state`).then(r => r.json())
    const afterFirst = scanner.callCount()

    handleFSEventWithStateAndUISides(
      {
        absolutePath: toAbsolutePath(join(project, 'two.md')),
        content: '# two',
        eventType: 'Added',
      },
      project,
    )

    await fetch(`${base}/sessions/${sessionId}/state`).then(r => r.json())
    expect(scanner.callCount()).toBe(afterFirst + 1)
  })

  test('content-only change does NOT invalidate the folder-tree cache', async () => {
    const scanner = createCountingScanner()
    const notePath = toAbsolutePath(join(project, 'one.md'))
    const handle = await startDaemon({ project, folderTreeScanner: scanner.fn })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`

    const sessionId = await createSession(base)
    await fetch(`${base}/sessions/${sessionId}/state`).then(r => r.json())
    const afterFirst = scanner.callCount()

    handleFSEventWithStateAndUISides(
      { absolutePath: notePath, content: '# one v2', eventType: 'Changed' },
      project,
    )

    await fetch(`${base}/sessions/${sessionId}/state`).then(r => r.json())
    expect(scanner.callCount()).toBe(afterFirst)
  })
})
