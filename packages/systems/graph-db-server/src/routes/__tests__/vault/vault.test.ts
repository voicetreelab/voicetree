import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyGraph } from '@vt/graph-model'
import { clearWatchFolderState } from '../../../state/watch-folder-store.ts'
import { setGraph } from '../../../state/graph-store.ts'
import { startDaemon, type DaemonHandle } from '../../../daemon/server.ts'
import {
  beginVaultOpen,
  completeVaultOpen,
} from '../../../application/workflows/vaultOpenGate.ts'

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
    // setWriteFolder seeds the active view's folder-visibility table with the
    // writeFolder itself (so the sidebar can show the writeFolder's contents on
    // mount). Children default collapsed — only the writeFolder row appears.
    expect(await response.json()).toEqual({
      projectRoot: vault,
      readPaths: [vault],
      writeFolder: vault,
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
    expect(await response.json()).toEqual({ writeFolder: outPath })
    expect(await vaultState.json()).toMatchObject({
      projectRoot: vault,
      writeFolder: outPath,
    })
  })

  test('POST /vault/open applies writeFolder when re-opening the active vault', async () => {
    const outPath = join(vault, 'out')
    await mkdir(outPath, { recursive: true })
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/vault/open`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: vault, writeFolder: outPath }),
      },
    )
    const vaultState = await fetch(`http://127.0.0.1:${handle.port}/vault`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ writeFolder: outPath })
    expect(await vaultState.json()).toMatchObject({
      projectRoot: vault,
      writeFolder: outPath,
    })
  })

  test('GET /vault waits for an in-flight openVaultWorkflow before reading state', async () => {
    const handle = await start()

    // Simulate an in-flight open by flipping the gate on directly. The daemon
    // has already finished its startup open, so projectRoot IS set — but the
    // gate forces readers to await completion regardless. This proves the
    // wiring: a renderer landing here mid vault-switch will not race onto the
    // bare `getProjectRoot()` check.
    beginVaultOpen()

    let readResolved = false
    const reader = fetch(`http://127.0.0.1:${handle.port}/vault`).then(
      async (response): Promise<unknown> => {
        readResolved = true
        return await response.json()
      },
    )

    // Yield to the event loop so the read is unambiguously waiting.
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 50)
    })
    expect(readResolved).toBe(false)

    completeVaultOpen()
    const body = await reader
    expect(readResolved).toBe(true)
    expect(body).toEqual({
      projectRoot: vault,
      readPaths: [vault],
      writeFolder: vault,
    })
  })

  test('GET /vault still 409s when no vault is open and no open is pending', async () => {
    // Start a daemon WITHOUT a vault: HTTP up, projectRoot null, gate empty.
    const vaultless = await startDaemon({})
    handles.push(vaultless)

    const response = await fetch(`http://127.0.0.1:${vaultless.port}/vault`)
    expect(response.status).toBe(409)
    const body = await response.json() as { error?: { code?: string } }
    expect(body.error?.code).toBe('vault_not_open')
  })

})
