import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { terminateProcess } from '../lifecycle/terminateProcess.ts'
import { readProcessLiveness } from '../lifecycle/processLiveness.ts'
import { sleep } from '../pollTimings.ts'

// Black-box termination tests against real child processes. Each child
// prints "ready" once its signal handlers are installed so the test never
// races the handler registration.

const spawned: ChildProcess[] = []

afterEach(() => {
  for (const child of spawned.splice(0)) {
    if (child.pid !== undefined && readProcessLiveness(child.pid) === 'alive') {
      try {
        child.kill('SIGKILL')
      } catch {
        // best-effort cleanup
      }
    }
  }
})

function spawnReadyChild(script: string): Promise<number> {
  const child = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  spawned.push(child)
  return new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready') && child.pid !== undefined) {
        resolve(child.pid)
      }
    })
  })
}

async function waitDead(pid: number, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (readProcessLiveness(pid) === 'dead') return
    await sleep(20)
  }
}

describe('terminateProcess', () => {
  it('terminates a normal process with SIGTERM', async () => {
    const pid = await spawnReadyChild(
      'console.log("ready"); setInterval(() => {}, 1e9)',
    )

    const outcome = await terminateProcess(pid, {
      sigtermGraceMs: 1000,
      sigkillGraceMs: 1000,
      pollIntervalMs: 20,
    })

    expect(outcome).toBe('terminated-sigterm')
    expect(readProcessLiveness(pid)).toBe('dead')
  })

  it('escalates to SIGKILL when the process ignores SIGTERM (the wedged-shutdown case)', async () => {
    // Traps SIGTERM and does nothing — mirrors a daemon whose shutdown latch
    // swallows the signal. Only SIGKILL can reap it.
    const pid = await spawnReadyChild(
      'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1e9)',
    )

    const outcome = await terminateProcess(pid, {
      sigtermGraceMs: 300,
      sigkillGraceMs: 1000,
      pollIntervalMs: 20,
    })

    expect(outcome).toBe('terminated-sigkill')
    expect(readProcessLiveness(pid)).toBe('dead')
  })

  it('reports already-dead for a process that has already exited', async () => {
    const pid = await spawnReadyChild(
      'console.log("ready"); setInterval(() => {}, 1e9)',
    )
    process.kill(pid, 'SIGKILL')
    await waitDead(pid, 1000)
    expect(readProcessLiveness(pid)).toBe('dead')

    const outcome = await terminateProcess(pid, {
      sigtermGraceMs: 1000,
      sigkillGraceMs: 1000,
    })

    expect(outcome).toBe('already-dead')
  })
})
