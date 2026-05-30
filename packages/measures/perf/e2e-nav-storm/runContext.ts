/**
 * Run identity + perf-env resolution for e2e-nav-storm.
 *
 * The run's `service.instance.id` (== runUuid) is the correlation key that
 * stitches metrics (VictoriaMetrics), traces (Tempo), and profiles (Pyroscope)
 * together for one run. It is read from `VOICETREE_RUN_INSTANCE_ID` (set by the
 * perf-stack preflight) or minted here, and threaded into Electron's env so the
 * main process's observability provider tags every signal with it.
 */
import * as path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface RunContext {
    readonly runUuid: string
    readonly runDir: string
    readonly otlpEndpoint?: string
    /** Env injected into Electron so main + daemon + renderer share the run id. */
    readonly perfEnv: Readonly<Record<string, string>>
}

export function resolveRunContext(env: NodeJS.ProcessEnv = process.env): RunContext {
    const runUuid = env.VOICETREE_RUN_INSTANCE_ID && env.VOICETREE_RUN_INSTANCE_ID.length > 0
        ? env.VOICETREE_RUN_INSTANCE_ID
        : randomUUID()
    const runDir = path.join(homedir(), '.voicetree', 'perf', runUuid)
    const otlpEndpoint = env.VOICETREE_OTLP_ENDPOINT && env.VOICETREE_OTLP_ENDPOINT.length > 0
        ? env.VOICETREE_OTLP_ENDPOINT
        : undefined

    const perfEnv: Record<string, string> = {
        VOICETREE_RUN_INSTANCE_ID: runUuid,
        VOICETREE_PERF_PROFILE: '1',
        // Activate the renderer perf probe + GPU sampler (see preload.ts / main.ts).
        VOICETREE_PERF_PROBE: '1',
        // Headful real-GPU run on the Mac — NOT headless/minimized — so the GPU
        // process + compositor cost the probe targets is actually incurred.
        HEADLESS_TEST: '0',
        MINIMIZE_TEST: '0',
    }
    if (otlpEndpoint !== undefined) perfEnv.VOICETREE_OTLP_ENDPOINT = otlpEndpoint
    env.VOICETREE_RUN_INSTANCE_ID = runUuid

    return { runUuid, runDir, otlpEndpoint, perfEnv }
}
