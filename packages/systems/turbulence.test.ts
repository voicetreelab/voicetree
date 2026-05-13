import {execSync} from 'node:child_process'
import {readdir, readFile, stat} from 'node:fs/promises'
import {join, relative} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from './discover-packages'
import {recordHealthMetric} from './_health-report-test-helpers'

const REPO_ROOT: string = DEFAULT_REPO_ROOT


type FileTurbulence = {
    readonly packageName: string
    readonly file: string
    readonly churn: number
    readonly complexity: number
    readonly turbulence: number
}

type PackageAggregate = {
    readonly packageName: string
    readonly fileCount: number
    readonly totalTurbulence: number
    readonly averageTurbulence: number
    readonly maxFile: FileTurbulence | null
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await stat(p)
        return true
    } catch {
        return false
    }
}

function isProductionSource(path: string): boolean {
    return path.endsWith('.ts')
        && !path.endsWith('.test.ts')
        && !path.endsWith('.spec.ts')
        && !path.endsWith('.d.ts')
        && !path.includes('/__tests__/')
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (entry.isFile() && isProductionSource(path)) return [path]
        return []
    }))
    return nested.flat().sort()
}

function collectGitChurn(): ReadonlyMap<string, number> {
    const output = execSync(
        "git log --since='6 months ago' --format=%H --name-only -- packages/systems",
        {cwd: REPO_ROOT, encoding: 'utf8'},
    )
    const churn = new Map<string, number>()

    for (const line of output.split('\n')) {
        const file = line.trim()
        if (!file || !file.startsWith('packages/systems/')) continue
        churn.set(file, (churn.get(file) ?? 0) + 1)
    }

    return churn
}

function countComplexity(filePath: string, text: string): number {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    let complexity = 0

    function visit(node: ts.Node): void {
        if (ts.isIfStatement(node)
            || ts.isForStatement(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isWhileStatement(node)
            || ts.isDoStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isCatchClause(node)
            || ts.isConditionalExpression(node)) {
            complexity += 1
        }
        ts.forEachChild(node, visit)
    }

    ts.forEachChild(sourceFile, visit)
    return complexity
}

async function measureFile(
    pkg: PackageInfo,
    filePath: string,
    churnByFile: ReadonlyMap<string, number>,
): Promise<FileTurbulence> {
    const text = await readFile(filePath, 'utf8')
    const file = relative(REPO_ROOT, filePath)
    const churn = churnByFile.get(file) ?? 0
    const complexity = countComplexity(filePath, text)
    return {
        packageName: pkg.dirName,
        file,
        churn,
        complexity,
        turbulence: churn * complexity,
    }
}

async function measureTurbulence(packages: readonly PackageInfo[]): Promise<FileTurbulence[]> {
    const churnByFile = collectGitChurn()
    const nested = await Promise.all(packages.map(async pkg => {
        const files = await listProductionSources(pkg.srcRoot)
        return Promise.all(files.map(file => measureFile(pkg, file, churnByFile)))
    }))
    return nested.flat().sort((a, b) =>
        b.turbulence - a.turbulence
        || b.churn - a.churn
        || b.complexity - a.complexity
        || a.file.localeCompare(b.file))
}

function aggregateByPackage(rows: readonly FileTurbulence[]): PackageAggregate[] {
    const grouped = new Map<string, FileTurbulence[]>()
    for (const row of rows) {
        const existing = grouped.get(row.packageName)
        if (existing) existing.push(row)
        else grouped.set(row.packageName, [row])
    }

    return [...grouped.entries()].map(([packageName, files]) => {
        const totalTurbulence = files.reduce((sum, file) => sum + file.turbulence, 0)
        const maxFile = [...files].sort((a, b) =>
            b.turbulence - a.turbulence
            || b.churn - a.churn
            || b.complexity - a.complexity
            || a.file.localeCompare(b.file))[0] ?? null

        return {
            packageName,
            fileCount: files.length,
            totalTurbulence,
            averageTurbulence: files.length === 0 ? 0 : totalTurbulence / files.length,
            maxFile,
        }
    }).sort((a, b) =>
        b.totalTurbulence - a.totalTurbulence
        || a.packageName.localeCompare(b.packageName))
}

function formatTopFiles(rows: readonly FileTurbulence[]): string {
    const lines = [
        '',
        'Top turbulence files (churn x complexity):',
        'Package         | File                                                              | Churn | Complexity | Turbulence',
        '----------------|-------------------------------------------------------------------|-------|------------|-----------',
    ]

    for (const row of rows.slice(0, 20)) {
        lines.push([
            row.packageName.padEnd(15),
            row.file.padEnd(65),
            String(row.churn).padStart(5),
            String(row.complexity).padStart(10),
            String(row.turbulence).padStart(10),
        ].join(' | '))
    }

    return lines.join('\n')
}

function formatPackageAggregates(aggregates: readonly PackageAggregate[]): string {
    const lines = [
        '',
        'Per-package turbulence:',
        'Package         | Files | Total | Average | Max turbulence file',
        '----------------|-------|-------|---------|--------------------',
    ]

    for (const aggregate of aggregates) {
        const maxFile = aggregate.maxFile
            ? `${aggregate.maxFile.file} (${aggregate.maxFile.turbulence})`
            : 'n/a'
        lines.push([
            aggregate.packageName.padEnd(15),
            String(aggregate.fileCount).padStart(5),
            String(aggregate.totalTurbulence).padStart(5),
            aggregate.averageTurbulence.toFixed(2).padStart(7),
            maxFile,
        ].join(' | '))
    }

    return lines.join('\n')
}

describe('systems turbulence diagnostics', () => {
    it('reports churn multiplied by complexity for production source files', async () => {
        const packages = await discoverPackages()
        const rows = await measureTurbulence(packages)
        const aggregates = aggregateByPackage(rows)

        console.info([
            formatTopFiles(rows),
            formatPackageAggregates(aggregates),
        ].join('\n'))

        await recordHealthMetric({
            metricId: 'turbulence',
            metricName: 'Turbulence Coverage',
            description: 'Number of production source files scored by churn multiplied by complexity.',
            category: 'Churn',
            current: rows.length,
            budget: 1,
            comparison: 'gte',
            unit: 'files',
            details: {
                topFiles: rows.slice(0, 20),
                aggregates,
            },
        })

        expect(rows.length).toBeGreaterThan(0)
    })
})
