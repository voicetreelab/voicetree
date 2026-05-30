#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {availableParallelism, tmpdir, totalmem} from 'node:os'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const MEASURES_DIR = resolve(SCRIPT_DIR, '..', '..')
const REPO_ROOT = resolve(MEASURES_DIR, '..', '..')
const TEST_ROOTS = ['src/health', 'src/checks', 'src/_subgraph_gate']

function relativePath(path: string): string {
    return path.split(sep).join('/')
}

function parseArgs(argv: string[]): {outputFile: string | null} {
    let outputFile: string | null = null
    for (const arg of argv) {
        if (arg.startsWith('--outputFile=')) outputFile = arg.slice('--outputFile='.length)
        else if (arg === '--outputFile') throw new Error('--outputFile requires --outputFile=<path>')
        else throw new Error(`unknown flag: ${arg}`)
    }
    return {outputFile}
}

async function discoverTestFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return discoverTestFiles(path)
        if (!entry.isFile() || !entry.name.endsWith('.test.ts')) return []
        return [path]
    }))
    return nested.flat()
}

async function readJson(path: string): Promise<any | null> {
    try {
        return JSON.parse(await readFile(path, 'utf8'))
    } catch {
        return null
    }
}

function runVitest(testFile: string, outputFile: string): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(
            'pnpm',
            // `default` reporter → inherited stdout so real assertion failures
            // and diffs surface even under parallel execution; `json` → file for
            // count merging (its stacks are masked as STACK_TRACE_ERROR, which is
            // why the human-readable reporter is also required).
            ['exec', 'vitest', 'run', testFile, '--reporter=default', '--reporter=json', `--outputFile.json=${outputFile}`],
            {
                cwd: MEASURES_DIR,
                env: process.env,
                stdio: ['ignore', 'inherit', 'inherit'],
            },
        )
        child.on('error', err => {
            console.error(err)
            resolve(1)
        })
        child.on('close', code => resolve(code ?? 1))
    })
}

function numberOrZero(value: unknown): number {
    return Number.isFinite(value) ? Number(value) : 0
}

// Each test file runs in its own isolated `vitest run` process (these health
// checks scan the whole repo and must not share module/global state). The files
// are mutually independent, so run them through a bounded worker pool instead of
// serially.
//
// These checks are memory-heavy: each process parses large swathes of the repo
// (call graph, complexity, duplication) and peaks around PER_PROCESS_GB. The
// concurrency ceiling is therefore the MIN of CPU and memory budgets, so the
// same code is safe on a 188 GB / 64-core devbox (→ MAX_CONCURRENCY), a 16 GB /
// 4-core GitHub runner (→ ~4), and a 7 GB runner (→ ~1, matching the old serial
// behaviour) without ever oversubscribing RAM. VT_HEALTH_CONCURRENCY overrides
// the computed value for manual tuning.
const PER_PROCESS_GB = 2
const MEMORY_UTILISATION = 0.75
const MAX_CONCURRENCY = 16

function resolveConcurrency(fileCount: number): number {
    const fromEnv = Number(process.env.VT_HEALTH_CONCURRENCY)
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
        return Math.max(1, Math.min(Math.floor(fromEnv), fileCount))
    }
    const totalGb = totalmem() / 1024 ** 3
    const memoryBudget = Math.floor((totalGb * MEMORY_UTILISATION) / PER_PROCESS_GB)
    const computed = Math.min(availableParallelism(), memoryBudget, MAX_CONCURRENCY)
    return Math.max(1, Math.min(computed, fileCount))
}

// Bounded-concurrency map: at most `concurrency` workers pull from a shared
// index, each awaiting `task(item, index)`. Results are returned in input order.
async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = Array<R>(items.length)
    let nextIndex = 0
    const workers = Array.from({length: Math.min(concurrency, items.length)}, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex
            nextIndex += 1
            results[index] = await task(items[index], index)
        }
    })
    await Promise.all(workers)
    return results
}

function mergeVitestJson(reports: any[]): any {
    const merged = {
        numTotalTestSuites: 0,
        numPassedTestSuites: 0,
        numFailedTestSuites: 0,
        numPendingTestSuites: 0,
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        startTime: Date.now(),
        success: true,
        testResults: [] as any[],
    }

    for (const report of reports) {
        merged.numTotalTestSuites += numberOrZero(report.numTotalTestSuites)
        merged.numPassedTestSuites += numberOrZero(report.numPassedTestSuites)
        merged.numFailedTestSuites += numberOrZero(report.numFailedTestSuites)
        merged.numPendingTestSuites += numberOrZero(report.numPendingTestSuites)
        merged.numTotalTests += numberOrZero(report.numTotalTests)
        merged.numPassedTests += numberOrZero(report.numPassedTests)
        merged.numFailedTests += numberOrZero(report.numFailedTests)
        merged.numPendingTests += numberOrZero(report.numPendingTests ?? report.numSkippedTests)
        merged.numTodoTests += numberOrZero(report.numTodoTests)
        merged.startTime = Math.min(merged.startTime, numberOrZero(report.startTime) || merged.startTime)
        merged.success = merged.success && report.success !== false
        if (Array.isArray(report.testResults)) merged.testResults.push(...report.testResults)
    }
    return merged
}

const {outputFile} = parseArgs(process.argv.slice(2))
const tmpDir = await mkdtemp(join(tmpdir(), 'systems-health-'))

try {
    const files = (await Promise.all(
        TEST_ROOTS.map(root => discoverTestFiles(join(MEASURES_DIR, root))),
    ))
        .flat()
        .map(path => relativePath(relative(MEASURES_DIR, path)))
        .sort()

    const concurrency = resolveConcurrency(files.length)
    console.log(`[systems-health] running ${files.length} test files, ${concurrency} at a time`)
    let completed = 0
    const outcomes = await mapWithConcurrency(files, concurrency, async (file, i) => {
        const shardOut = join(tmpDir, `${String(i).padStart(3, '0')}.json`)
        const startedAt = performance.now()
        const code = await runVitest(file, shardOut)
        const durationMs = Math.round(performance.now() - startedAt)
        const report = await readJson(shardOut)
        completed += 1
        const ok = code === 0 && report !== null
        console.log(`[systems-health ${completed}/${files.length}] ${ok ? '✓' : '✗'} ${(durationMs / 1000).toFixed(1)}s  ${file}`)
        return {file, durationMs, report, ok}
    })

    // Surface the long pole: per-file wall time observed under parallel load
    // (inflated by CPU contention, but it reveals which files gate completion).
    const slowest = [...outcomes].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10)
    console.log('\n[systems-health] slowest files (wall time under load):')
    for (const o of slowest) {
        console.log(`  ${(o.durationMs / 1000).toFixed(1)}s  ${o.ok ? '✓' : '✗'} ${o.file}`)
    }

    const reports = outcomes.map(o => o.report).filter(report => report !== null)
    const failed = outcomes.some(o => !o.ok)

    const merged = mergeVitestJson(reports)
    merged.success = merged.success && !failed
    if (outputFile) await writeFile(outputFile, `${JSON.stringify(merged)}\n`)
    process.exit(failed ? 1 : 0)
} finally {
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {})
}
