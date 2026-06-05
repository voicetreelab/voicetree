function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return `${m}m${s.toString().padStart(2, '0')}s`
}

type FailedTestSummary = {
    readonly fullName: string
    readonly fileName?: string
    readonly message?: string
}

type FailureSummaryInput = {
    readonly durationMs: number
    readonly timedOut?: boolean
    readonly spawnError?: string | null
    readonly stdoutTail?: string
    readonly stderrTail?: string
    readonly failureDetails?: {
        readonly failedTests?: readonly FailedTestSummary[]
        readonly failedTestsTruncated?: boolean
    }
}

export function formatFailureBody(outcome: FailureSummaryInput): string {
    const failed = outcome.failureDetails?.failedTests ?? []
    if (failed.length > 0) {
        const lines = failed.flatMap(t => {
            const where = t.fileName ? `  (${t.fileName})` : ''
            const head = `      • ${t.fullName}${where}`
            const msg = (t.message ?? '').split('\n').slice(0, 15)
                .map(l => `        ${l}`).join('\n')
            return msg ? [head, msg] : [head]
        })
        if (outcome.failureDetails?.failedTestsTruncated) lines.push('      … (more failures truncated)')
        return lines.join('\n')
    }
    if (outcome.spawnError) return `      spawn error: ${outcome.spawnError}`
    if (outcome.timedOut) return `      timed out after ${fmtMs(outcome.durationMs)}`
    const tail = outcome.stderrTail ?? outcome.stdoutTail
    return tail ? tail.split('\n').map(l => `      ${l}`).join('\n') : ''
}

export function errorSummaryForFailedOutcome(outcome: FailureSummaryInput & {readonly exitCode?: number | null; readonly signal?: string | null}): string | undefined {
    const body = formatFailureBody(outcome)
    if (body) return body
    if (outcome.stderrTail) return outcome.stderrTail
    if (outcome.stdoutTail) return outcome.stdoutTail
    if (outcome.exitCode !== undefined && outcome.exitCode !== null) {
        return `exit ${outcome.exitCode}${outcome.signal ? ` (${outcome.signal})` : ''}`
    }
    return undefined
}

type CheckFailure = {
    readonly check: {readonly id: string; readonly category: string}
    readonly outcome: FailureSummaryInput
}

// Terminal "failures:" section printed at the end of a capture-ci run.
export function formatFailuresSection(failures: readonly CheckFailure[]): string {
    if (failures.length === 0) return ''
    const blocks = failures.map(({check, outcome}) => {
        const body = formatFailureBody(outcome)
        const bodyLine = body ? `${body}\n` : ''
        return `  ✗ ${check.id}\n${bodyLine}      report: health-dashboard/reports/checks/${check.id}.json\n`
    })
    return `\n  failures:\n\n${blocks.join('\n')}`
}

// Markdown rendering appended to $GITHUB_STEP_SUMMARY when checks fail.
export function formatGithubFailureSummary(failures: readonly CheckFailure[]): string {
    if (failures.length === 0) return ''
    const lines = [
        '## CI Check Failures',
        '',
        `Failed checks: ${failures.length}`,
        '',
        ...failures.flatMap(({check, outcome}) => {
            const body = formatFailureBody(outcome)
                .split('\n')
                .map(line => line.replace(/^      /, '  '))
                .join('\n')
            return [
                `### ${check.id}`,
                '',
                `- Category: ${check.category}`,
                `- Report: \`health-dashboard/reports/checks/${check.id}.json\``,
                body ? '' : undefined,
                body || undefined,
                '',
            ].filter(Boolean)
        }),
    ]
    return `${lines.join('\n')}\n`
}
