import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearWatchFolderState,
  createEmptyGraph,
  setGraph,
} from '@vt/graph-model'
import { startDaemon, type DaemonHandle } from '../server.ts'

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

describe('vault routes', () => {
  let vault: string
  let appSupportPath: string
  let handles: DaemonHandle[]
  let originalAppSupportPath: string | undefined

  beforeEach(async () => {
    vault = await makeTempDir('graphd-vault-')
    appSupportPath = await makeTempDir('graphd-app-support-')
    handles = []
    originalAppSupportPath = process.env.VOICETREE_APP_SUPPORT
    process.env.VOICETREE_APP_SUPPORT = appSupportPath
    clearWatchFolderState()
    setGraph(createEmptyGraph())
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    handles = []
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    if (originalAppSupportPath === undefined) {
      delete process.env.VOICETREE_APP_SUPPORT
    } else {
      process.env.VOICETREE_APP_SUPPORT = originalAppSupportPath
    }
    await rm(vault, { recursive: true, force: true })
    await rm(appSupportPath, { recursive: true, force: true })
  })

  const start = async (): Promise<DaemonHandle> => {
    const handle = await startDaemon({ vault })
    handles.push(handle)
    return handle
  }

  test('GET /vault returns mounted vault state after cold start', async () => {
    const handle = await start()

    const response = await fetch(`http://127.0.0.1:${handle.port}/vault`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      vaultPath: vault,
      readPaths: [],
      writePath: vault,
    })
  })

  test('POST /vault/read-paths adds an existing directory', async () => {
    const docsPath = join(vault, 'docs')
    await mkdir(docsPath, { recursive: true })
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/vault/read-paths`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: docsPath }),
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      readPaths: [docsPath],
    })
  })

  test('POST /vault/read-paths is idempotent for duplicates', async () => {
    const docsPath = join(vault, 'docs')
    await mkdir(docsPath, { recursive: true })
    const handle = await start()

    const url = `http://127.0.0.1:${handle.port}/vault/read-paths`
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: docsPath }),
    })
    const secondResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: docsPath }),
    })

    expect(secondResponse.status).toBe(200)
    expect(await secondResponse.json()).toEqual({
      readPaths: [docsPath],
    })
  })

  test('PUT /vault/write-path updates the write path', async () => {
    const outPath = join(vault, 'out')
    await mkdir(outPath, { recursive: true })
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/vault/write-path`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: outPath }),
      },
    )
    const vaultState = await fetch(`http://127.0.0.1:${handle.port}/vault`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ writePath: outPath })
    expect(await vaultState.json()).toMatchObject({
      vaultPath: vault,
      writePath: outPath,
    })
  })

  test('DELETE /vault/read-paths removes the read path', async () => {
    const docsPath = join(vault, 'docs')
    await mkdir(docsPath, { recursive: true })
    const handle = await start()

    await fetch(`http://127.0.0.1:${handle.port}/vault/read-paths`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: docsPath }),
    })

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/vault/read-paths/${encodeURIComponent(docsPath)}`,
      {
        method: 'DELETE',
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ readPaths: [] })
  })

  test('POST /vault/read-paths rejects traversal paths', async () => {
    const handle = await start()
    const traversalPath = `${vault}/../escape`

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/vault/read-paths`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: traversalPath }),
      },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Path traversal is not allowed',
      code: 'PATH_TRAVERSAL',
    })
  })

  test('POST /vault/read-paths rejects missing paths', async () => {
    const handle = await start()
    const missingPath = join(vault, 'missing')

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/vault/read-paths`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: missingPath }),
      },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Path does not exist',
      code: 'PATH_NOT_FOUND',
    })
  })

  test('daemon routes keep the same vault mutation surface as the IPC API', async () => {
    const apiSource = await readFile(
      new URL('../../../../webapp/src/shell/edge/main/api.ts', import.meta.url),
      'utf8',
    )

    expect(apiSource).toContain('getVaultPaths')
    expect(apiSource).toContain('getReadPaths')
    expect(apiSource).toContain('getWritePath')
    expect(apiSource).toContain('setWritePath')
    expect(apiSource).toContain('addReadPath')
    expect(apiSource).toContain('removeReadPath')
  })
})
