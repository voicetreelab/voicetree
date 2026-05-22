import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyGraph } from '@vt/graph-model'
import { clearWatchFolderState } from '../../../state/watch-folder-store.ts'
import { setGraph } from '../../../state/graph-store.ts'
import { startDaemon, type DaemonHandle } from '../../../daemon/server.ts'

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
    // setWritePath seeds the active view's folder-visibility table with the
    // writePath itself (so the sidebar can show the writePath's contents on
    // mount). Children default collapsed — only the writePath row appears.
    expect(await response.json()).toEqual({
      vaultPath: vault,
      readPaths: [vault],
      writePath: vault,
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

})
