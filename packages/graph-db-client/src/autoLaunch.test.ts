import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  clearWatchFolderState,
  createEmptyGraph,
  setGraph,
} from '@vt/graph-model'
import {
  type DaemonHandle,
  startDaemon,
} from '../../graph-db-server/src/server.ts'
import { ensureDaemon } from './autoLaunch.ts'
import { GraphDbClient } from './GraphDbClient.ts'

type Harness = {
  appSupportPath: string
  root: string
  vault: string
}

async function createHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'graph-db-client-autolaunch-'))
  const appSupportPath = join(root, 'app-support')
  const vault = join(root, 'vault')
  await mkdir(appSupportPath, { recursive: true })
  await mkdir(vault, { recursive: true })
  return { appSupportPath, root, vault }
}

async function waitUntilMissing(
  path: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
    } catch {
      return true
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

describe('ensureDaemon — reuse path (no spawn)', () => {
  let harness: Harness
  let handles: DaemonHandle[]
  let originalAppSupportPath: string | undefined

  beforeEach(async () => {
    harness = await createHarness()
    handles = []
    originalAppSupportPath = process.env.VOICETREE_APP_SUPPORT
    process.env.VOICETREE_APP_SUPPORT = harness.appSupportPath
    clearWatchFolderState()
    setGraph(createEmptyGraph())
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    if (originalAppSupportPath === undefined) {
      delete process.env.VOICETREE_APP_SUPPORT
    } else {
      process.env.VOICETREE_APP_SUPPORT = originalAppSupportPath
    }
    await rm(harness.root, { recursive: true, force: true })
  })

  test('reuses an in-process daemon without spawning', async () => {
    const handle = await startDaemon({ vault: harness.vault })
    handles.push(handle)

    const result = await ensureDaemon(harness.vault)
    expect(result).toEqual({
      port: handle.port,
      pid: null,
      launched: false,
    })

    const client = new GraphDbClient({
      baseUrl: `http://127.0.0.1:${result.port}`,
    })
    await expect(client.health()).resolves.toMatchObject({
      vault: harness.vault,
    })
  })
})

describe.skipIf(process.env.CI_SANDBOX === '1')(
  'ensureDaemon — cold-start spawn path',
  () => {
    let harness: Harness
    let handles: DaemonHandle[]
    let originalAppSupportPath: string | undefined
    const extraRoots: string[] = []

    beforeEach(async () => {
      harness = await createHarness()
      handles = []
      originalAppSupportPath = process.env.VOICETREE_APP_SUPPORT
      process.env.VOICETREE_APP_SUPPORT = harness.appSupportPath
      clearWatchFolderState()
      setGraph(createEmptyGraph())
    })

    afterEach(async () => {
      for (const handle of handles) {
        await handle.stop().catch(() => {})
      }
      clearWatchFolderState()
      setGraph(createEmptyGraph())
      if (originalAppSupportPath === undefined) {
        delete process.env.VOICETREE_APP_SUPPORT
      } else {
        process.env.VOICETREE_APP_SUPPORT = originalAppSupportPath
      }
      await Promise.all(
        extraRoots.splice(0).map((root) =>
          rm(root, { recursive: true, force: true }),
        ),
      )
      await rm(harness.root, { recursive: true, force: true })
    })

    test('spawns vt-graphd + round-trips getVault, then shuts down cleanly', async () => {
      const portFile = join(harness.vault, '.voicetree', 'graphd.port')
      const lockFile = join(harness.vault, '.voicetree', 'graphd.lock')

      let result
      try {
        result = await ensureDaemon(harness.vault, { timeoutMs: 8000 })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'EACCES' || code === 'EPERM') {
          console.warn(
            '[L2 TODO] Codex sandbox blocked spawn — see feedback_codex_sandbox_ports.md',
          )
          return
        }
        throw err
      }

      expect(result.launched).toBe(true)
      expect(result.port).toBeGreaterThan(0)
      expect(result.port).not.toBe(3001)
      expect(result.port).not.toBe(3002)
      expect(result.pid).toBeTypeOf('number')

      await expect(access(portFile)).resolves.toBeUndefined()
      await expect(access(lockFile)).resolves.toBeUndefined()

      const client = new GraphDbClient({
        baseUrl: `http://127.0.0.1:${result.port}`,
      })
      await expect(client.getVault()).resolves.toMatchObject({
        vaultPath: harness.vault,
      })
      await expect(client.health()).resolves.toMatchObject({
        vault: harness.vault,
      })

      await client.shutdown()

      expect(await waitUntilMissing(portFile, 5000)).toBe(true)
      expect(await waitUntilMissing(lockFile, 5000)).toBe(true)
    })

    test('ignores a stale port file that points at another vault daemon', async () => {
      const otherHarness = await createHarness()
      extraRoots.push(otherHarness.root)

      const otherHandle = await startDaemon({ vault: otherHarness.vault })
      handles.push(otherHandle)

      await mkdir(join(harness.vault, '.voicetree'), { recursive: true })
      await writeFile(
        join(harness.vault, '.voicetree', 'graphd.port'),
        `${otherHandle.port}\n`,
        'utf8',
      )

      const result = await ensureDaemon(harness.vault, { timeoutMs: 8000 })
      expect(result.launched).toBe(true)
      expect(result.port).not.toBe(otherHandle.port)

      const client = new GraphDbClient({
        baseUrl: `http://127.0.0.1:${result.port}`,
      })
      await expect(client.health()).resolves.toMatchObject({
        vault: harness.vault,
      })
    })
  },
)
