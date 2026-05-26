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
 * vt-graphd is the only service that calls `perfProbeFromEnv` today; if
 * electron-main / renderer / mcpd ever add the call site, they'll share
 * this run dir without further wiring.
 *
 * Flush-on-shutdown: `perfProbeFromEnv` writes the `.cpuprofile` and
 * flushes the metrics stream only inside its SIGINT/SIGTERM/beforeExit
 * handler. A SIGKILL skips that handler. So before tearing down electron
 * we explicitly SIGTERM the vt-graphd child the daemon-client spawned,
 * give it time to flush, and only then close electron.
 */
import * as path from 'node:path'
import { execSync } from 'node:child_process'

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

function listVtGraphdPidsForProjectRoot(projectRoot: string): readonly number[] {
    if (process.platform === 'win32') return []
    try {
        const raw = execSync('ps -A -o pid=,args=', { encoding: 'utf8' })
        const target = `--project-root ${projectRoot}`
        const pids: number[] = []
        for (const line of raw.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed) continue
            if (!trimmed.includes('vt-graphd')) continue
            if (!trimmed.includes(target)) continue
            const m = trimmed.match(/^(\d+)\s/)
            if (m) pids.push(Number.parseInt(m[1], 10))
        }
        return pids
    } catch {
        return []
    }
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
    const pids = listVtGraphdPidsForProjectRoot(projectRoot)
    const signaled: number[] = []
    for (const pid of pids) {
        try {
            process.kill(pid, 'SIGTERM')
            signaled.push(pid)
        } catch { /* already gone */ }
    }

    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
        if (signaled.every(p => !isPidAlive(p))) break
        await new Promise(r => setTimeout(r, pollMs))
    }

    const exitedCleanly = signaled.filter(p => !isPidAlive(p))
    const stillAlive = signaled.filter(p => isPidAlive(p))
    return { signaled, exitedCleanly, stillAlive, waitMsActual: Date.now() - (deadline - waitMs) }
}
