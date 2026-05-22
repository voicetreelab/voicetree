#!/usr/bin/env node
// Run every locally-runnable CI/CD check, capture pass/fail + counts + duration,
// and write a CheckReport per check via recordCheckReport(). Pure orchestration —
// it never patches existing scripts; everything is invoked through spawn().
//
// Measure inventory is auto-detected from the tiered `checks/` tree.

import {spawn} from 'node:child_process'
import {mkdir, mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {availableParallelism, tmpdir} from 'node:os'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {pathToFileURL, fileURLToPath} from 'node:url'

import {recordCheckReport} from '../_shared/check-report-writer.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const MEASURES_DIR = join(REPO_ROOT, 'packages', 'measures', 'src')
const CHECKS_DIR = join(MEASURES_DIR, 'checks')
const MAX_TIER = 3

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_PARALLELISM = Math.max(1, availableParallelism())

// ── Auto-detected measure inventory ──────────────────────────────────────────

async function discoverMeasureFiles(dir = MEASURES_DIR) {
    const entries = await readdir(dir, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return entry.name.startsWith('_') ? [] : discoverMeasureFiles(path)
        const isSuiteCheck = entry.name === '_all.check.ts'
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
        if (entry.name.startsWith('_') && !isSuiteCheck) return []
        return [path]
    }))
    return nested.flat()
}

async function loadChecks(opts) {
    const files = (await discoverScheduledMeasureFiles(opts.tierMax ?? MAX_TIER))
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

async function discoverScheduledMeasureFiles(tierMax) {
    const tierDirs = Array.from({length: tierMax + 1}, (_, tier) => join(CHECKS_DIR, `tier_${tier}`))
    return (await Promise.all(tierDirs.map(discoverMeasureFilesIfPresent))).flat()
}

async function discoverMeasureFilesIfPresent(dir) {
    try {
        return await discoverMeasureFiles(dir)
    } catch (err) {
        if (err?.code === 'ENOENT') return []
        throw err
    }
}

function relativePath(path) {
    return path.split(sep).join('/')
}

function parseTierMax(raw, flag) {
    if (!/^\d+$/.test(raw)) throw new Error(`${flag} expects an integer tier from 0 through ${MAX_TIER}`)
    const tierMax = Number(raw)
    if (tierMax < 0 || tierMax > MAX_TIER) {
        throw new Error(`${flag} expects an integer tier from 0 through ${MAX_TIER}`)
    }
    return tierMax
}

function measureFolderFor(measurePath) {
    const relativeMeasure = measurePath.replace(/^packages\/measures\/src\//, '')
    const slash = relativeMeasure.indexOf('/')
    return slash === -1 ? '' : relativeMeasure.slice(0, slash)
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = {failFast: false, sequential: false, only: null, tierMax: null, help: false}
    for (const arg of argv) {
        if (arg === '--fail-fast') opts.failFast = true
        else if (arg === '--sequential') opts.sequential = true
        else if (arg === '-h' || arg === '--help') opts.help = true
        else if (arg.startsWith('--only=')) opts.only = new Set(arg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean))
        else if (arg.startsWith('--tier<=')) opts.tierMax = parseTierMax(arg.slice('--tier<='.length), '--tier<=')
        else if (arg.startsWith('--tier-max=')) opts.tierMax = parseTierMax(arg.slice('--tier-max='.length), '--tier-max')
        else if (arg.startsWith('--max-tier=')) opts.tierMax = parseTierMax(arg.slice('--max-tier='.length), '--max-tier')
        else throw new Error(`unknown flag: ${arg}`)
    }
    return opts
}

function printHelp(checks) {
    const lines = [
        'capture-ci-checks — run every locally-runnable CI/CD check and record reports.',
        '',
        'Usage:',
        '  npm run measures:capture-ci -- [--only=id1,id2,...] [--tier<=N] [--sequential] [--fail-fast]',
        '',
        'Flags:',
        '  --only=<ids>      run only the listed check ids; others are recorded with status=skip.',
        '  --tier<=N         run checks under checks/tier_0 through checks/tier_N.',
        '  --tier-max=N      shell-safe alias for --tier<=N.',
        '  --max-tier=N      shell-safe alias for --tier<=N.',
        '  --sequential      run checks sequentially; continue through failures.',
        '  --fail-fast       run sequentially; stop scheduling after the first fail.',
        '',
        'Eligible checks run in a bounded parallel pool unless --sequential or --fail-fast is set.',
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
        errorSummary,
        timestamp: new Date().toISOString(),
        details,
    })
}

