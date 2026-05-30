#!/usr/bin/env node
// Run every locally-runnable CI/CD check, capture pass/fail + counts + duration,
// and write a CheckReport per check via recordCheckReport(). Pure orchestration —
// it never patches existing scripts; everything is invoked through spawn().
//
// Measure inventory is auto-detected from the tiered `checks/` tree.

import {appendFile, mkdir, readdir} from 'node:fs/promises'
import {availableParallelism, totalmem} from 'node:os'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {pathToFileURL, fileURLToPath} from 'node:url'

import {recordCheckReport} from '../_shared/writers/check-report-writer.ts'
import {spawnCheck} from './capture-check-runner.ts'
import {errorSummaryForFailedOutcome, formatFailureBody} from './failure-summary.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')
const MEASURES_DIR = join(REPO_ROOT, 'packages', 'measures', 'src')
const CHECKS_DIR = join(MEASURES_DIR, 'checks')
// MAX_TIER is duplicated in health/meta/ci-coverage.test.ts. If you bump
// this, bump that too — the test will fail loudly otherwise (it rejects
// any `--tier<=N` workflow invocation with N > its own MAX_TIER).
const MAX_TIER = 4

const DEFAULT_PARALLELISM = Math.max(1, availableParallelism())

// Memory-aware concurrency for the Integration phase. Mirrors the systems-health
// runner: the ceiling is the MIN of CPU and a RAM budget, so the SAME code is
// fast on the 64c/188GB devbox and safe (≈serial) on a 4c/16GB CI runner without
// oversubscribing RAM. `perProcessGb` encodes how heavy one check is. Overridable
// via env for manual tuning.
const MEMORY_UTILISATION = 0.75

function resolveMemoryAwareConcurrency({count, envVar, perProcessGb, maxConcurrency}) {
    if (count <= 1) return Math.max(1, count)
    const fromEnv = Number(process.env[envVar])
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
        return Math.max(1, Math.min(Math.floor(fromEnv), count))
    }
    const totalGb = totalmem() / 1024 ** 3
    const memoryBudget = Math.floor((totalGb * MEMORY_UTILISATION) / perProcessGb)
    const computed = Math.min(DEFAULT_PARALLELISM, memoryBudget, maxConcurrency)
    return Math.max(1, Math.min(computed, count))
}

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

// A tier may be authored as bare `tier_N/` (legacy / no-suffix tiers) or as
// `tier_N_pre_commit/` (explicit invocation context). Both are scheduled
// measures; `tier_N_post_edit/` (and other non-scheduled siblings) live
// outside this discovery pass — they are invoked by agent hooks, not
// capture-ci.
const SCHEDULED_TIER_SUFFIXES = ['', '_pre_commit']

async function discoverScheduledMeasureFiles(tierMax) {
    const tierDirs = Array.from({length: tierMax + 1}, (_, tier) => tier)
        .flatMap(tier => SCHEDULED_TIER_SUFFIXES.map(suffix => join(CHECKS_DIR, `tier_${tier}${suffix}`)))
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
    const opts = {failFast: false, sequential: false, only: null, tierMax: null, help: false, listJson: false}
    for (const arg of argv) {
        if (arg === '--fail-fast') opts.failFast = true
        else if (arg === '--sequential') opts.sequential = true
        else if (arg === '-h' || arg === '--help') opts.help = true
        else if (arg === '--list-json') opts.listJson = true
        else if (arg.startsWith('--only=')) opts.only = new Set(arg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean))
        else if (arg.startsWith('--tier<=')) opts.tierMax = parseTierMax(arg.slice('--tier<='.length), '--tier<=')
        else if (arg.startsWith('--tier-max=')) opts.tierMax = parseTierMax(arg.slice('--tier-max='.length), '--tier-max')
        else if (arg.startsWith('--max-tier=')) opts.tierMax = parseTierMax(arg.slice('--max-tier='.length), '--max-tier')
        else throw new Error(`unknown flag: ${arg}`)
    }
    return opts
}

const CHECK_PATH = /\/checks\/tier_(\d+)(?:_pre_commit)?\/([^/]+)\//

function tierFromMeasurePath(measurePath) {
    const match = CHECK_PATH.exec(measurePath)
    return match ? Number(match[1]) : null
}

function concernFromMeasurePath(measurePath) {
    const match = CHECK_PATH.exec(measurePath)
    return match ? match[2] : null
}

