/**
 * Glue between this MVP and Bob's perf-dashboard producer
 * (`@vt/perf-analysis/perf-probe`).
 *
 * The producer is env-gated: any node process that imports
 * `perfProbeFromEnv` only attaches CPU sampling + the 1 Hz NDJSON sampler
 * when `VOICETREE_PERF_PROFILE=1`. It writes to a per-run directory rooted
 * at `~/.voicetree/reports/stable-perf-<ts>/` — the dashboard's
 * `listRuns` filter literally `startsWith('stable-perf-')`, so the name
 * matters.
 *
 * If `VOICETREE_PERF_RUN_DIR` is already set, the producer reuses it. We
 * pre-compute the path here so this test process and every spawned child
 * (electron-main → vt-graphd) all land artifacts in the same directory.
 *
 * vt-graphd calls `perfProbeFromEnv`. Electron main is sampled externally
 * through its Node inspector port and writes compatible artifacts into the
 * same run dir. If renderer / mcpd ever add perf-probe call sites, they'll
 * share this run dir without further wiring.
 *
 * Flush-on-shutdown: `perfProbeFromEnv` writes the `.cpuprofile` and
 * flushes the metrics stream only inside its SIGINT/SIGTERM/beforeExit
 * handler. A SIGKILL skips that handler. So before tearing down electron
 * we explicitly SIGTERM the vt-graphd child the daemon-client spawned,
 * give it time to flush, and only then close electron.
 */
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface PerfProfileEnv {
    readonly VOICETREE_PERF_PROFILE: '1'
    readonly VOICETREE_PERF_RUN_DIR: string
}

export interface PerfProfileSetup {
    readonly runDir: string
    readonly env: PerfProfileEnv
}

export function computePerfRunDir(reportsDir: string, tsSuffix: string): PerfProfileSetup {
    const runDir = path.join(reportsDir, `stable-perf-e2e-mvp-${tsSuffix}`)
    return {
        runDir,
        env: {
            VOICETREE_PERF_PROFILE: '1',
            VOICETREE_PERF_RUN_DIR: runDir,
        },
    }
}

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
