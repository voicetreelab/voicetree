import {execSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles, type SourceFileInfo} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

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

function isNotFoundError(error: unknown): boolean {
    return error instanceof Error
        && 'code' in error
        && (error as {readonly code?: string}).code === 'ENOENT'
}

function collectGitChurn(): ReadonlyMap<string, number> {
    const output = execSync(
        "git log --since='6 months ago' --format= --name-only",
        {cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024},
    )
    const churn = new Map<string, number>()

    for (const line of output.split('\n')) {
        const file = line.trim()
        if (!file) continue
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
    sf: SourceFileInfo,
    churnByFile: ReadonlyMap<string, number>,
): Promise<FileTurbulence | null> {
    let text: string
    try {
        text = await readFile(sf.absolutePath, 'utf8')
    } catch (error) {
        if (isNotFoundError(error)) return null
        throw error
    }

    const churn = churnByFile.get(sf.relativePath) ?? 0
    const complexity = countComplexity(sf.absolutePath, text)
    return {
        packageName: sf.packageName,
        file: sf.relativePath,
        churn,
        complexity,
        turbulence: churn * complexity,
    }
}

async function measureTurbulence(sourceFiles: readonly SourceFileInfo[]): Promise<FileTurbulence[]> {
    const churnByFile = collectGitChurn()
    const rows = await Promise.all(sourceFiles.map(sf => measureFile(sf, churnByFile)))
    return rows.filter((row): row is FileTurbulence => row !== null).sort((a, b) =>
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
        const sourceFiles = await discoverSourceFiles(packages, REPO_ROOT)
        const rows = await measureTurbulence(sourceFiles)
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
