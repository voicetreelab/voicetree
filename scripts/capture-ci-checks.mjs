#!/usr/bin/env node
// Run every locally-runnable CI/CD check, capture pass/fail + counts + duration,
// and write a CheckReport per check via recordCheckReport(). Pure orchestration —
// it never patches existing scripts; everything is invoked through spawn().
//
// Measure inventory is auto-detected: every `.ts` file in `scripts/measures/`
// (excluding `_*.ts`) is dynamically imported and must export `check: CheckDef`.
// Adding a new check = drop a new .ts file in that folder.

import {spawn} from 'node:child_process'
import {mkdir, mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {pathToFileURL, fileURLToPath} from 'node:url'

import {recordCheckReport} from '../packages/systems/_ci-check-writer.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const MEASURES_DIR = join(SCRIPT_DIR, 'measures')

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

// ── Auto-detected measure inventory ──────────────────────────────────────────

async function loadChecks() {
    const entries = await readdir(MEASURES_DIR, {withFileTypes: true})
    const files = entries
        .filter(e => e.isFile() && e.name.endsWith('.ts') && !e.name.startsWith('_'))
        .map(e => e.name)
        .sort()
    const checks = []
    for (const file of files) {
        const url = pathToFileURL(join(MEASURES_DIR, file)).href
        const mod = await import(url)
        if (!mod.check) throw new Error(`measure file ${file} must export \`check\``)
        checks.push(mod.check)
    }
    return checks
}

const CHECKS = await loadChecks()

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = {quick: false, failFast: false, only: null, help: false}
    for (const arg of argv) {
        if (arg === '--quick') opts.quick = true
        else if (arg === '--fail-fast') opts.failFast = true
        else if (arg === '-h' || arg === '--help') opts.help = true
        else if (arg.startsWith('--only=')) opts.only = new Set(arg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean))
        else throw new Error(`unknown flag: ${arg}`)
    }
    return opts
}

function printHelp() {
    const lines = [
        'capture-ci-checks — run every locally-runnable CI/CD check and record reports.',
        '',
        'Usage:',
        '  npm run health:capture-ci -- [--quick] [--only=id1,id2,...] [--fail-fast]',
        '',
        'Flags:',
        '  --quick           skip checks marked slow:true (Stryker mutation).',
        '  --only=<ids>      run only the listed check ids; others are recorded with status=skip.',
        '  --fail-fast       still records every check that ran, but stops scheduling after the first fail.',
        '',
        'Check ids:',
        ...CHECKS.map(c => `  ${c.id.padEnd(24)} ${c.category.padEnd(11)} ${c.display}`),
    ]
    console.log(lines.join('\n'))
}

// ── Subprocess runner ────────────────────────────────────────────────────────

function summarizeStderr(text, maxLines = 4) {
    if (!text) return undefined
    const lines = text.split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean)
    if (lines.length === 0) return undefined
    const tail = lines.slice(-maxLines)
    return tail.join('\n').slice(0, 800)
}

