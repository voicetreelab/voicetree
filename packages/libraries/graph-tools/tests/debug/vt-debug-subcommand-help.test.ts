/**
 * REC 8 — `vt-debug <command> --help` must print command usage and exit 0
 * WITHOUT auto-launching Electron.
 *
 * Before the fix, only the top-level `vt-debug --help` short-circuited; a
 * subcommand --help (`vt-debug screenshot --help`) fell through to the handler,
 * which calls resolveDebugInstance and auto-launches
 * `npm --prefix webapp run electron:debug` before any --help handling.
 *
 * Black-box: spawn the real CLI as a child process and assert on its exit code,
 * stdout (usage), and the ABSENCE of any auto-launch side effect (no spawned
 * Electron PID, no CDP-port breadcrumb). No CDP / live app is exercised — that
 * is exactly what this test proves.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
const cliPath = path.join(repoRoot, 'packages/libraries/graph-tools/bin/vt-debug.ts')

type ProcessResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

function runVtDebug(args: readonly string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', cliPath, ...args],
      {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.once('exit', code => {
      clearTimeout(timeout)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

describe('vt-debug <command> --help', () => {
  // Generous timeout covers tsx/ESM cold start, but a --help that does NOT
  // launch Electron returns in well under this; an auto-launch would either
  // hang past it or emit a CDP-port breadcrumb on stderr.
  it('screenshot --help prints usage and exits 0 without launching Electron', { timeout: 60_000 }, async () => {
    const result = await runVtDebug(['screenshot', '--help'], 45_000)

    expect(result.timedOut, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(false)
    expect(result.code, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)

    // Real per-command usage was printed.
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('vt debug screenshot')
    expect(result.stdout).toContain('Shared selector flags:')

    // No auto-launch side effects: the auto-launch path prints the chosen CDP
    // port to stderr and runs the command handler (which would emit a JSON
    // Response with a numeric cdpPort). Neither must appear.
    expect(result.stderr).not.toMatch(/electron:debug/i)
    expect(result.stderr).not.toMatch(/cdp ?port/i)
    expect(result.stdout).not.toContain('"cdpPort"')
    expect(result.stdout).not.toContain('"ok"')
  })

  it('two-token alias (node click --help) also short-circuits to usage', { timeout: 60_000 }, async () => {
    const result = await runVtDebug(['node', 'click', '--help'], 45_000)

    expect(result.timedOut, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(false)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('vt debug node-click')
    expect(result.stderr).not.toMatch(/electron:debug/i)
  })

  // The bin is invoked by users as `vt debug ...`; the internal bin name
  // `vt-debug` must never leak into the usage/error text a user reads.
  it('top-level --help presents the user-facing `vt debug` and never the bin-internal `vt-debug`', { timeout: 60_000 }, async () => {
    const result = await runVtDebug(['--help'], 45_000)

    expect(result.timedOut, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(false)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Usage: vt debug <command> [args]')
    expect(result.stdout).not.toMatch(/vt-debug/)
  })

  it('subcommand --help presents the user-facing `vt debug` and never the bin-internal `vt-debug`', { timeout: 60_000 }, async () => {
    const result = await runVtDebug(['eval', '--help'], 45_000)

    expect(result.timedOut, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(false)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('vt debug eval')
    expect(result.stdout).not.toMatch(/vt-debug/)
  })

  // An unknown subcommand prints a JSON usage error on stderr. That error text
  // is user-facing and must reference `vt debug`, never the bin-internal name.
  it('unknown-subcommand error references `vt debug` and never the bin-internal `vt-debug`', { timeout: 60_000 }, async () => {
    const result = await runVtDebug(['not-a-real-subcommand'], 45_000)

    expect(result.timedOut, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(false)
    expect(result.code).toBe(2)
    expect(result.stderr).not.toMatch(/vt-debug/)
  })
})
