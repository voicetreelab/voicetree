import {spawn} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {vitestFailureDetailsForCommand} from './vitest-failure-detail-reader.ts'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

export async function spawnCheck(check, env, repoRoot) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ci-check-'))
    const jsonOut = check.parser === 'vitest' ? join(tmpDir, 'vitest.json') : null
    const playwrightJson = check.parser === 'playwright' ? join(tmpDir, 'playwright.json') : null
    const args = check.args(jsonOut)
    const [cmd, ...rest] = args
    const timeoutMs = check.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startedAt = Date.now()
    const childEnv = {
        ...env,
        VT_REMOTE_EXEC: '1',
        ...(playwrightJson ? {PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightJson} : {}),
    }

    let stdoutBuf = ''
    let stderrBuf = ''
    let timedOut = false

    const result = await new Promise(resolve => {
        const child = spawn(cmd, rest, {
            cwd: repoRoot,
            env: childEnv,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const timer = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
        }, timeoutMs)
        child.stdout.on('data', chunk => {
            stdoutBuf += chunk.toString('utf8')
            process.stdout.write(chunk)
        })
        child.stderr.on('data', chunk => {
            stderrBuf += chunk.toString('utf8')
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

    const durationMs = Date.now() - startedAt
    const counts = await parseCounts(check.parser, jsonOut, playwrightJson)
    const exitOk = result.exitCode === 0 && !timedOut && !result.spawnError
    const status = exitOk ? 'pass' : 'fail'
    const failureDetails = status === 'fail' && check.parser === 'vitest'
        ? await vitestFailureDetailsForCommand(args, message => console.warn(message), `capture-ci-checks:${check.id}`)
        : {}
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {})

    return {
        durationMs,
        exitCode: result.exitCode ?? -1,
        signal: result.signal,
        timedOut,
        spawnError: result.spawnError,
        stdoutTail: summarizeStderr(stdoutBuf),
        stderrTail: summarizeStderr(stderrBuf),
        status,
        failureDetails,
        ...counts,
    }
}

function summarizeStderr(text, maxLines = 4) {
    if (!text) return undefined
    const lines = text.split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean)
    if (lines.length === 0) return undefined
    const tail = lines.slice(-maxLines)
    return tail.join('\n').slice(0, 800)
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
        const s = json.stats
        const expected = numberOrZero(s.expected)
        const unexpected = numberOrZero(s.unexpected)
        const skipped = numberOrZero(s.skipped)
        const flaky = numberOrZero(s.flaky)
        return {
            testsTotal: expected + unexpected + skipped + flaky,
            testsPassed: expected + flaky,
            testsFailed: unexpected,
            testsSkipped: skipped,
        }
    }
    return {}
}

function numberOrUndef(n) {
    return Number.isFinite(n) ? n : undefined
}

function numberOrZero(n) {
    return Number.isFinite(n) ? n : 0
}