async function spawnCheck(check, env) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ci-check-'))
    const jsonOut = check.parser === 'vitest' ? join(tmpDir, 'vitest.json') : null
    const playwrightJson = check.parser === 'playwright' ? join(tmpDir, 'playwright.json') : null
    const args = check.args(jsonOut)
    const [cmd, ...rest] = args
    const timeoutMs = check.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startedAt = Date.now()
    const childEnv = {
        ...env,
        ...(playwrightJson ? {PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightJson} : {}),
    }

    let stdoutBuf = ''
    let stderrBuf = ''
    let timedOut = false

    const result = await new Promise(resolve => {
        const child = spawn(cmd, rest, {
            cwd: REPO_ROOT,
            env: childEnv,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const timer = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
        }, timeoutMs)
        child.stdout.on('data', chunk => { stdoutBuf += chunk.toString('utf8') })
        child.stderr.on('data', chunk => { stderrBuf += chunk.toString('utf8') })
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
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {})

    const exitOk = result.exitCode === 0 && !timedOut && !result.spawnError
    return {
        durationMs,
        exitCode: result.exitCode ?? -1,
        signal: result.signal,
        timedOut,
        spawnError: result.spawnError,
        stdoutTail: summarizeStderr(stdoutBuf),
        stderrTail: summarizeStderr(stderrBuf),
        status: exitOk ? 'pass' : 'fail',
        ...counts,
    }
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

// ── Reporting ────────────────────────────────────────────────────────────────

function statusGlyph(status) {
    if (status === 'pass') return '\x1b[32m✓\x1b[0m'
    if (status === 'fail') return '\x1b[31m✗\x1b[0m'
    return '\x1b[90m·\x1b[0m'
}

function fmtMs(ms) {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return `${m}m${s.toString().padStart(2, '0')}s`
}

function formatCounts(r) {
    if (r.testsTotal === undefined) return ''
    const p = r.testsPassed ?? 0
    const f = r.testsFailed ?? 0
    const s = r.testsSkipped ?? 0
    return `(${p}/${r.testsTotal} pass, ${f} fail, ${s} skip)`
}

function printRow(check, outcome) {
    const id = check.id.padEnd(24)
    const cat = `[${check.category}]`.padEnd(13)
    const dur = outcome.status === 'skip' ? '—' : fmtMs(outcome.durationMs)
    const counts = formatCounts(outcome)
    console.log(`${statusGlyph(outcome.status)} ${id} ${cat} ${dur.padStart(7)}  ${counts}`)
}

// ── Top-level orchestration ──────────────────────────────────────────────────

async function recordSkipped(check, reason) {
    await recordCheckReport({
        checkId: check.id,
        checkName: check.name,
        category: check.category,
        command: check.display,
        status: 'skip',
        durationMs: 0,
        slow: check.slow,
        timestamp: new Date().toISOString(),
        details: {reason},
    })
}

async function recordOutcome(check, outcome) {
    const errorSummary = outcome.status === 'fail'
        ? (outcome.spawnError ?? outcome.stderrTail ?? outcome.stdoutTail)
        : undefined
    /** @type {Record<string, unknown>} */
    const details = {exitCode: outcome.exitCode}
    if (outcome.timedOut) details.timedOut = true
    if (outcome.signal) details.signal = outcome.signal
    if (outcome.spawnError) details.spawnError = outcome.spawnError
    await recordCheckReport({
        checkId: check.id,
        checkName: check.name,
        category: check.category,
        command: check.display,
        status: outcome.status,
        durationMs: outcome.durationMs,
        testsTotal: outcome.testsTotal,
        testsPassed: outcome.testsPassed,
        testsFailed: outcome.testsFailed,
        testsSkipped: outcome.testsSkipped,
        slow: check.slow,
        errorSummary,
        timestamp: new Date().toISOString(),
        details,
    })
}

async function main() {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.help) {
        printHelp()
        return 0
    }

    if (opts.only) {
        const ids = new Set(CHECKS.map(c => c.id))
        for (const id of opts.only) {
            if (!ids.has(id)) {
                console.error(`unknown --only id: ${id}`)
                return 2
            }
        }
    }

    await mkdir(join(REPO_ROOT, 'health-dashboard', 'reports', 'checks'), {recursive: true})

    console.log(`\n  capture-ci-checks · ${CHECKS.length} checks total\n`)

    let failed = 0
    let stopScheduling = false
    for (const check of CHECKS) {
        const explicitOnly = opts.only && !opts.only.has(check.id)
        const skipForQuick = opts.quick && check.slow === true
        const skipForFailFast = stopScheduling

        if (explicitOnly || skipForQuick || skipForFailFast) {
            const reason = explicitOnly ? 'not in --only' : skipForQuick ? 'slow:true skipped by --quick' : 'stopped by --fail-fast'
            await recordSkipped(check, reason)
            printRow(check, {status: 'skip', durationMs: 0})
            continue
        }

        let outcome
        try {
            outcome = await spawnCheck(check, process.env)
        } catch (err) {
            outcome = {
                status: 'fail',
                durationMs: 0,
                exitCode: -1,
                signal: null,
                timedOut: false,
                spawnError: String(err?.message ?? err),
                stdoutTail: undefined,
                stderrTail: undefined,
            }
        }
        try {
            await recordOutcome(check, outcome)
        } catch (err) {
            console.error(`failed to write report for ${check.id}: ${err?.message ?? err}`)
        }
        printRow(check, outcome)
        if (outcome.status === 'fail') {
            failed++
            if (opts.failFast) stopScheduling = true
        }
    }

    console.log(`\n  done · ${failed} failing\n`)
    return failed === 0 ? 0 : 1
}

main().then(code => process.exit(code)).catch(err => {
    console.error(err)
    process.exit(2)
})