function checkManifestEntry(check) {
    return {
        id: check.id,
        name: check.name,
        category: check.category,
        display: check.display,
        measurePath: check.measurePath,
        tier: tierFromMeasurePath(check.measurePath),
        concern: concernFromMeasurePath(check.measurePath),
    }
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
        '  --tier<=N         run checks under checks/tier_0_pre_commit through checks/tier_N',
        '                    (and any legacy bare `tier_K/` folders without a suffix).',
        '  --tier-max=N      shell-safe alias for --tier<=N.',
        '  --max-tier=N      shell-safe alias for --tier<=N.',
        '  --sequential      run checks sequentially; continue through failures.',
        '  --fail-fast       run sequentially; stop scheduling after the first fail.',
        '  --list-json       print JSON manifest of every check (no execution).',
        '',
        'Eligible checks run in a bounded parallel pool unless --sequential or --fail-fast is set.',
        '',
        'Check ids:',
        ...checks.map(c => `  ${c.id.padEnd(32)} ${c.category.padEnd(11)} ${c.measurePath}`),
    ]
    console.log(lines.join('\n'))
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
        ? errorSummaryForFailedOutcome(outcome)
        : undefined
    /** @type {Record<string, unknown>} */
    const details = {exitCode: outcome.exitCode, measurePath: check.measurePath, measureFolder: check.measureFolder}
    if (outcome.timedOut) details.timedOut = true
    if (outcome.signal) details.signal = outcome.signal
    if (outcome.spawnError) details.spawnError = outcome.spawnError
    Object.assign(details, outcome.failureDetails ?? {})
    await recordCheckReport({
        checkId: check.id,
        checkName: check.name,
        category: check.category,
        command: check.display,
        status: outcome.status,
        durationMs: outcome.durationMs,
        startedAt: outcome.startedAt,
        endedAt: outcome.endedAt,
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

function failedSpawnOutcome(err, startedAt, endedAt) {
    return {
        status: 'fail',
        durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
        startedAt,
        endedAt,
        exitCode: -1,
        signal: null,
        timedOut: false,
        spawnError: String(err?.message ?? err),
        stdoutTail: undefined,
        stderrTail: undefined,
    }
}

async function runCheck(check) {
    const startedAt = new Date().toISOString()
    try {
        return await spawnCheck(check, process.env, REPO_ROOT)
    } catch (err) {
        return failedSpawnOutcome(err, startedAt, new Date().toISOString())
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

// `exclusive: true` checks (e.g. the tmux-backed fake-agent/daemon webapp suite)
// explicitly need a clean machine — they run strictly serially and on their own.
function isExclusiveCheck(check) {
    return check.exclusive === true
}

// Integration checks each spawn an in-process daemon on an ephemeral port (or a
// CLI subprocess) inside a private `mkdtemp` dir — mutually independent, so they
// run through a bounded memory-aware pool rather than serially. `exclusive` wins
// if both are set.
function isIntegrationPoolCheck(check) {
    return check.category === 'Integration' && !isExclusiveCheck(check)
}

function isMainPoolCheck(check) {
    return !isIntegrationPoolCheck(check) && !isExclusiveCheck(check)
}

async function runCheckWithSkip(check, opts) {
    if (shouldSkipCheck(check, opts)) return {check, outcome: skippedOutcome()}
    const outcome = await runCheck(check)
    try {
        await recordOutcome(check, outcome)
    } catch (err) {
        console.error(`failed to write report for ${check.id}: ${err?.message ?? err}`)
    }
    return {check, outcome}
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

function logPhase(label, checks, concurrency) {
    if (checks.length === 0) return
    console.log(`  ${label} phase · ${checks.length} checks, ${concurrency} at a time`)
}

async function runChecksInParallel(checks, opts) {
    const {parallel, isolated} = partitionChecksByPhase(checks)
    const mainPoolChecks = parallel.filter(isMainPoolCheck)
    const integrationChecks = parallel.filter(isIntegrationPoolCheck)
    const exclusiveChecks = parallel.filter(isExclusiveCheck)

    // The main pool (lightweight Static/Lint/Unit/TypeCheck checks) runs the
    // widest — one worker per core.
    const mainResults = await runChecksWithConcurrency(mainPoolChecks, opts)

    // Integration checks were previously serialized purely out of CPU-contention
    // conservatism. They are resource-isolated (ephemeral ports + temp dirs), so
    // a bounded memory-aware pool reclaims the idle cores.
    const integrationConcurrency = resolveMemoryAwareConcurrency({
        count: integrationChecks.length, envVar: 'VT_CI_INTEGRATION_CONCURRENCY', perProcessGb: 2, maxConcurrency: 12,
    })
    logPhase('integration', integrationChecks, integrationConcurrency)
    const integrationResults = await runChecksWithConcurrency(integrationChecks, opts, integrationConcurrency)

    // tmux/daemon-heavy checks run strictly serially, alone, after the pools drain.
    const exclusiveResults = await runChecksSerially(exclusiveChecks, opts)

    // Isolated phase: real-browser / Electron e2e. Kept serial deliberately — the
    // browser suites each spin a vite dev server on a fixed `PLAYWRIGHT_PORT`
    // (3000/3100, `--strictPort`), so overlapping them would make correctness
    // depend on that env var staying unset, and the phase is gated anyway by the
    // single ~3min Electron suite that no cross-check pool can shrink.
    const isolatedResults = await runChecksSerially(isolated, opts)

    return restoreDiscoveryOrder(checks, [...mainResults, ...integrationResults, ...exclusiveResults, ...isolatedResults])
}

async function runChecksSequentially(checks, opts) {
    const results = []
    let stopScheduling = false
    for (const check of checks) {
        if (shouldSkipCheck(check, opts, stopScheduling)) {
            results.push({check, outcome: skippedOutcome()})
            continue
        }
        const outcome = await runCheck(check)
        try {
            await recordOutcome(check, outcome)
        } catch (err) {
            console.error(`failed to write report for ${check.id}: ${err?.message ?? err}`)
        }
        results.push({check, outcome})
        if (opts.failFast && outcome.status === 'fail') stopScheduling = true
    }
    return results
}

async function printJsonManifest() {
    const allChecks = await loadChecks({tierMax: MAX_TIER})
    process.stdout.write(JSON.stringify(allChecks.map(checkManifestEntry)))
}

function validateOnly(opts, checks) {
    if (!opts.only) return null
    const ids = new Set(checks.map(c => c.id))
    const unknown = [...opts.only].find(id => !ids.has(id))
    if (unknown === undefined) return null
    console.error(`unknown --only id: ${unknown}`)
    return 2
}

function formatRunHeader(opts, checks) {
    const scope = describeScope(opts)
    const head = `\n  capture-ci-checks · ${checks.length} checks total${scope}\n`
    const empty = (opts.tierMax !== null && checks.length === 0) ? `\n  no checks at tier <=${opts.tierMax}\n` : ''
    return `${head}${empty}`
}

async function runAllChecks(checks, opts) {
    if (opts.failFast || opts.sequential) return runChecksSequentially(checks, opts)
    return runChecksInParallel(checks, opts)
}

function formatFailuresSection(failures) {
    if (failures.length === 0) return ''
    const blocks = failures.map(({check, outcome}) => {
        const body = formatFailureBody(outcome)
        const bodyLine = body ? `${body}\n` : ''
        return `  ✗ ${check.id}\n${bodyLine}      report: health-dashboard/reports/checks/${check.id}.json\n`
    })
    return `\n  failures:\n\n${blocks.join('\n')}`
}

function formatGithubFailureSummary(failures) {
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

async function appendGithubFailureSummary(failures) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (!summaryPath || failures.length === 0) return
    await appendFile(summaryPath, formatGithubFailureSummary(failures), 'utf8')
}

// Reports are persisted eagerly per-check by runCheckWithSkip / runChecksSequentially
// (required so isolated-phase checks can read sibling reports during their own
// invocation). This pass only renders the result table and counts failures.
function reportResults(results) {
    const failures = []
    for (const {check, outcome} of results) {
        printRow(check, outcome)
        if (outcome.status === 'fail') failures.push({check, outcome})
    }
    console.log(`${formatFailuresSection(failures)}\n  done · ${failures.length} failing\n`)
    return failures
}

async function main() {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.listJson) { await printJsonManifest(); return 0 }
    const checks = await loadChecks(opts)
    if (opts.help) { printHelp(checks); return 0 }
    const validationError = validateOnly(opts, checks)
    if (validationError !== null) return validationError
    await mkdir(join(REPO_ROOT, 'health-dashboard', 'reports', 'checks'), {recursive: true})
    console.log(formatRunHeader(opts, checks))
    const results = await runAllChecks(checks, opts)
    const failures = reportResults(results)
    await appendGithubFailureSummary(failures)
    return failures.length === 0 ? 0 : 1
}

main().then(code => process.exit(code)).catch(err => {
    console.error(err)
    process.exit(2)
})
