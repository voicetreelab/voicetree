import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — build.mjs is a plain ESM script with no type declarations.
import { bundleVtGraphd } from '../build.mjs'
import { CONTRACT_VERSION, HealthResponseSchema } from '@vt/graph-db-server/contract'

const __dirname = dirname(fileURLToPath(import.meta.url))

// `spawn(..., { stdio: ['ignore', 'pipe', 'pipe'] })` — stdin ignored, stdout/stderr piped.
type DaemonChild = ChildProcessByStdio<null, Readable, Readable>

// The single most valuable B1 guard: prove the esbuild bundle that ships in the
// packaged app actually BOOTS under a standalone Node — node:sqlite loads, the
// watch-folder (chokidar, kept external) resolves, the server binds a port, and
// /health answers with the contract version. A bundling regression (a wrongly
// inlined native dep, a broken shebang/banner, a missing external) fails here
// without needing a real Electron package.
//
// The bundle is emitted into the package's own dist/ — the SAME resolution depth
// as the production bundle — so Node finds graph-db-server's node_modules for the
// runtime externals exactly as it does in the published CLI layout.
describe('vt-graphd bundle boots', () => {
  const outfile = resolve(__dirname, '..', 'dist', `vt-graphd.boot-test.${process.pid}.mjs`)
  let project: string

  beforeAll(async () => {
    await bundleVtGraphd({ outfile })
    project = await mkdtemp(join(tmpdir(), 'vt-graphd-boot-'))
  }, 60_000)

  afterAll(async () => {
    await rm(outfile, { force: true })
    await rm(project, { force: true, recursive: true })
  })

  test('the bundled entrypoint serves /health with the contract version', async () => {
    const child = spawn(process.execPath, [outfile, '--project-root', project], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      const port = await waitForListeningPort(child)
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      expect(res.status).toBe(200)
      const body = HealthResponseSchema.parse(await res.json())
      expect(body.version).toBe(CONTRACT_VERSION)
      expect(body.project).toBe(project)
    } finally {
      await stopChild(child)
    }
  }, 30_000)
})

/**
 * Resolve the port the daemon prints once it is fully up
 * (`vt-graphd: listening on http://127.0.0.1:<port> ...`), or reject if the
 * process dies / never announces within the timeout. stderr is captured so a
 * boot failure surfaces as the rejection reason instead of an opaque timeout.
 */
function waitForListeningPort(child: DaemonChild): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      reject(new Error(`vt-graphd did not announce a port within 15s. stderr:\n${stderr}`))
    }, 15_000)
    timer.unref()

    const settle = (fn: () => void): void => {
      clearTimeout(timer)
      child.stdout.removeAllListeners('data')
      child.stderr.removeAllListeners('data')
      child.removeAllListeners('exit')
      fn()
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout)
      if (match) settle(() => resolvePort(Number.parseInt(match[1], 10)))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => {
      settle(() => reject(new Error(`vt-graphd exited (code ${code}) before listening. stderr:\n${stderr}`)))
    })
  })
}

function stopChild(child: DaemonChild): Promise<void> {
  return new Promise<void>((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveStop()
      return
    }
    child.once('exit', () => resolveStop())
    child.kill('SIGTERM')
  })
}
