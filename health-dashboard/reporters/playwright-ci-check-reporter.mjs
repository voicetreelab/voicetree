import {spawn} from 'node:child_process'

const WRITER_SPECIFIER = '@vt/measures/check-report-writer'
const RECORD_SCRIPT = `
const report = JSON.parse(process.env.PLAYWRIGHT_CI_CHECK_REPORT)
const {recordCheckReport} = await import(process.env.PLAYWRIGHT_CI_CHECK_WRITER_SPECIFIER)
await recordCheckReport(report)
`

const DEFAULT_OPTIONS = {
    checkId: 'playwright',
    checkName: 'Playwright',
    command: 'playwright test',
}

async function recordWithCiCheckWriter(report) {
    const stderr = []
    const result = await new Promise(resolve => {
        const child = spawn(process.execPath, [
            '--no-warnings=ExperimentalWarning',
            '--experimental-strip-types',
            '--input-type=module',
            '-e',
            RECORD_SCRIPT,
        ], {
            env: {
                ...process.env,
                PLAYWRIGHT_CI_CHECK_REPORT: JSON.stringify(report),
                PLAYWRIGHT_CI_CHECK_WRITER_SPECIFIER: WRITER_SPECIFIER,
            },
            stdio: ['ignore', 'ignore', 'pipe'],
        })
        child.stderr.on('data', chunk => stderr.push(chunk.toString('utf8')))
        child.on('error', err => resolve({exitCode: -1, error: err}))
        child.on('close', code => resolve({exitCode: code ?? -1, error: null}))
    })

    if (result.exitCode !== 0) {
        const detail = result.error instanceof Error ? result.error.message : stderr.join('').trim()
        throw new Error(detail || `recordCheckReport exited with code ${result.exitCode}`)
    }
}

function countTests(suite) {
    const tests = typeof suite?.allTests === 'function' ? suite.allTests() : []
    const counts = {
        testsTotal: tests.length,
        testsPassed: 0,
        testsFailed: 0,
        testsSkipped: 0,
    }

    for (const test of tests) {
        const outcome = typeof test.outcome === 'function' ? test.outcome() : undefined
        if (outcome === 'skipped') counts.testsSkipped += 1
        else if (outcome === 'unexpected') counts.testsFailed += 1
        else if (outcome === 'expected' || outcome === 'flaky') counts.testsPassed += 1
        else if ((test.results ?? []).some(result => result.status === 'skipped')) counts.testsSkipped += 1
        else if ((test.results ?? []).some(result => result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted')) counts.testsFailed += 1
        else counts.testsPassed += 1
    }

    return counts
}

function firstErrorMessage(suite) {
    const tests = typeof suite?.allTests === 'function' ? suite.allTests() : []
    for (const test of tests) {
        for (const result of test.results ?? []) {
            for (const error of result.errors ?? []) {
                const message = error.message ?? error.stack ?? error.value
                if (typeof message === 'string' && message.trim()) return message
            }
        }
    }
    return undefined
}

function summarizeError(message) {
    if (!message) return undefined
    const lines = message.split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 4)
    if (lines.length === 0) return undefined
    return lines.join('\n').slice(0, 800)
}

function isFailedResult(result) {
    return result?.status === 'failed' || result?.status === 'timedOut' || result?.status === 'interrupted'
}

function isFailedTest(test) {
    const outcome = typeof test.outcome === 'function' ? test.outcome() : undefined
    return outcome === 'unexpected' || (test.results ?? []).some(isFailedResult)
}

function firstFailedResult(test) {
    return (test.results ?? []).find(isFailedResult)
}

function firstErrorMessageForResult(result) {
    for (const error of result?.errors ?? []) {
        const message = error.message ?? error.stack ?? error.value
        if (typeof message === 'string' && message.trim()) return message
    }
    return undefined
}

function fullNameForTest(test) {
    const titlePath = typeof test.titlePath === 'function' ? test.titlePath() : []
    const fullName = titlePath.filter(Boolean).join(' > ')
    return fullName || test.title || '(unknown Playwright test)'
}

function failedTestDetails(suite) {
    const tests = typeof suite?.allTests === 'function' ? suite.allTests() : []
    const allFailedTests = tests
        .filter(isFailedTest)
        .map(test => {
            const failedResult = firstFailedResult(test)
            return {
                fullName: fullNameForTest(test),
                fileName: test.location?.file,
                message: firstErrorMessageForResult(failedResult),
            }
        })
    const failedTests = allFailedTests.slice(0, 10)
    return failedTests.length === 0 ? {} : {
        failedTests,
        failedTestsTruncated: allFailedTests.length > failedTests.length,
    }
}

function formatFailedTests(details) {
    const failedTests = details.failedTests ?? []
    if (failedTests.length === 0) return undefined
    const lines = failedTests.flatMap(test => {
        const where = test.fileName ? `  (${test.fileName})` : ''
        const head = `      • ${test.fullName}${where}`
        const message = summarizeError(test.message)
        return message ? [head, ...message.split('\n').map(line => `        ${line}`)] : [head]
    })
    if (details.failedTestsTruncated) lines.push('      … (more failures truncated)')
    return lines.join('\n')
}

function statusFromResult(result, counts) {
    if (counts.testsTotal === 0) return 'skip'
    return result.status === 'passed' ? 'pass' : 'fail'
}

export default class PlaywrightCiCheckReporter {
    constructor(options = {}) {
        this.options = {...DEFAULT_OPTIONS, ...options}
        this.startedAt = Date.now()
        this.suite = null
    }

    onBegin(_config, suite) {
        this.startedAt = Date.now()
        this.suite = suite
    }

    async onEnd(result) {
        try {
            if (process.argv.includes('--list')) return

            const endedAtMs = Date.now()
            const durationMs = endedAtMs - this.startedAt
            const counts = countTests(this.suite)
            const status = statusFromResult(result, counts)
            const failureDetails = status === 'fail' ? failedTestDetails(this.suite) : {}
            const errorSummary = status === 'fail'
                ? (formatFailedTests(failureDetails) ?? summarizeError(firstErrorMessage(this.suite)))
                : undefined

            await recordWithCiCheckWriter({
                checkId: this.options.checkId,
                checkName: this.options.checkName,
                category: 'E2E',
                command: this.options.command,
                status,
                durationMs,
                startedAt: new Date(this.startedAt).toISOString(),
                endedAt: new Date(endedAtMs).toISOString(),
                ...counts,
                errorSummary,
                timestamp: new Date(endedAtMs).toISOString(),
                details: {exitCode: status === 'pass' ? 0 : 1, ...failureDetails},
            })
        } catch (err) {
            console.warn(`[playwright-ci-check-reporter] failed to record CI check report: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
}
