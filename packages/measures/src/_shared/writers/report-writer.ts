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
