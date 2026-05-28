// Binary-level tests for the vt-graphd entry point. Exercises the spawn/signal
// path that ensureDaemon uses in production: a detached child whose stderr is
// piped to a parent that may close it before sending SIGTERM. If the child
// emits EPIPE during shutdown's stderr write, an uncaughtException must not
// interrupt the cleanup that removes the port + lock files — otherwise the
// next launcher will see a stale port file and either reuse a dead daemon or
// fail its handshake.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requireFromHere = createRequire(import.meta.url)
const TSX_IMPORT_PATH: string = requireFromHere.resolve('tsx')
const ENTRY: string = requireFromHere.resolve('../bin/vt-graphd.ts')

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return true
    } catch {
      // continue
    }
    await sleep(20)
  }
  return false
}

async function waitForFileMissing(path: string, timeoutMs: number): Promise<number | null> {
  const start = Date.now()
  const deadline = start + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(path)
    } catch {
      return Date.now() - start
    }
    await sleep(20)
  }
  return null
}

describe('vt-graphd binary shutdown', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vt-graphd-bin-'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it(
    'cleans up port + lock files on SIGTERM even when stderr pipe to parent is broken',
    async () => {
      const vault = await mkdtemp(join(root, 'vault-'))

      const child: ChildProcess = spawn(
        process.execPath,
        ['--import', TSX_IMPORT_PATH, ENTRY, '--project-root', vault],
        { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )

      const exitedPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }> =
        new Promise((res) => {
          child.on('exit', (code, signal) => res({ code, signal }))
        })

      // Drain stdout so the child doesn't block on a full pipe before we kill it.
      child.stdout?.on('data', () => {})

      const portFile = join(vault, '.voicetree', 'graphd.port')
      const lockFile = join(vault, '.voicetree', 'graphd.lock')

      const portReady = await waitForFile(portFile, 10_000)
      expect(portReady, 'daemon should have written its port file').toBe(true)

      // Simulate the parent exiting: forcibly destroy our end of the stderr
      // pipe so the daemon's next stderr write will EPIPE.
      child.stderr?.destroy()
      // Give the kernel a moment to actually break the pipe.
      await sleep(50)

      child.kill('SIGTERM')

      // CI runners are slower than local dev; the daemon settles its cleanup
      // in ~1s locally but has been observed to take >3s under GitHub Actions
      // contention. waitForFileMissing exits the moment the file disappears,
      // so generous ceilings here don't slow the happy path.
      const portRemovedAt = await waitForFileMissing(portFile, 15_000)
      const lockRemovedAt = await waitForFileMissing(lockFile, 15_000)
      const exited = await Promise.race([
        exitedPromise,
        sleep(15_000).then(() => null),
      ])

      if (exited === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }

      expect(portRemovedAt, `port file should be removed promptly; was: present`).not.toBeNull()
      expect(lockRemovedAt, `lock file should be removed promptly; was: present`).not.toBeNull()
      expect(exited, 'daemon process should exit cleanly after SIGTERM').not.toBeNull()
      expect(exited?.code).toBe(0)
    },
    60_000,
  )
})
