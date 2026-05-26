/**
 * Report assembly + summary printer for the e2e-storm-mvp run.
 *
 * Kept small and shape-stable: downstream tooling (parent agent layers
 * profilers + assertions on top) can rely on `pass`, the wall-time fields,
 * and `filesDelta` without needing to grow the schema.
 */
import * as path from 'node:path'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'

export interface ReportInput {
    readonly pass: boolean
    readonly failureReason: string | null
    readonly electronBootMs: number
    readonly mcpDiscoveryMs: number
    readonly agentWallMs: number
    readonly agentExitCode: number | null
    readonly agentSignal: NodeJS.Signals | null
    readonly agentTimedOut: boolean
    readonly filesBefore: number
    readonly filesAfter: number
    readonly mcpPort: number
    readonly vaultDir: string
    readonly projectDir: string
    readonly appSupportPath: string
    readonly electronLogPath: string
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
            agentWallMs: input.agentWallMs,
        },
        agent: {
            exitCode: input.agentExitCode,
            signal: input.agentSignal,
            timedOut: input.agentTimedOut,
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
        },
    }

    mkdirSync(path.dirname(input.outPath), { recursive: true })
    writeFileSync(input.outPath, JSON.stringify(report, null, 2), 'utf8')

    const status = input.pass ? 'PASS' : 'FAIL'
    const sep = '='.repeat(60)
    process.stdout.write(
        `\n${sep}\n`
        + `  e2e-storm-mvp: ${status}${input.failureReason ? ` — ${input.failureReason}` : ''}\n`
        + `  electron boot: ${input.electronBootMs}ms   mcp discovery: ${input.mcpDiscoveryMs}ms\n`
        + `  agent wall:    ${input.agentWallMs}ms (exit=${input.agentExitCode}${input.agentTimedOut ? ',timeout' : ''})\n`
        + `  files:         ${input.filesBefore} → ${input.filesAfter} (Δ=${input.filesAfter - input.filesBefore})\n`
        + `  total:         ${input.totalWallMs}ms   report: ${input.outPath}\n`
        + `${sep}\n`,
    )
}
