import { describe, expect, test, vi } from 'vitest'

import { killOrphanVtGraphdDaemons } from '../orphanCleanup.ts'

// ps lines now carry pid, ppid, command. Fixture builder keeps tests legible.
function psLine(pid: number, ppid: number, command: string): string {
  return `  ${pid} ${ppid} ${command}`
}

describe('killOrphanVtGraphdDaemons — project-bound branch', () => {
  test('kills vt-graphd binaries whose --project-root directory no longer exists', () => {
    const killProcess = vi.fn()
    const result = killOrphanVtGraphdDaemons({
      currentPid: 999,
      killProcess,
      listProcesses: () => [
        psLine(
          4242,
          1,
          'node /opt/voicetree/vt-graphd.ts --project-root /tmp/missing-project',
        ),
      ],
      platform: 'darwin',
      projectExists: () => false,
    })

    expect(killProcess).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(result.killed[0]?.pid).toBe(4242)
  })

  test('skips project-bound daemons whose project directory exists', () => {
    const killProcess = vi.fn()
    const result = killOrphanVtGraphdDaemons({
      currentPid: 999,
      killProcess,
      listProcesses: () => [
        psLine(
          4242,
          5000,
          'node /opt/voicetree/vt-graphd.ts --project-root /tmp/live-project',
        ),
      ],
      platform: 'darwin',
      projectExists: () => true,
    })

    expect(killProcess).not.toHaveBeenCalled()
    expect(result.killed).toEqual([])
    expect(result.skipped[0]?.reason).toBe('project-exists')
  })

  test('skips the current pid so the reaper does not kill itself', () => {
    const killProcess = vi.fn()
    const result = killOrphanVtGraphdDaemons({
      currentPid: 4242,
      killProcess,
      listProcesses: () => [
        psLine(
          4242,
          1,
          'node /opt/voicetree/vt-graphd.ts --project-root /tmp/missing-project',
        ),
      ],
      platform: 'darwin',
      projectExists: () => false,
    })

    expect(killProcess).not.toHaveBeenCalled()
    expect(result.killed).toEqual([])
  })

  test('ignores unrelated processes', () => {
    const killProcess = vi.fn()
    const result = killOrphanVtGraphdDaemons({
      currentPid: 999,
      killProcess,
      listProcesses: () => [
        psLine(100, 1, '/usr/sbin/cfprefsd'),
        psLine(200, 1, 'node some/other-app.js'),
        psLine(300, 200, 'node child-of-other-app.js'),
      ],
      platform: 'darwin',
      projectExists: () => true,
    })

    expect(killProcess).not.toHaveBeenCalled()
    expect(result.killed).toEqual([])
  })
})

describe('killOrphanVtGraphdDaemons — platform gate', () => {
  test('is a no-op on unsupported platforms', () => {
    const killProcess = vi.fn()
    const result = killOrphanVtGraphdDaemons({
      currentPid: 999,
      killProcess,
      listProcesses: () => [
        psLine(
          1234,
          1,
          'node /opt/voicetree/vt-graphd.ts --project-root /tmp/missing-project',
        ),
      ],
      platform: 'win32',
      projectExists: () => false,
    })

    expect(killProcess).not.toHaveBeenCalled()
    expect(result.killed).toEqual([])
  })
})
