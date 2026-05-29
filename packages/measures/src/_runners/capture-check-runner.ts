import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {vitestFailureDetailsForCommand} from './vitest-failure-detail-reader.ts'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const SUPPORTS_PROCESS_GROUP_KILL = process.platform !== 'win32'

// Per-stream cap on the captured tail. Bounded so a runaway check cannot
// balloon memory, but generous enough that a structured failure report
// (e.g. the BAR-bracketed "Refused: …" block emitted by the directory-fanout
// and name-uniqueness gates, ~30-200 lines depending on violation count)
// survives intact for the failure summary.
const MAX_TAIL_BYTES = 64 * 1024
const MAX_TAIL_LINES = 200
const MAX_TAIL_CHARS = 16_000

function killCheckProcess(child: ChildProcess, signal: NodeJS.Signals) {
    if (!SUPPORTS_PROCESS_GROUP_KILL || child.pid === undefined) {
        child.kill(signal)
        return
    }
    try {
        process.kill(-child.pid, signal)
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ESRCH') throw err
    }
}

export async function spawnCheck(check, env, repoRoot) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ci-check-'))
    const jsonOut = check.parser === 'vitest' ? join(tmpDir, 'vitest.json') : null
    const playwrightJson = check.parser === 'playwright' ? join(tmpDir, 'playwright.json') : null
    const args = check.args(jsonOut)
    const [cmd, ...rest] = args
    const timeoutMs = check.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()
    const childEnv = {
        ...env,
        VT_REMOTE_EXEC: '1',
        ...(playwrightJson ? {PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightJson} : {}),
    }

    let stdoutBuf = ''
    let stderrBuf = ''
    let timedOut = false

    const appendTail = (current: string, chunk: string): string =>
        (current + chunk).slice(-MAX_TAIL_BYTES)

    const result = await new Promise(resolve => {
        const child = spawn(cmd, rest, {
            cwd: repoRoot,
            env: childEnv,
            detached: SUPPORTS_PROCESS_GROUP_KILL,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const timer = setTimeout(() => {
            timedOut = true
            killCheckProcess(child, 'SIGTERM')
            setTimeout(() => killCheckProcess(child, 'SIGKILL'), 5_000).unref()
        }, timeoutMs)
        child.stdout.on('data', chunk => {
            stdoutBuf = appendTail(stdoutBuf, chunk.toString('utf8'))
            process.stdout.write(chunk)
        })
        child.stderr.on('data', chunk => {
            stderrBuf = appendTail(stderrBuf, chunk.toString('utf8'))
            process.stderr.write(chunk)
        })
        child.on('error', err => {
            clearTimeout(timer)
            resolve({exitCode: -1, signal: null, spawnError: String(err.message ?? err)})
        })
        child.on('close', (code, signal) => {
            clearTimeout(timer)
            resolve({exitCode: code, signal, spawnError: null})
        })
    })

    const endedAtMs = Date.now()
    const endedAt = new Date(endedAtMs).toISOString()
    const durationMs = endedAtMs - startedAtMs
    const counts = await parseCounts(check.parser, jsonOut, playwrightJson)
    const exitOk = result.exitCode === 0 && !timedOut && !result.spawnError
    const status = exitOk ? 'pass' : 'fail'
    const failureDetails = status === 'fail' && check.parser === 'vitest'
        ? await vitestFailureDetailsForCommand(args, message => console.warn(message), `capture-ci-checks:${check.id}`)
        : {}
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {})

    return {
        startedAt,
        endedAt,
        durationMs,
        exitCode: result.exitCode ?? -1,
        signal: result.signal,
        timedOut,
        spawnError: result.spawnError,
        stdoutTail: tailForFailureSummary(stdoutBuf),
        stderrTail: tailForFailureSummary(stderrBuf),
        status,
        failureDetails,
        ...counts,
    }
}

// Sized so a structured failure report (BAR-bracketed "Refused: …" block from
// the directory-fanout and name-uniqueness gates) survives intact, letting the
// failure summary name the offending dirs / declarations rather than just
// the trailing remediation lines.
function tailForFailureSummary(text, maxLines = MAX_TAIL_LINES, maxChars = MAX_TAIL_CHARS) {
    if (!text) return undefined
    const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
    let end = lines.length
    while (end > 0 && lines[end - 1] === '') end -= 1
    if (end === 0) return undefined
    const start = Math.max(0, end - maxLines)
    const joined = lines.slice(start, end).join('\n')
    return joined.length <= maxChars ? joined : joined.slice(-maxChars)
}

async function readJsonIfExists(path) {
    if (!path) return null
    try {
        const raw = await readFile(path, 'utf8')
        return JSON.parse(raw)
    } catch {
        return null
    }
}

async function parseCounts(parser, vitestPath, playwrightPath) {
    if (parser === 'vitest') {
        const json = await readJsonIfExists(vitestPath)
        if (!json) return {}
        return {
            testsTotal: numberOrUndef(json.numTotalTests),
            testsPassed: numberOrUndef(json.numPassedTests),
            testsFailed: numberOrUndef(json.numFailedTests),
            testsSkipped: numberOrUndef(json.numPendingTests ?? json.numSkippedTests),
        }
    }
    if (parser === 'playwright') {
        const json = await readJsonIfExists(playwrightPath)
        if (!json?.stats) return {}
        return playwrightReportDetails(json)
    }
    return {}
}

function playwrightReportDetails(json) {
    const s = json.stats
    const allFailedTests = collectFailedPlaywrightTests(json)
    const failedTests = allFailedTests.slice(0, 10)
    return {
        testsTotal: numberOrZero(s.expected) + numberOrZero(s.unexpected) + numberOrZero(s.skipped) + numberOrZero(s.flaky),
        testsPassed: numberOrZero(s.expected) + numberOrZero(s.flaky),
        testsFailed: numberOrZero(s.unexpected),
        testsSkipped: numberOrZero(s.skipped),
        failureDetails: failedTests.length === 0 ? {} : {
            failedTests,
            failedTestsTruncated: allFailedTests.length > failedTests.length,
        },
    }
}

function collectFailedPlaywrightTests(json) {
    const failed = []
    for (const suite of json.suites ?? []) {
        collectFailedPlaywrightTestsFromSuite(suite, [], failed)
    }
    return failed
}

function collectFailedPlaywrightTestsFromSuite(suite, parentTitles, failed) {
    const titlePath = suite.title ? [...parentTitles, suite.title] : parentTitles
    for (const spec of suite.specs ?? []) {
        if (spec.ok !== false) continue
        const failedResult = firstFailedPlaywrightResult(spec)
        const message = failedResult?.errors?.[0]?.message ?? failedResult?.error?.message
        failed.push({
            fullName: [...titlePath, spec.title].filter(Boolean).join(' > '),
            fileName: spec.file,
            message,
        })
    }
    for (const child of suite.suites ?? []) {
        collectFailedPlaywrightTestsFromSuite(child, titlePath, failed)
    }
}

function firstFailedPlaywrightResult(spec) {
    for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
            if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted') {
                return result
            }
        }
    }
    return null
}

function numberOrUndef(n) {
    return Number.isFinite(n) ? n : undefined
}

function numberOrZero(n) {
    return Number.isFinite(n) ? n : 0
}
