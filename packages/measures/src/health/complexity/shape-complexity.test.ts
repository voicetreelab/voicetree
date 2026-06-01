import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {extractFunctions, type FnEntry} from '../../_shared/purity-analysis'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

// --- Per-file shape complexity ---
//
// "Deep & narrow" is the FP shape we favour: a single public function exposing a
// composition of small helpers. The shape axis catches files that drift toward
// "sprawling" — many long functions, many top-level exports.
//
// Per-file metrics:
//   median_function_loc — typical helper size
//   p75_function_loc    — body length of the larger functions
//   exports_per_file    — top-level export count (narrowness of public API)
//
// LOC helpers are duplicated from purity-ratio-ast.test.ts per project rules
// (functional, no shared mutable helpers; tests are black-box).

const REPO_ROOT: string = DEFAULT_REPO_ROOT


type FileShapeReport = {
    readonly file: string
    readonly packageName: string
    readonly functionCount: number
    readonly medianLoc: number
    readonly p75Loc: number
    readonly maxLoc: number
    readonly exports: number
    readonly score: number
}

// --- LOC helpers (duplicated from purity-ratio-ast.test.ts) ---

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

// --- Export counting ---

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return modifiers?.some(m => m.kind === kind) ?? false
}

function collectBindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text]
    const nested = name.elements.map(element => {
        if (ts.isOmittedExpression(element)) return []
        return collectBindingNames(element.name)
    })
    return nested.flat()
}

function exportedSymbolsInStatement(stmt: ts.Statement): string[] {
    if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) return []
    if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) return ['default']
    if (ts.isVariableStatement(stmt)) {
        return stmt.declarationList.declarations.flatMap(d => collectBindingNames(d.name))
    }
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)
        || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
        || ts.isEnumDeclaration(stmt)) && stmt.name) {
        return [stmt.name.text]
    }
    return []
}

function countExports(sf: ts.SourceFile): number {
    const names = new Set<string>()
    for (const stmt of sf.statements) {
        for (const n of exportedSymbolsInStatement(stmt)) names.add(n)
        if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) names.add('default')
        if (ts.isExportDeclaration(stmt)) {
            if (!stmt.exportClause) {
                const spec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
                    ? stmt.moduleSpecifier.text : 'local'
                names.add(`*:${spec}`)
            } else if (ts.isNamespaceExport(stmt.exportClause)) {
                names.add(stmt.exportClause.name.text)
            } else {
                for (const el of stmt.exportClause.elements) names.add(el.name.text)
            }
        }
    }
    return names.size
}

// --- Per-file scoring ---

function shapeScore(report: Omit<FileShapeReport, 'score'>): number {
    // Composite "sprawl" score: p75 function size + exports surface area.
    // Both axes punished linearly so a file that's deep-but-wide AND
    // a file that's narrow-but-long both stand out.
    return report.p75Loc + report.exports * 3
}

function buildFileShapeReport(
    file: string,
    packageName: string,
    fns: readonly FnEntry[],
    exports: number,
): FileShapeReport {
    const locs = fns.map(f => f.loc)
    const partial = {
        file,
        packageName,
        functionCount: fns.length,
        medianLoc: median(locs),
        p75Loc: percentile(locs, 75),
        maxLoc: locs.reduce((m, v) => Math.max(m, v), 0),
        exports,
    }
    return {...partial, score: shapeScore(partial)}
}

// --- Report formatting ---

function formatReport(reports: readonly FileShapeReport[]): string {
    const lines: string[] = ['']
    lines.push('='.repeat(80))
    lines.push('SHAPE COMPLEXITY — per-file function shape + export surface')
    lines.push('='.repeat(80))
    lines.push('  median/p75 LOC = body size of typical/larger fns in the file')
    lines.push('  exports        = top-level exported symbols')
    lines.push('  score          = p75 LOC + exports × 3  (sprawl indicator)\n')

    const total = reports.length
    const allMedian = reports.map(r => r.medianLoc)
    const allP75 = reports.map(r => r.p75Loc)
    const allExports = reports.map(r => r.exports)

    lines.push(`Files scanned: ${total}`)
    lines.push(`Median  of file medians: ${median(allMedian)}`)
    lines.push(`P75     of file medians: ${percentile(allMedian, 75)}`)
    lines.push(`Median  of file p75s:    ${median(allP75)}`)
    lines.push(`P75     of file p75s:    ${percentile(allP75, 75)}`)
    lines.push(`P90     of file p75s:    ${percentile(allP75, 90)}`)
    lines.push(`P75/P90 exports:         ${percentile(allExports, 75)} / ${percentile(allExports, 90)}`)
    lines.push('')

    const top = reports.slice().sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 20)
    lines.push('Top 20 files by sprawl score:')
    lines.push('  ' + [
        '#'.padStart(3),
        'File'.padEnd(64),
        'Fns'.padStart(4),
        'Med'.padStart(4),
        'P75'.padStart(4),
        'Max'.padStart(4),
        'Exp'.padStart(4),
        'Score'.padStart(5),
    ].join(' '))
    lines.push('  ' + '─'.repeat(96))
    for (const [i, r] of top.entries()) {
        lines.push('  ' + [
            String(i + 1).padStart(3),
            r.file.padEnd(64),
            String(r.functionCount).padStart(4),
            String(r.medianLoc).padStart(4),
            String(r.p75Loc).padStart(4),
            String(r.maxLoc).padStart(4),
            String(r.exports).padStart(4),
            String(r.score).padStart(5),
        ].join(' '))
    }
    return lines.join('\n')
}

