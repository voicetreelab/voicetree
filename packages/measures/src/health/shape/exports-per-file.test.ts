import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles, type SourceFileInfo} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
const {p90Budget: P90_BUDGET, maxBudget: MAX_BUDGET} = readBudgetSync<{p90Budget: number; maxBudget: number}>('shape/exports-per-file.json')


type FileExportCount = {
    readonly packageName: string
    readonly file: string
    readonly exportedSymbols: readonly string[]
    readonly exportCount: number
}

type ExportDistribution = {
    readonly p50: number
    readonly p75: number
    readonly p90: number
    readonly max: number
}

type PackageMean = {
    readonly packageName: string
    readonly fileCount: number
    readonly exportCount: number
    readonly mean: number
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return modifiers?.some(modifier => modifier.kind === kind) ?? false
}

function collectBindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text]
    const nested = name.elements.map(element => {
        if (ts.isOmittedExpression(element)) return []
        return collectBindingNames(element.name)
    })
    return nested.flat()
}

function collectExportedDeclarationSymbols(statement: ts.Statement): string[] {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return []
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ['default']

    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap(declaration => collectBindingNames(declaration.name))
    }

    if (
        (ts.isFunctionDeclaration(statement)
            || ts.isTypeAliasDeclaration(statement)
            || ts.isInterfaceDeclaration(statement)
            || ts.isClassDeclaration(statement)
            || ts.isEnumDeclaration(statement))
        && statement.name
    ) {
        return [statement.name.text]
    }

    return []
}

function collectExportDeclarationSymbols(statement: ts.ExportDeclaration): string[] {
    if (!statement.exportClause) {
        const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : 'local'
        return [`*:${specifier}`]
    }

    if (ts.isNamespaceExport(statement.exportClause)) return [statement.exportClause.name.text]
    return statement.exportClause.elements.map(element => element.name.text)
}

function collectTopLevelExportSymbols(sourceFile: ts.SourceFile): string[] {
    const symbols: Set<string> = new Set()

    for (const statement of sourceFile.statements) {
        for (const symbol of collectExportedDeclarationSymbols(statement)) symbols.add(symbol)

        if (ts.isExportAssignment(statement) && !statement.isExportEquals) symbols.add('default')
        if (ts.isExportDeclaration(statement)) {
            for (const symbol of collectExportDeclarationSymbols(statement)) symbols.add(symbol)
        }
    }

    return [...symbols].sort()
}

async function scanFileExports(sf: SourceFileInfo): Promise<FileExportCount> {
    const text = await readFile(sf.absolutePath, 'utf8')
    const sourceFile = ts.createSourceFile(sf.absolutePath, text, ts.ScriptTarget.Latest, true)
    const exportedSymbols = collectTopLevelExportSymbols(sourceFile)
    return {
        packageName: sf.packageName,
        file: sf.relativePath,
        exportedSymbols,
        exportCount: exportedSymbols.length,
    }
}

function median(values: readonly number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function percentile(values: readonly number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const bounded = Math.max(0, Math.min(100, p))
    const index = Math.ceil((bounded / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
}

function distribution(counts: readonly FileExportCount[]): ExportDistribution {
    const values = counts.map(count => count.exportCount)
    return {
        p50: median(values),
        p75: percentile(values, 75),
        p90: percentile(values, 90),
        max: values.reduce((max, value) => Math.max(max, value), 0),
    }
}

function topFiles(counts: readonly FileExportCount[], limit: number): FileExportCount[] {
    return counts
        .slice()
        .sort((a, b) => b.exportCount - a.exportCount || a.file.localeCompare(b.file))
        .slice(0, limit)
}

function packageMeans(counts: readonly FileExportCount[]): PackageMean[] {
    const byPackage = new Map<string, FileExportCount[]>()
    for (const count of counts) {
        const existing = byPackage.get(count.packageName)
        if (existing) existing.push(count)
        else byPackage.set(count.packageName, [count])
    }

    return [...byPackage]
        .map(([packageName, packageCounts]) => {
            const exportCount = packageCounts.reduce((sum, count) => sum + count.exportCount, 0)
            return {
                packageName,
                fileCount: packageCounts.length,
                exportCount,
                mean: packageCounts.length === 0 ? 0 : exportCount / packageCounts.length,
            }
        })
        .sort((a, b) => b.mean - a.mean || a.packageName.localeCompare(b.packageName))
}

function formatReport(
    totalFiles: number,
    totalExportedSymbols: number,
    dist: ExportDistribution,
    top: readonly FileExportCount[],
    means: readonly PackageMean[],
): string {
    const lines: string[] = [
        '',
        `Total files: ${totalFiles}`,
        `Total exported symbols: ${totalExportedSymbols}`,
        `Distribution: p50=${dist.p50}, p75=${dist.p75}, p90=${dist.p90}, max=${dist.max}`,
        '',
        'Top 10 files by exported symbols:',
    ]

    for (const file of top) {
        lines.push(`  ${String(file.exportCount).padStart(3)}  ${file.file}`)
    }

    lines.push('')
    lines.push('Per-package mean exports per file:')
    for (const mean of means) {
        lines.push(`  ${mean.packageName.padEnd(18)} ${mean.mean.toFixed(2)} (${mean.exportCount} exports / ${mean.fileCount} files)`)
    }

    return lines.join('\n')
}

describe('systems exports per file', () => {
    it('keeps top-level exported symbol counts narrow per source file', async () => {
        const packages = await discoverPackages()
        const sourceFiles = await discoverSourceFiles(packages, REPO_ROOT)
        const counts = (await Promise.all(sourceFiles.map(scanFileExports)))
            .sort((a, b) => a.file.localeCompare(b.file))
        const dist = distribution(counts)
        const totalExportedSymbols = counts.reduce((sum, count) => sum + count.exportCount, 0)
        const top = topFiles(counts, 10)
        const means = packageMeans(counts)

        console.info(formatReport(counts.length, totalExportedSymbols, dist, top, means))

        await recordHealthMetric({
            metricId: 'exports-per-file-p90',
            metricName: 'Exports Per File P90',
            description: 'P90 top-level exported symbol count per systems source file.',
            category: 'Shape',
            current: dist.p90,
            budget: P90_BUDGET,
            comparison: 'lte',
            unit: 'exports',
            details: {
                totalFiles: counts.length,
                totalExportedSymbols,
                distribution: dist,
                topFiles: top,
                perPackageMean: means,
            },
        })

        await recordHealthMetric({
            metricId: 'exports-per-file-max',
            metricName: 'Exports Per File Max',
            description: 'Largest top-level exported symbol count in a systems source file.',
            category: 'Shape',
            current: dist.max,
            budget: MAX_BUDGET,
            comparison: 'lte',
            unit: 'exports',
            details: {
                totalFiles: counts.length,
                totalExportedSymbols,
                distribution: dist,
                topFiles: top,
                perPackageMean: means,
            },
        })

        expect(dist.p90).toBeLessThanOrEqual(P90_BUDGET)
        expect(dist.max).toBeLessThanOrEqual(MAX_BUDGET)
    })
})
