import type {File, Task, Test} from '@vitest/runner'
import type {Reporter} from 'vitest/reporters'

import {messageOf} from '../messageOf.ts'
import {recordCheckReport, type CheckReport} from './check-report-writer.ts'

type ReporterOptions = {
    readonly checkId?: string
    readonly checkName?: string
    readonly command?: string
}

type Counts = {
    readonly testsTotal: number
    readonly testsPassed: number
    readonly testsFailed: number
    readonly testsSkipped: number
}

const EMPTY_COUNTS: Counts = {
    testsTotal: 0,
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
}

function countTask(task: Task): Counts {
    if (task.type === 'test') {
        const state = task.result?.state
        return {
            testsTotal: 1,
            testsPassed: state === 'pass' ? 1 : 0,
            testsFailed: state === 'fail' ? 1 : 0,
            testsSkipped: state === 'skip' || task.mode === 'skip' || task.mode === 'todo' ? 1 : 0,
        }
    }

    return task.tasks.reduce((acc, child) => {
        const counts = countTask(child)
        return {
            testsTotal: acc.testsTotal + counts.testsTotal,
            testsPassed: acc.testsPassed + counts.testsPassed,
            testsFailed: acc.testsFailed + counts.testsFailed,
            testsSkipped: acc.testsSkipped + counts.testsSkipped,
        }
    }, EMPTY_COUNTS)
}

function countFiles(files: readonly File[]): Counts {
    return files.reduce(
        (acc, file) => {
            const counts = countTask(file)
            return {
                testsTotal: acc.testsTotal + counts.testsTotal,
                testsPassed: acc.testsPassed + counts.testsPassed,
                testsFailed: acc.testsFailed + counts.testsFailed,
                testsSkipped: acc.testsSkipped + counts.testsSkipped,
            }
        },
        EMPTY_COUNTS,
    )
}

function flattenTests(task: Task): Test[] {
    if (task.type === 'test') return [task]
    return task.tasks.flatMap(flattenTests)
}

function summarizeError(value: unknown): string {
    return messageOf(value)
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .slice(0, 4)
        .join('\n')
        .slice(0, 800)
}

function firstFailure(files: readonly File[], errors: readonly unknown[]): unknown | undefined {
    for (const test of files.flatMap(flattenTests)) {
        if (test.result?.state === 'fail') return test.result.errors?.[0] ?? test.name
    }
    return errors[0]
}

function statusFor(counts: Counts, errors: readonly unknown[]): CheckReport['status'] {
    if (counts.testsFailed > 0 || errors.length > 0) return 'fail'
    if (counts.testsTotal === 0) return 'skip'
    return 'pass'
}

function requireOption(options: ReporterOptions, key: keyof ReporterOptions): string {
    const value = options[key]
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`missing Vitest CI check reporter option: ${key}`)
    }
    return value
}

export default class VitestCiCheckReporter implements Reporter {
    private startedAtMs = Date.now()

    constructor(private readonly options: ReporterOptions = {}) {}

    onInit(): void {
        this.startedAtMs = Date.now()
    }

    async onFinished(files: File[] = [], errors: unknown[] = []): Promise<void> {
        try {
            const counts = countFiles(files)
            const status = statusFor(counts, errors)
            const failure = status === 'fail' ? firstFailure(files, errors) : undefined
            const endedAtMs = Date.now()

            await recordCheckReport({
                checkId: requireOption(this.options, 'checkId'),
                checkName: requireOption(this.options, 'checkName'),
                category: 'Unit',
                command: requireOption(this.options, 'command'),
                status,
                durationMs: endedAtMs - this.startedAtMs,
                startedAt: new Date(this.startedAtMs).toISOString(),
                endedAt: new Date(endedAtMs).toISOString(),
                testsTotal: counts.testsTotal,
                testsPassed: counts.testsPassed,
                testsFailed: counts.testsFailed,
                testsSkipped: counts.testsSkipped,
                errorSummary: failure === undefined ? undefined : summarizeError(failure),
                timestamp: new Date().toISOString(),
                details: {exitCode: status === 'pass' ? 0 : 1},
            })
        } catch (err) {
            console.warn(`[vitest-ci-check-reporter] failed to record CI check report: ${messageOf(err)}`)
        }
    }
}