// --- Test ---
//
// Budgets ratcheted from measured baseline. Lower as worst offenders are
// refactored toward deep-and-narrow.

const {
    orangeFileScoreBudget: ORANGE_FILE_SCORE_BUDGET,
    orangeP90FileP75Loc: ORANGE_P90_FILE_P75_LOC,
} = readBudgetSync<{orangeFileScoreBudget: number; orangeP90FileP75Loc: number}>('complexity/shape-complexity.json')

describe('shape complexity', () => {
    it('reports per-file function shape and export surface area', async () => {
        const packages = await discoverPackages()
        const sourceFiles = await discoverSourceFiles(packages, REPO_ROOT)

        const reports: FileShapeReport[] = await Promise.all(sourceFiles.map(async sourceFile => {
            const text = await readFile(sourceFile.absolutePath, 'utf8')
            const sf = ts.createSourceFile(sourceFile.absolutePath, text, ts.ScriptTarget.Latest, true)
            const fns = extractFunctions(sourceFile.absolutePath, sf)
            const exports = countExports(sf)
            return buildFileShapeReport(sourceFile.relativePath, sourceFile.packageName, fns, exports)
        }))

        // No-fn files (pure type/re-export modules) are not shape-meaningful; exclude.
        const meaningful = reports.filter(r => r.functionCount > 0 || r.exports > 0)
        console.info(formatReport(meaningful))

        const p75s = meaningful.map(r => r.p75Loc)
        const p90FileP75 = percentile(p75s, 90)
        const overScore = meaningful.filter(r => r.score > ORANGE_FILE_SCORE_BUDGET)
            .sort((a, b) => b.score - a.score)

        await recordHealthMetric({
            metricId: 'shape-complexity-file-score',
            metricName: 'Shape Complexity File Score (p90)',
            description: 'Sprawl score per file (p75 function LOC + exports × 3). Tail (p90) flags deep-and-narrow drift toward sprawling files.',
            category: 'Shape',
            current: percentile(meaningful.map(r => r.score), 90),
            budget: ORANGE_FILE_SCORE_BUDGET,
            comparison: 'lte',
            unit: 'score',
            details: {
                overBudget: overScore.slice(0, 20),
                topByScore: meaningful.slice().sort((a, b) => b.score - a.score).slice(0, 20),
                fileCount: meaningful.length,
            },
        })

        await recordHealthMetric({
            metricId: 'shape-complexity-p90-file-p75-loc',
            metricName: 'Shape P90 File P75 Function LOC',
            description: 'P90 of per-file p75 function body LOC — typical "larger function" size in the tail of files.',
            category: 'Shape',
            current: p90FileP75,
            budget: ORANGE_P90_FILE_P75_LOC,
            comparison: 'lte',
            unit: 'LOC',
            details: {fileCount: meaningful.length},
        })

        if (overScore.length > 0) {
            const lines: string[] = [
                '',
                `Orange shape gate: ${overScore.length} files exceed sprawl budget (score > ${ORANGE_FILE_SCORE_BUDGET}).`,
                'Highest sprawl (p75 function LOC + exports × 3):',
            ]
            for (const [i, r] of overScore.slice(0, 5).entries()) {
                lines.push(`  ${i + 1}. ${r.file}  score=${r.score}  fns=${r.functionCount} (med=${r.medianLoc} p75=${r.p75Loc} max=${r.maxLoc})  exports=${r.exports}`)
            }
            lines.push('')
            lines.push('Refactor toward deep-and-narrow: split files, extract helpers, narrow public API.')
            throw new Error(lines.join('\n'))
        }

        expect(p90FileP75, `p90 file-p75 LOC ${p90FileP75} > ${ORANGE_P90_FILE_P75_LOC}`)
            .toBeLessThanOrEqual(ORANGE_P90_FILE_P75_LOC)
    }, 60000)
})
