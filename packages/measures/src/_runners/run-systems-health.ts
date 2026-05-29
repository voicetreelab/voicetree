#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
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
            ['exec', 'vitest', 'run', testFile, '--reporter=json', `--outputFile=${outputFile}`],
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

    const reports: any[] = []
    let failed = false
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        const shardOut = join(tmpDir, `${String(i).padStart(3, '0')}.json`)
        console.log(`\n[systems-health ${i + 1}/${files.length}] ${file}`)
        const code = await runVitest(file, shardOut)
        const report = await readJson(shardOut)
        if (report) reports.push(report)
        if (code !== 0 || !report) failed = true
    }

    const merged = mergeVitestJson(reports)
    merged.success = merged.success && !failed
    if (outputFile) await writeFile(outputFile, `${JSON.stringify(merged)}\n`)
    process.exit(failed ? 1 : 0)
} finally {
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {})
}
