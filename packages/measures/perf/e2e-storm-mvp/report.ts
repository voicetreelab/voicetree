/**
 * Report assembly + summary printer for the e2e-storm-mvp run.
 *
 * Kept small and shape-stable: downstream tooling (parent agent layers
 * profilers + assertions on top) can rely on `pass`, the wall-time fields,
 * and `filesDelta` without needing to grow the schema.
 */
import * as path from 'node:path'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import type { HostVmMetricsSummary } from './hostVmMetrics.ts'

export interface ReportInput {
    readonly pass: boolean
    readonly failureReason: string | null
    readonly electronBootMs: number
    readonly mcpDiscoveryMs: number
    readonly agentCount: number
    readonly nodesPerAgent: number
    readonly agentsSucceeded: number
    readonly agentsTimedOut: number
    readonly agentWallMsP50: number
    readonly agentWallMsP99: number
    readonly agentWallMsMax: number
    readonly agentSpawnMsP50: number
    readonly agentSpawnMsP99: number
    readonly agentSpawnMsMax: number
    readonly nodesCreated: number
    readonly filesBefore: number
    readonly filesAfter: number
    readonly mcpPort: number
    readonly vaultDir: string
    readonly projectDir: string
    readonly appSupportPath: string
    readonly electronLogPath: string
    /** Per-run dir where perfProbeFromEnv writes ndjson + cpuprofile. */
    readonly perfRunDir: string
    readonly screenshotDir: string
    readonly hostVmMetrics: HostVmMetricsSummary | null
    readonly outPath: string
    readonly totalWallMs: number
}

export function countMarkdownFiles(dir: string): number {
    let count = 0
    const walk = (d: string): void => {
        let entries: readonly string[]
        try { entries = readdirSync(d) } catch { return }
        for (const entry of entries) {
            if (entry.startsWith('.')) continue
            const full = path.join(d, entry)
            let stat
            try { stat = statSync(full) } catch { continue }
            if (stat.isDirectory()) walk(full)
            else if (stat.isFile() && entry.endsWith('.md')) count++
        }
    }
    walk(dir)
    return count
}

export function writeReportAndSummary(input: ReportInput): void {
    const report = {
        pass: input.pass,
        failureReason: input.failureReason,
        timing: {
            totalWallMs: input.totalWallMs,
            electronBootMs: input.electronBootMs,
            mcpDiscoveryMs: input.mcpDiscoveryMs,
            agentWallMsP50: input.agentWallMsP50,
            agentWallMsP99: input.agentWallMsP99,
            agentWallMsMax: input.agentWallMsMax,
            agentSpawnMsP50: input.agentSpawnMsP50,
            agentSpawnMsP99: input.agentSpawnMsP99,
            agentSpawnMsMax: input.agentSpawnMsMax,
        },
        storm: {
            agentCount: input.agentCount,
            nodesPerAgent: input.nodesPerAgent,
            expectedNodes: input.agentCount * input.nodesPerAgent,
            nodesCreated: input.nodesCreated,
            agentsSucceeded: input.agentsSucceeded,
            agentsTimedOut: input.agentsTimedOut,
        },
        files: {
            before: input.filesBefore,
            after: input.filesAfter,
            delta: input.filesAfter - input.filesBefore,
        },
        artifacts: {
            mcpPort: input.mcpPort,
            vaultDir: input.vaultDir,
            projectDir: input.projectDir,
            appSupportPath: input.appSupportPath,
            electronLogPath: input.electronLogPath,
            perfRunDir: input.perfRunDir,
            screenshotDir: input.screenshotDir,
        },
        hostVm: input.hostVmMetrics,
    }

    mkdirSync(path.dirname(input.outPath), { recursive: true })
    writeFileSync(input.outPath, JSON.stringify(report, null, 2), 'utf8')

    const status = input.pass ? 'PASS' : 'FAIL'
    const sep = '='.repeat(60)
    process.stdout.write(
        `\n${sep}\n`
        + `  e2e-storm-mvp: ${status}${input.failureReason ? ` — ${input.failureReason}` : ''}\n`
        + `  electron boot: ${input.electronBootMs}ms   mcp discovery: ${input.mcpDiscoveryMs}ms\n`
        + `  storm:         agents=${input.agentsSucceeded}/${input.agentCount} nodes=${input.nodesCreated}/${input.agentCount * input.nodesPerAgent} timedOut=${input.agentsTimedOut}\n`
        + `  spawn wall:    p50=${input.agentSpawnMsP50}ms p99=${input.agentSpawnMsP99}ms max=${input.agentSpawnMsMax}ms\n`
        + `  agent wall:    p50=${input.agentWallMsP50}ms p99=${input.agentWallMsP99}ms max=${input.agentWallMsMax}ms\n`
        + hostVmSummaryLine(input.hostVmMetrics)
        + `  files:         ${input.filesBefore} → ${input.filesAfter} (Δ=${input.filesAfter - input.filesBefore})\n`
        + `  total:         ${input.totalWallMs}ms   report: ${input.outPath}\n`
        + `  perf run dir:  ${input.perfRunDir}\n`
        + `  screenshots:   ${input.screenshotDir}\n`
        + `${sep}\n`,
    )
}

function fmtPct(value: number): string {
    return value.toFixed(1)
}

function hostVmSummaryLine(summary: HostVmMetricsSummary | null): string {
    if (summary === null || summary.sampleCount === 0) return ''
    return `  devbox vm:     cpu avg=${fmtPct(summary.cpuUsedPctAvg)}% max=${fmtPct(summary.cpuUsedPctMax)}% `
        + `load1/cpu max=${fmtPct(summary.load1PerCpuPctMax)}% `
        + `iowait max=${fmtPct(summary.cpuIowaitPctMax)}% steal max=${fmtPct(summary.cpuStealPctMax)}% `
        + `mem avg=${fmtPct(summary.memUsedPctAvg)}% max=${fmtPct(summary.memUsedPctMax)}%\n`
}
