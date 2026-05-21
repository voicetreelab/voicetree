#!/usr/bin/env node
// Run every locally-runnable CI/CD check, capture pass/fail + counts + duration,
// and write a CheckReport per check via recordCheckReport(). Pure orchestration —
// it never patches existing scripts; everything is invoked through spawn().
//
// Measure inventory is auto-detected: every `.ts` file under `scripts/measures/src/`
// (excluding `_*.ts`) is dynamically imported and must export `check: CheckDef`.
// Adding a new check = drop a new .ts file anywhere in that tree.

import {spawn} from 'node:child_process'
import {mkdir, mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {pathToFileURL, fileURLToPath} from 'node:url'

import {recordCheckReport} from '@vt/ci-reporting'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const MEASURES_DIR = join(SCRIPT_DIR, 'measures', 'src')

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

// ── Auto-detected measure inventory ──────────────────────────────────────────

async function discoverMeasureFiles(dir = MEASURES_DIR) {
    const entries = await readdir(dir, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return discoverMeasureFiles(path)
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.startsWith('_')) return []
        return [path]
    }))
    return nested.flat()
}

async function loadChecks(folder = null) {
    const files = (await discoverMeasureFiles())
        .filter(file => folder === null || relativePath(relative(MEASURES_DIR, file)).startsWith(`${folder}/`))
        .sort((a, b) => relativePath(relative(MEASURES_DIR, a)).localeCompare(relativePath(relative(MEASURES_DIR, b))))
    const checks = []
    for (const file of files) {
        const measurePath = relativePath(relative(REPO_ROOT, file))
        const url = pathToFileURL(file).href
        const mod = await import(url)
        if (!mod.check) throw new Error(`measure file ${measurePath} must export \`check\``)
        checks.push({...mod.check, measurePath, measureFolder: measureFolderFor(measurePath)})
    }
    return checks
}

function relativePath(path) {
    return path.split(sep).join('/')
}

function normalizeMeasureFolder(folder) {
    if (!folder) return null
    const normalized = folder.replace(/^scripts\/measures\/src\//, '').replace(/^\/+|\/+$/g, '')
    if (normalized.includes('..')) throw new Error(`measure folder must stay inside scripts/measures/src: ${folder}`)
    return normalized
}

function measureFolderFor(measurePath) {
    const relativeMeasure = measurePath.replace(/^scripts\/measures\/src\//, '')
    const slash = relativeMeasure.indexOf('/')
    return slash === -1 ? '' : relativeMeasure.slice(0, slash)
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = {quick: false, failFast: false, sequential: false, only: null, folder: null, help: false}
    for (const arg of argv) {
        if (arg === '--quick') opts.quick = true
        else if (arg === '--fail-fast') opts.failFast = true
        else if (arg === '--sequential') opts.sequential = true
        else if (arg === '-h' || arg === '--help') opts.help = true
        else if (arg.startsWith('--only=')) opts.only = new Set(arg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean))
        else if (arg.startsWith('--folder=')) opts.folder = normalizeMeasureFolder(arg.slice('--folder='.length))
        else throw new Error(`unknown flag: ${arg}`)
    }
    return opts
}

function printHelp(checks) {
    const lines = [
        'capture-ci-checks — run every locally-runnable CI/CD check and record reports.',
        '',
        'Usage:',
        '  npm run health:capture-ci -- [--quick] [--only=id1,id2,...] [--folder=tier_1] [--sequential] [--fail-fast]',
        '',
        'Flags:',
        '  --quick           skip checks marked slow:true (Stryker mutation).',
        '  --only=<ids>      run only the listed check ids; others are recorded with status=skip.',
        '  --folder=<path>   run only checks under scripts/measures/src/<path>.',
        '  --sequential      run checks sequentially; continue through failures.',
        '  --fail-fast       run sequentially; stop scheduling after the first fail.',
        '',
        'Eligible checks run in parallel unless --sequential or --fail-fast is set.',
        '',
        'Check ids:',
        ...checks.map(c => `  ${c.id.padEnd(32)} ${c.category.padEnd(11)} ${c.measurePath}`),
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

async function recordOutcome(check, outcome) {
    const errorSummary = outcome.status === 'fail'
        ? (outcome.spawnError ?? outcome.stderrTail ?? outcome.stdoutTail)
        : undefined
    /** @type {Record<string, unknown>} */
    const details = {exitCode: outcome.exitCode, measurePath: check.measurePath, measureFolder: check.measureFolder}
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

function shouldSkipCheck(check, opts, stopScheduling = false) {
    return (opts.only && !opts.only.has(check.id)) || (opts.quick && check.slow === true) || stopScheduling
}

function skippedOutcome() {
    return {status: 'skip', durationMs: 0}
}

function failedSpawnOutcome(err) {
    return {
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

async function runCheck(check) {
    try {
        return await spawnCheck(check, process.env)
    } catch (err) {
        return failedSpawnOutcome(err)
    }
}

async function runChecksInParallel(checks, opts) {
    const parallelChecks = checks.filter(check => check.category !== 'Integration')
    const integrationChecks = checks.filter(check => check.category === 'Integration')
    const parallelResults = await Promise.all(parallelChecks.map(async check => ({
        check,
        outcome: shouldSkipCheck(check, opts) ? skippedOutcome() : await runCheck(check),
    })))
    const integrationResults = []
    for (const check of integrationChecks) {
        integrationResults.push({
            check,
            outcome: shouldSkipCheck(check, opts) ? skippedOutcome() : await runCheck(check),
        })
    }
    return checks.map(check =>
        parallelResults.find(result => result.check === check)
        ?? integrationResults.find(result => result.check === check),
    )
}

async function runChecksSequentially(checks, opts) {
    const results = []
    let stopScheduling = false
    for (const check of checks) {
        const outcome = shouldSkipCheck(check, opts, stopScheduling) ? skippedOutcome() : await runCheck(check)
        results.push({check, outcome})
        if (opts.failFast && outcome.status === 'fail') stopScheduling = true
    }
    return results
}

async function main() {
    const opts = parseArgs(process.argv.slice(2))
    const checks = await loadChecks(opts.folder)
    if (opts.help) {
        printHelp(checks)
        return 0
    }

    if (opts.only) {
        const ids = new Set(checks.map(c => c.id))
        for (const id of opts.only) {
            if (!ids.has(id)) {
                console.error(`unknown --only id: ${id}`)
                return 2
            }
        }
    }

    await mkdir(join(REPO_ROOT, 'health-dashboard', 'reports', 'checks'), {recursive: true})

    const scope = opts.folder ? ` under scripts/measures/src/${opts.folder}` : ''
    console.log(`\n  capture-ci-checks · ${checks.length} checks total${scope}\n`)

    const results = opts.failFast || opts.sequential
        ? await runChecksSequentially(checks, opts)
        : await runChecksInParallel(checks, opts)

    let failed = 0
    for (const {check, outcome} of results) {
        if (outcome.status !== 'skip') {
            try {
                await recordOutcome(check, outcome)
            } catch (err) {
                console.error(`failed to write report for ${check.id}: ${err?.message ?? err}`)
            }
        }
        printRow(check, outcome)
        if (outcome.status === 'fail') {
            failed++
        }
    }

    console.log(`\n  done · ${failed} failing\n`)
    return failed === 0 ? 0 : 1
}

main().then(code => process.exit(code)).catch(err => {
    console.error(err)
    process.exit(2)
})