function shouldSkipCheck(check, opts, stopScheduling = false) {
    return (opts.only && !opts.only.has(check.id)) || stopScheduling
}

function skippedOutcome() {
    return {status: 'skip', durationMs: 0}
}

function describeScope(opts) {
    if (opts.tierMax !== null) return ` at tier <=${opts.tierMax}`
    return ''
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

function checkPhase(check) {
    const phase = check.phase ?? 'parallel'
    if (phase !== 'parallel' && phase !== 'isolated') {
        throw new Error(`check ${check.id} has unsupported phase: ${phase}`)
    }
    return phase
}

function partitionChecksByPhase(checks) {
    const phases = {parallel: [], isolated: []}
    for (const check of checks) {
        phases[checkPhase(check)].push(check)
    }
    return phases
}

function shouldRunExclusivelyWithinParallelPhase(check) {
    return check.category === 'Integration' || check.exclusive === true
}

async function runCheckWithSkip(check, opts) {
    return {
        check,
        outcome: shouldSkipCheck(check, opts) ? skippedOutcome() : await runCheck(check),
    }
}

async function runChecksWithConcurrency(checks, opts, concurrency = DEFAULT_PARALLELISM) {
    if (checks.length === 0) return []
    const results = Array(checks.length)
    let nextIndex = 0
    const workerCount = Math.min(Math.max(1, concurrency), checks.length)
    const workers = Array.from({length: workerCount}, async () => {
        while (nextIndex < checks.length) {
            const index = nextIndex
            nextIndex += 1
            results[index] = await runCheckWithSkip(checks[index], opts)
        }
    })
    await Promise.all(workers)
    return results
}

async function runChecksSerially(checks, opts) {
    const results = []
    for (const check of checks) {
        results.push(await runCheckWithSkip(check, opts))
    }
    return results
}

function restoreDiscoveryOrder(checks, unorderedResults) {
    const byCheck = new Map(unorderedResults.map(result => [result.check, result]))
    return checks.map(check => {
        const result = byCheck.get(check)
        if (!result) throw new Error(`missing runner result for check ${check.id}`)
        return result
    })
}

async function runChecksInParallel(checks, opts) {
    const {parallel, isolated} = partitionChecksByPhase(checks)
    const parallelChecks = parallel.filter(check => !shouldRunExclusivelyWithinParallelPhase(check))
    const exclusiveChecks = parallel.filter(shouldRunExclusivelyWithinParallelPhase)
    const parallelResults = await runChecksWithConcurrency(parallelChecks, opts)
    // Some checks spawn global OS resources such as tmux sessions or local daemons.
    // Keep their isolation narrow instead of forcing the whole registry sequential.
    const exclusiveResults = await runChecksSerially(exclusiveChecks, opts)
    const isolatedResults = await runChecksSerially(isolated, opts)
    return restoreDiscoveryOrder(checks, [...parallelResults, ...exclusiveResults, ...isolatedResults])
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
    const checks = await loadChecks(opts)
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

    const scope = describeScope(opts)
    console.log(`\n  capture-ci-checks · ${checks.length} checks total${scope}\n`)
    if (opts.tierMax !== null && checks.length === 0) {
        console.log(`  no checks at tier <=${opts.tierMax}\n`)
    }

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
