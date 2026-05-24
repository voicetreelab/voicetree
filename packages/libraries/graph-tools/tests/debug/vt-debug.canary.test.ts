import { spawn } from 'node:child_process'
import { existsSync, rmSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
const screenshotPath = '/tmp/vt-debug-canary.png'
const childTimeoutMs = 90_000
const runCanary = process.env.SKIP_INTEGRATION === '0'
const describeCanary = runCanary ? describe : describe.skip

type CliResult = {
  readonly ok: boolean
  readonly result?: {
    readonly path?: string
    readonly pid?: number
    readonly cdpPort?: number
  }
}

type ProcessResult = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

function removeScreenshot(): void {
  rmSync(screenshotPath, { force: true })
}

function parseCliResult(stdout: string): CliResult | null {
  const lastJsonLine = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .at(-1)

  if (!lastJsonLine) return null

  try {
    return JSON.parse(lastJsonLine) as CliResult
  } catch {
    return null
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function killSpawnedElectron(stdout: string): Promise<void> {
  const pid = parseCliResult(stdout)?.result?.pid
  if (!pid || pid <= 0) return

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  await waitForExit(pid, 5_000)

  try {
    process.kill(pid, 0)
    process.kill(pid, 'SIGKILL')
  } catch {
    return
  }

  await waitForExit(pid, 2_000)
}

async function runVtDebugScreenshot(): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        'tsx',
        path.join(repoRoot, 'packages/libraries/graph-tools/bin/vt-debug.ts'),
        'screenshot',
        '--new',
        '--out',
        screenshotPath,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          MINIMIZE_TEST: '1',
          NODE_ENV: 'test',
        },
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
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 2_000).unref()
    }, childTimeoutMs)

    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })
}

// Slow opt-in canary. Run with:
// SKIP_INTEGRATION=0 npx vitest run packages/libraries/graph-tools/tests/vt-debug.canary.test.ts
describeCanary('vt-debug auto-launch canary', () => {
  it('auto-launches a fresh Electron session and captures a screenshot', { timeout: 100_000 }, async () => {
    removeScreenshot()
    let result: ProcessResult | null = null

    try {
      result = await runVtDebugScreenshot()

      expect(result.timedOut, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(false)
      expect(result.signal, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBeNull()
      expect(result.code, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
      expect(existsSync(screenshotPath), `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(true)
      expect(statSync(screenshotPath).size).toBeGreaterThan(0)

      const parsed = parseCliResult(result.stdout)
      expect(parsed?.ok).toBe(true)
      expect(parsed?.result?.path).toBe(screenshotPath)
      expect(parsed?.result?.pid).toEqual(expect.any(Number))
      expect(parsed?.result?.cdpPort).toEqual(expect.any(Number))
    } finally {
      if (result) {
        await killSpawnedElectron(result.stdout)
      }
      try {
        unlinkSync(screenshotPath)
      } catch {
        // Already absent.
      }
    }
  })
})
