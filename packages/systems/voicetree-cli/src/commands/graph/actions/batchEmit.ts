import {isJsonMode, setErrorClass, setGateRejection} from '../cliDeps'
import {
    formatBatchReportJson,
    formatBatchReportLine,
    formatBatchReportSummary,
    reportExitCode,
} from '../core/schemaGate'
import type {BatchReport, NodeVerdict} from '../core/types'

function recordRejectionTelemetry(verdicts: readonly NodeVerdict[]): void {
    const rejected: readonly NodeVerdict[] = verdicts.filter((v) => v.status === 'rejected')
    if (rejected.length === 0) return

    const hasSchemaRejection: boolean = rejected.some((v) => v.typeName !== undefined)
    setErrorClass(hasSchemaRejection ? 'SchemaViolation' : 'FilesystemValidationError')

    const firstSchemaRejection: NodeVerdict | undefined = rejected.find(
        (v) => v.typeName !== undefined && v.schemaPath !== undefined,
    )
    if (firstSchemaRejection === undefined) return

    const ruleIds: readonly string[] = [
        ...new Set(rejected.flatMap((v) => v.ruleIds ?? [])),
    ]
    setGateRejection({
        typeName: firstSchemaRejection.typeName as string,
        schemaPath: firstSchemaRejection.schemaPath as string,
        ruleIds,
    })
}

function emitJsonEnvelope(report: BatchReport, hasRejections: boolean): void {
    const envelope: string = formatBatchReportJson(report)
    if (hasRejections) {
        process.stderr.write(`${envelope}\n`)
        return
    }
    console.log(envelope)
}

function emitHumanLines(report: BatchReport): void {
    for (const verdict of report.nodes) {
        const line: string = formatBatchReportLine(verdict)
        if (verdict.status === 'rejected') {
            process.stderr.write(`${line}\n`)
            continue
        }
        console.log(line)
    }

    if (report.planErrors && report.planErrors.length > 0) {
        for (const planError of report.planErrors) {
            process.stderr.write(`✗ plan-error: ${planError.message}\n`)
        }
    }

    console.log(formatBatchReportSummary(report.summary, reportExitCode(report)))
}

/**
 * Emit the batch report (single envelope in JSON mode, streamed lines in human
 * mode), record telemetry for any rejections, and exit non-zero if at least
 * one node was rejected. On all-ok / skipped / warning batches the function
 * returns normally — exit code defaults to 0 via natural process termination.
 */
export function emitBatchReport(report: BatchReport): void {
    const hasRejections: boolean = report.summary.rejected > 0
    if (isJsonMode()) {
        emitJsonEnvelope(report, hasRejections)
    } else {
        emitHumanLines(report)
    }
    if (hasRejections) {
        recordRejectionTelemetry(report.nodes)
        process.exit(1)
    }
}

export function rewriteOverrideHintForCli(mcpError: string): string {
    const markerIndex: number = mcpError.indexOf('To override, add "override_with_rationale"')
    if (markerIndex === -1) return mcpError
    const head: string = mcpError.slice(0, markerIndex).trimEnd()
    const ruleIds: readonly string[] = [...new Set([...head.matchAll(/^ {2}• \[([^\]]+)\]/gm)].map((m) => m[1]))]
    if (ruleIds.length === 0) return mcpError
    return `${head}\n\nTo override, re-run with: ${ruleIds.map((id) => `--override '${id}:<rationale>'`).join(' ')}`
}

export function emitMcpFailureAndExit(rawMessage: string): never {
    const message: string = rewriteOverrideHintForCli(rawMessage)
    setErrorClass('CliError')
    process.stderr.write(`error: ${message}\n`)
    process.exit(1)
}
