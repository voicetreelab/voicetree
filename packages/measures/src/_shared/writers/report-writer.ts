import {expect} from 'vitest'
import {recordHealthReport, removeHealthReports, type HealthReport} from './health-report-writer.ts'

type HealthReportInput = Omit<HealthReport, 'passed' | 'timestamp'> & {
    readonly passed?: boolean
}

function passesComparison(input: Pick<HealthReport, 'comparison' | 'current' | 'budget'>): boolean {
    return input.comparison === 'lte'
        ? input.current <= input.budget
        : input.current >= input.budget
}

export async function recordHealthMetric(input: HealthReportInput): Promise<void> {
    await recordHealthReport({
        ...input,
        passed: input.passed ?? passesComparison(input),
        timestamp: new Date().toISOString(),
    })
}

export {removeHealthReports}

// Gate the test on a metric's budget. severity='gate' (default) fails the test
// via vitest expect; severity='warning' only logs to stderr so the dashboard
// still shows the over-budget tile but push / npm run test is not blocked.
export function assertHealthBudget(args: {
    readonly metricId: string
    readonly formattedSummary: string
    readonly severity?: 'gate' | 'warning'
}): void {
    if (args.formattedSummary === '') return
    if (args.severity === 'warning') {
        console.warn(`[warning-only] ${args.metricId}\n${args.formattedSummary}`)
        return
    }
    expect(args.formattedSummary).toBe('')
}
