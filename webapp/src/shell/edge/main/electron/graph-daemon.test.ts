import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
    clearDaemonClientCache,
    ensureDaemonClientForVault,
} from './graph-daemon'

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        return (err as NodeJS.ErrnoException).code !== 'ESRCH'
    }
}

describe('ensureDaemonClientForVault — orphan lock recovery', () => {
    let vault: string
    let fakeHolder: ChildProcess | null = null
    let realDaemonStopped: boolean = false

    beforeEach(async () => {
        vault = await mkdtemp(join(tmpdir(), 'vt-graphd-conn-orphan-'))
        await mkdir(join(vault, '.voicetree'), { recursive: true })
        clearDaemonClientCache()
        fakeHolder = null
        realDaemonStopped = false
    })

    afterEach(async () => {
        if (fakeHolder?.pid && isProcessAlive(fakeHolder.pid)) {
            try {
                process.kill(fakeHolder.pid, 'SIGKILL')
            } catch {
                // already gone
            }
        }
        if (!realDaemonStopped) {
            // Best-effort: stop any real daemon spawned during the test.
            try {
                const { getActiveDaemonClient } = await import('./graph-daemon')
                const client = getActiveDaemonClient()
                await client?.shutdown().catch(() => {})
            } catch {
                // module already unloaded
            }
        }
        clearDaemonClientCache()
        await rm(vault, { recursive: true, force: true })
    })

    test('kills orphan vt-graphd lock-holder and recovers a healthy daemon', async () => {
        // Fake holder needs the regex-matchable command-line "vt-graphd.ts ... --vault <vault>"
        // for the safety check in the recovery path to allow killing it.
        const fakeBinPath: string = join(vault, '.voicetree', 'vt-graphd.ts')
        await writeFile(fakeBinPath, 'setInterval(() => {}, 1e9)\n', 'utf8')

        fakeHolder = spawn('node', [fakeBinPath, '--vault', vault], {
            detached: true,
            stdio: 'ignore',
        })
        fakeHolder.unref()
        await new Promise((res) => setTimeout(res, 150))
        expect(fakeHolder.pid).toBeGreaterThan(0)
        const holderPid: number = fakeHolder.pid!
        expect(isProcessAlive(holderPid)).toBe(true)

        await writeFile(
            join(vault, '.voicetree', 'graphd.lock'),
            String(holderPid),
            { flag: 'wx' },
        )

        // Bug: today this hangs for the full timeout, then throws.
        // Fix: detects the held lock, kills the orphan, retries, succeeds.
        const recoveryStart: number = Date.now()
        const connection = await ensureDaemonClientForVault(vault, {
            timeoutMs: 10_000,
        })
        const recoveryElapsedMs: number = Date.now() - recoveryStart
        expect(recoveryElapsedMs).toBeLessThan(10_000)

        const health = await connection.client.health()
        expect(health.vault).toBe(vault)

        // Public surface: getGraph must return successfully after recovery,
        // proving the new daemon services real read traffic — not just /health.
        const graph = await connection.client.getGraph()
        expect(graph).toBeDefined()

        // Orphan must be dead.
        await new Promise((res) => setTimeout(res, 100))
        expect(isProcessAlive(holderPid)).toBe(false)

        // Cleanup: stop the real daemon we just launched.
        await connection.client.shutdown().catch(() => {})
        realDaemonStopped = true
    }, 30_000)
})
