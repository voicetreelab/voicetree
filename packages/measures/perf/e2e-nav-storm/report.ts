/**
 * Report assembly + summary printer for e2e-nav-storm.
 *
 * The numbers here are the FIRST renderer frame baseline (not a target): frame
 * p50/p95/p99, dropped-frame %, INP, long-task, and top renderer self-time
 * frames, plus the PromQL/Tempo/Pyroscope queries that prove each MELT landed.
 * Honesty over flattering numbers.
 */
import * as path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { ProbeSnapshot } from '../../../../webapp/src/shell/perf/rendererPerfProbe.ts'
import type { MainProcessMetrics } from '../_shared/main-process-cdp.ts'
import type { NavLoopResult } from './navDriver.ts'

export interface NavReportInput {
    readonly pass: boolean
    readonly failureReason: string | null
    readonly runUuid: string
    readonly otlpEndpoint: string | null
    readonly seedNodeCount: number
    readonly loadedNodeCount: number
    readonly nav: NavLoopResult
    readonly trickle: { readonly nodesWritten: number; readonly observedAddedInRenderer: number }
    readonly screenshots: { readonly count: number; readonly nonBlank: number }
    readonly probe: ProbeSnapshot
    readonly topRendererFrames: MainProcessMetrics['topFunctions']
    readonly rendererCpuprofilePath: string
    readonly pyroscopeQuery: string
    readonly perfRunDir: string
    readonly outPath: string
    readonly totalWallMs: number
}

/** PromQL/Tempo/Pyroscope queries that prove each MELT for this run. */
function buildMeltQueries(runUuid: string): Readonly<Record<string, string>> {
    const sel = `service_instance_id="${runUuid}"`
    const tempoSel = `{resource.service.instance.id="${runUuid}"}`
    return {
        frameHistogram: `http://localhost:2996/api/v1/query?query=renderer_frame_duration_ms_bucket{${sel}}`,
        longtaskHistogram: `http://localhost:2996/api/v1/query?query=renderer_longtask_duration_ms_bucket{${sel}}`,
        interactionLatency: `http://localhost:2996/api/v1/query?query=renderer_interaction_latency_ms_bucket{${sel}}`,
        visibleNodes: `http://localhost:2996/api/v1/query?query=cytoscape_visible_nodes{${sel}}`,
        gpuProcessCpu: `http://localhost:2996/api/v1/query?query=process_cpu_usage_percent{${sel},type="GPU"}`,
        interactionSpans: `http://localhost:2997/api/search?q=${encodeURIComponent(`${tempoSel} && name="renderer.interaction.zoom"`)}`,
        rendererProfile: `http://localhost:2995/pyroscope/render (see pyroscopeQuery)`,
    }
}

export function writeNavReportAndSummary(input: NavReportInput): void {
    const meltQueries = buildMeltQueries(input.runUuid)
    const report = {
        pass: input.pass,
        failureReason: input.failureReason,
        runUuid: input.runUuid,
        otlpEndpoint: input.otlpEndpoint,
        scenario: {
            seedNodeCount: input.seedNodeCount,
            loadedNodeCount: input.loadedNodeCount,
            navWindowMs: input.probe.windowMs,
            navActions: input.nav.totalActions,
            navActionsByKind: input.nav.actionsByKind,
            navSkippedKinds: input.nav.skippedKinds,
            trickleNodesWritten: input.trickle.nodesWritten,
            trickleObservedInRenderer: input.trickle.observedAddedInRenderer,
        },
        frames: input.probe.frames,
        longtask: input.probe.longtask,
        inp: input.probe.inp,
        nodes: input.probe.nodes,
        screenshots: input.screenshots,
        topRendererFrames: input.topRendererFrames.slice(0, 15),
        artifacts: {
            perfRunDir: input.perfRunDir,
            rendererCpuprofilePath: input.rendererCpuprofilePath,
            pyroscopeQuery: input.pyroscopeQuery,
        },
        meltQueries,
        totalWallMs: input.totalWallMs,
    }

    mkdirSync(path.dirname(input.outPath), { recursive: true })
    writeFileSync(input.outPath, JSON.stringify(report, null, 2), 'utf8')

    const f = input.probe.frames
    const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
    const sep = '='.repeat(68)
    const topFrameLines = input.topRendererFrames.slice(0, 8).map(fn =>
        `      ${fn.selfPercent.toFixed(1).padStart(5)}%  ${fn.name.substring(0, 40).padEnd(40)} ${fn.url.split('/').slice(-2).join('/').substring(0, 30)}`,
    ).join('\n')

    process.stdout.write(
        `\n${sep}\n`
        + `  e2e-nav-storm: ${input.pass ? 'PASS' : 'FAIL'}${input.failureReason ? ` — ${input.failureReason}` : ''}\n`
        + `  run: ${input.runUuid}\n`
        + `${sep}\n`
        + `  SCENARIO\n`
        + `    loaded nodes:     ${input.loadedNodeCount} (seed ${input.seedNodeCount})\n`
        + `    nav window:       ${(input.probe.windowMs / 1000).toFixed(1)}s, ${input.nav.totalActions} actions ${JSON.stringify(input.nav.actionsByKind)}\n`
        + `    trickle writes:   ${input.trickle.nodesWritten} written, ${input.trickle.observedAddedInRenderer} observed added in renderer\n`
        + `    screenshots:      ${input.screenshots.nonBlank}/${input.screenshots.count} non-blank\n`
        + `  FRAME LATENCY (baseline — first real numbers)\n`
        + `    frames sampled:   ${f.count}\n`
        + `    p50 / p95 / p99:  ${f.p50.toFixed(1)} / ${f.p95.toFixed(1)} / ${f.p99.toFixed(1)} ms   max ${f.max.toFixed(1)} ms\n`
        + `    dropped (>16.7):  ${pct(f.droppedFraction)}    jank (>33.3): ${pct(f.jankFraction)}\n`
        + `    INP p50/p95/p99:  ${input.probe.inp.p50.toFixed(0)} / ${input.probe.inp.p95.toFixed(0)} / ${input.probe.inp.p99.toFixed(0)} ms  (${input.probe.inp.count} interactions)\n`
        + `    longtask:         ${input.probe.longtask.count} tasks, p99 ${input.probe.longtask.p99.toFixed(0)} ms, total ${input.probe.longtask.totalMs.toFixed(0)} ms\n`
        + `    visible/total:    ${input.probe.nodes.visible}/${input.probe.nodes.total} nodes\n`
        + `  TOP RENDERER SELF-TIME FRAMES (cpuprofile)\n`
        + `${topFrameLines}\n`
        + `  GPU%: query VictoriaMetrics → ${meltQueries.gpuProcessCpu}\n`
        + `  report: ${input.outPath}\n`
        + `${sep}\n`,
    )
}
