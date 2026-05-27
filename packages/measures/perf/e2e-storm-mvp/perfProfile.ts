/**
 * Process-control helpers for the e2e-storm MVP.
 *
 * Run identity now comes from VOICETREE_RUN_INSTANCE_ID and artifacts live
 * under ~/.voicetree/perf/<uuid>/. This file intentionally contains no
 * stable-perf report-directory compatibility path.
 *
 * Flush-on-shutdown: `perfProbeFromEnv` flushes Pyroscope/metrics/log state
 * inside its SIGINT/SIGTERM/beforeExit handler. A SIGKILL skips that handler.
 * Before tearing down Electron we explicitly SIGTERM the vt-graphd child the
 * daemon-client spawned, give it time to flush, and only then close Electron.
 */
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function ownerRecordPid(projectRoot: string): number | null {
    try {
        const raw = readFileSync(path.join(projectRoot, '.voicetree', 'graphd.owner.json'), 'utf8')
        const value = JSON.parse(raw) as { readonly pid?: unknown }
        return typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0
            ? value.pid
            : null
    } catch {
        return null
    }
}

function projectRootArg(args: string): string | null {
    const match = /--project-root(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(args)
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function listVtGraphdPidsForProjectRoot(projectRoot: string): readonly number[] {
    if (process.platform === 'win32') return []
    const pids = new Set<number>()
    const ownerPid = ownerRecordPid(projectRoot)
    if (ownerPid !== null) pids.add(ownerPid)

    try {
        const raw = execSync('ps -A -o pid=,args=', { encoding: 'utf8' })
        for (const line of raw.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed) continue
            if (!trimmed.includes('vt-graphd')) continue
            const m = trimmed.match(/^(\d+)\s/)
            if (!m) continue
            const rootArg = projectRootArg(trimmed.slice(m[0].length))
            if (rootArg !== null && path.resolve(rootArg) === path.resolve(projectRoot)) {
                pids.add(Number.parseInt(m[1], 10))
            }
        }
    } catch {
        // Keep any owner-record pid we already found.
    }
    return [...pids].sort((left, right) => left - right)
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

export interface FlushResult {
    readonly signaled: readonly number[]
    readonly exitedCleanly: readonly number[]
    readonly forceKilled: readonly number[]
    readonly stillAlive: readonly number[]
    readonly waitMsActual: number
}

/**
 * SIGTERM every vt-graphd matching this project root and wait up to
 * `waitMs` for them to exit. perfProbeFromEnv's SIGTERM handler flushes
 * the cpuprofile + metrics stream — so this is the "give vt-graphd a
 * chance to write its artifacts" step before electron teardown.
 */
export async function flushAndStopVtGraphd(
    projectRoot: string,
    waitMs: number,
    pollMs = 100,
): Promise<FlushResult> {
    return stopVtGraphd(projectRoot, waitMs, 'SIGTERM', pollMs)
}

export async function forceStopVtGraphd(
    projectRoot: string,
    waitMs: number,
    pollMs = 100,
): Promise<FlushResult> {
    return stopVtGraphd(projectRoot, waitMs, 'SIGKILL', pollMs)
}

async function stopVtGraphd(
    projectRoot: string,
    waitMs: number,
    signal: 'SIGTERM' | 'SIGKILL',
    pollMs: number,
): Promise<FlushResult> {
    const pids = listVtGraphdPidsForProjectRoot(projectRoot)
    const signaled: number[] = []
    for (const pid of pids) {
        try {
            process.kill(pid, signal)
            signaled.push(pid)
        } catch { /* already gone */ }
    }

    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
        if (signaled.every(p => !isPidAlive(p))) break
        await new Promise(r => setTimeout(r, pollMs))
    }

    const exitedCleanly = signaled.filter(p => !isPidAlive(p))
    const aliveAfterGrace = signal === 'SIGTERM' ? signaled.filter(p => isPidAlive(p)) : []
    const forceKilled: number[] = []
    for (const pid of aliveAfterGrace) {
        try {
            process.kill(pid, 'SIGKILL')
            forceKilled.push(pid)
        } catch { /* already gone */ }
    }
    if (forceKilled.length > 0) {
        await new Promise(r => setTimeout(r, pollMs))
    }
    const stillAlive = signaled.filter(p => isPidAlive(p))
    return { signaled, exitedCleanly, forceKilled, stillAlive, waitMsActual: Date.now() - (deadline - waitMs) }
}
