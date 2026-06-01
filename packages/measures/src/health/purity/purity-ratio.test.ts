import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import { discoverPackages, DEFAULT_REPO_ROOT } from '../../_shared/discovery/discover-packages'
import { listSourceFiles } from '../../_shared/purity-analysis'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const REPO_ROOT: string = resolve(DEFAULT_REPO_ROOT)

type MutableFunctionInfo = {
    readonly name: string
    readonly file: string
    readonly line: number
    readonly loc: number
    readonly bodyText: string
    readonly isExported: boolean
    readonly isAsync: boolean
    sideEffects: string[]
}

type FunctionInfo = Omit<MutableFunctionInfo, 'bodyText' | 'sideEffects'> & {
    readonly sideEffects: readonly string[]
}

function countLoc(bodyText: string): number {
    return bodyText.split('\n').filter(line => line.trim().length > 0).length
}

const SIDE_EFFECT_PATTERNS: ReadonlyArray<{
    readonly category: string
    readonly pattern: RegExp
}> = [
    { category: 'fs-io', pattern: /\bfs\.\w+\s*\(/ },
    { category: 'fs-io', pattern: /\breadFileSync\b/ },
    { category: 'fs-io', pattern: /\bwriteFileSync\b/ },
    { category: 'fs-io', pattern: /\breadFile\s*\(/ },
    { category: 'fs-io', pattern: /\bwriteFile\s*\(/ },
    { category: 'fs-io', pattern: /\bmkdir\s*\(/ },
    { category: 'fs-io', pattern: /\bunlink\s*\(/ },
    { category: 'fs-io', pattern: /\brmdir\s*\(/ },
    { category: 'fs-io', pattern: /\bcopyFile\s*\(/ },
    { category: 'fs-io', pattern: /\bchmod\s*\(/ },

    { category: 'console', pattern: /\bconsole\.(log|warn|error|info|debug)\s*\(/ },

    { category: 'process-io', pattern: /\bprocess\.exit\s*\(/ },
    { category: 'process-io', pattern: /\bprocess\.stdout\.write\s*\(/ },
    { category: 'process-io', pattern: /\bprocess\.stderr\.write\s*\(/ },

    { category: 'network', pattern: /\bfetch\s*\(/ },
    { category: 'network', pattern: /\bhttp\.request\s*\(/ },
    { category: 'network', pattern: /\bhttps\.request\s*\(/ },

    { category: 'subprocess', pattern: /\bspawn\s*\(/ },
    { category: 'subprocess', pattern: /\bexecFileSync\s*\(/ },
    { category: 'subprocess', pattern: /\bexecSync\s*\(/ },
    { category: 'subprocess', pattern: /\bexecFile\s*\(/ },
    { category: 'subprocess', pattern: /\bfork\s*\(/ },

    { category: 'timer', pattern: /\bsetTimeout\s*\(/ },
    { category: 'timer', pattern: /\bsetInterval\s*\(/ },

    { category: 'event-emit', pattern: /\.emit\s*\(/ },

    { category: 'nondeterministic', pattern: /\bMath\.random\s*\(/ },
    { category: 'nondeterministic', pattern: /\bDate\.now\s*\(/ },
    { category: 'nondeterministic', pattern: /\bnew Date\s*\(\s*\)/ },

    { category: 'react-hook', pattern: /\buseState\s*[<(]/ },
    { category: 'react-hook', pattern: /\buseEffect\s*\(/ },
    { category: 'react-hook', pattern: /\buseRef\s*[<(]/ },
    { category: 'react-hook', pattern: /\buseLayoutEffect\s*\(/ },
    { category: 'react-hook', pattern: /\buseMemo\s*\(/ },
    { category: 'react-hook', pattern: /\buseCallback\s*\(/ },
]

function detectDirectSideEffects(bodyText: string): string[] {
    const effects: Set<string> = new Set()
    for (const { category, pattern } of SIDE_EFFECT_PATTERNS) {
        if (pattern.test(bodyText)) {
            effects.add(category)
        }
    }
    return [...effects].sort()
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers: readonly ts.Modifier[] | undefined =
        ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return modifiers?.some(m => m.kind === kind) ?? false
}

function extractFunctions(filePath: string, sourceFile: ts.SourceFile): MutableFunctionInfo[] {
    const functions: MutableFunctionInfo[] = []
    const relPath: string = relative(REPO_ROOT, filePath)

    function isExported(node: ts.Node): boolean {
        if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) return true
        if (node.parent && ts.isVariableDeclarationList(node.parent)
            && node.parent.parent && ts.isVariableStatement(node.parent.parent)) {
            return hasModifier(node.parent.parent, ts.SyntaxKind.ExportKeyword)
        }
        return false
    }

    function getBodyText(
        node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration,
    ): string {
        if (!node.body) return ''
        return node.body.getText(sourceFile)
    }

    function pushIfNonEmpty(name: string, bodyText: string, node: ts.Node, exported: boolean, async: boolean): void {
        if (!bodyText) return
        const loc: number = countLoc(bodyText)
        if (loc === 0) return
        functions.push({
            name,
            file: relPath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            loc,
            bodyText,
            isExported: exported,
            isAsync: async,
            sideEffects: detectDirectSideEffects(bodyText),
        })
    }

    function visit(node: ts.Node): void {
        if (ts.isFunctionDeclaration(node) && node.name) {
            pushIfNonEmpty(node.name.text, getBodyText(node), node, isExported(node), hasModifier(node, ts.SyntaxKind.AsyncKeyword))
        }

        if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
            const init: ts.Expression = node.initializer
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
                pushIfNonEmpty(node.name.text, getBodyText(init), node, isExported(node), hasModifier(init, ts.SyntaxKind.AsyncKeyword))
            }
        }

        if (ts.isMethodDeclaration(node) && node.name) {
            pushIfNonEmpty(node.name.getText(sourceFile), getBodyText(node), node, false, hasModifier(node, ts.SyntaxKind.AsyncKeyword))
        }

        ts.forEachChild(node, visit)
    }

    ts.forEachChild(sourceFile, child => visit(child))
    return functions
}

function extractImportedImpureNames(
    sourceFile: ts.SourceFile,
    impureExportsByFile: ReadonlyMap<string, ReadonlySet<string>>,
    filePath: string,
): Set<string> {
    const tainted: Set<string> = new Set()
    const fileDir: string = dirname(filePath)

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const specifier: string = (statement.moduleSpecifier as ts.StringLiteral).text
        if (!specifier.startsWith('.')) continue

        let resolvedPath: string = resolve(fileDir, specifier)
        if (!resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.tsx')) {
            if (impureExportsByFile.has(resolvedPath + '.ts')) {
                resolvedPath = resolvedPath + '.ts'
            } else if (impureExportsByFile.has(resolvedPath + '.tsx')) {
                resolvedPath = resolvedPath + '.tsx'
            } else {
                resolvedPath = join(resolvedPath, 'index.ts')
            }
        }

        const impureNames: ReadonlySet<string> | undefined = impureExportsByFile.get(resolvedPath)
        if (!impureNames || impureNames.size === 0) continue

        const namedBindings = statement.importClause?.namedBindings
        if (namedBindings && ts.isNamedImports(namedBindings)) {
            for (const element of namedBindings.elements) {
                const originalName: string = (element.propertyName ?? element.name).text
                if (impureNames.has(originalName)) {
                    tainted.add(element.name.text)
                }
            }
        }
    }

    return tainted
}

function propagateImpurity(allFunctions: MutableFunctionInfo[]): void {
    const byFile: Map<string, MutableFunctionInfo[]> = new Map()
    for (const fn of allFunctions) {
        const existing: MutableFunctionInfo[] | undefined = byFile.get(fn.file)
        if (existing) {
            existing.push(fn)
        } else {
            byFile.set(fn.file, [fn])
        }
    }

    // Pass 1: intra-file propagation (fixpoint)
    for (const fileFunctions of byFile.values()) {
        let changed: boolean = true
        while (changed) {
            changed = false
            const impureNames: Set<string> = new Set(
                fileFunctions.filter(f => f.sideEffects.length > 0).map(f => f.name),
            )
            for (const fn of fileFunctions) {
                if (fn.sideEffects.length > 0) continue
                for (const impureName of impureNames) {
                    const callPattern: RegExp = new RegExp(`\\b${impureName}\\s*\\(`)
                    if (callPattern.test(fn.bodyText)) {
                        fn.sideEffects = ['transitive']
                        changed = true
                        break
                    }
                }
            }
        }
    }

    // Pass 2: cross-file propagation (relative imports only)
    const impureExportsByFile: Map<string, Set<string>> = new Map()
    for (const fn of allFunctions) {
        if (fn.sideEffects.length > 0 && fn.isExported) {
            const absPath: string = resolve(REPO_ROOT, fn.file)
            let names: Set<string> | undefined = impureExportsByFile.get(absPath)
            if (!names) {
                names = new Set()
                impureExportsByFile.set(absPath, names)
            }
            names.add(fn.name)
        }
    }

    const sourceFileCache: Map<string, ts.SourceFile> = new Map()

    for (const [relFile, fileFunctions] of byFile) {
        const absPath: string = resolve(REPO_ROOT, relFile)
        let sourceFile: ts.SourceFile | undefined = sourceFileCache.get(absPath)
        if (!sourceFile) {
            const pureFunctions: MutableFunctionInfo[] = fileFunctions.filter(f => f.sideEffects.length === 0)
            if (pureFunctions.length === 0) continue

            try {
                const text: string = ts.sys.readFile(absPath) ?? ''
                sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true)
                sourceFileCache.set(absPath, sourceFile)
            } catch {
                continue
            }
        }

        const importedImpureNames: Set<string> = extractImportedImpureNames(sourceFile, impureExportsByFile, absPath)
        if (importedImpureNames.size === 0) continue

        for (const fn of fileFunctions) {
            if (fn.sideEffects.length > 0) continue
            for (const impureName of importedImpureNames) {
                const callPattern: RegExp = new RegExp(`\\b${impureName}\\s*\\(`)
                if (callPattern.test(fn.bodyText)) {
                    fn.sideEffects = ['transitive-import']
                    break
                }
            }
        }
    }
}

type ArchLayer = 'pure' | 'shell/edge' | 'libraries' | 'systems' | 'UI' | 'other'

function classifyLayer(filePath: string): ArchLayer {
    if (filePath.includes('/pure/')) return 'pure'
    if (filePath.includes('shell/edge/')) return 'shell/edge'
    if (filePath.includes('shell/UI/')) return 'UI'
    if (filePath.startsWith('packages/libraries/')) return 'libraries'
    if (filePath.startsWith('packages/systems/')) return 'systems'
    return 'other'
}

type LayerStats = {
    totalLoc: number
    pureLoc: number
    impureLoc: number
    fnCount: number
    sideEffectBreakdown: Record<string, number>
}

async function analyzeAllFunctions(): Promise<{
    functions: FunctionInfo[]
    byLayer: Record<ArchLayer, LayerStats>
    totals: LayerStats
}> {
    const packages = await discoverPackages()
    const allFiles: string[] = (await Promise.all(packages.map(pkg => listSourceFiles(pkg.srcRoot)))).flat()
    const allMutable: MutableFunctionInfo[] = []

    await Promise.all(allFiles.map(async filePath => {
        const text: string = await readFile(filePath, 'utf8')
        const sourceFile: ts.SourceFile = ts.createSourceFile(
            filePath, text, ts.ScriptTarget.Latest, true,
        )
        allMutable.push(...extractFunctions(filePath, sourceFile))
    }))

    propagateImpurity(allMutable)

    const allFunctions: FunctionInfo[] = allMutable.map(({ bodyText: _, ...rest }) => rest)

    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const byLayer: Record<string, LayerStats> = {}
    for (const layer of layers) {
        byLayer[layer] = { totalLoc: 0, pureLoc: 0, impureLoc: 0, fnCount: 0, sideEffectBreakdown: {} }
    }

    const totals: LayerStats = { totalLoc: 0, pureLoc: 0, impureLoc: 0, fnCount: 0, sideEffectBreakdown: {} }

    for (const fn of allFunctions) {
        const layer: ArchLayer = classifyLayer(fn.file)
        const stats: LayerStats = byLayer[layer]
        stats.totalLoc += fn.loc
        stats.fnCount++
        totals.totalLoc += fn.loc
        totals.fnCount++

        if (fn.sideEffects.length === 0) {
            stats.pureLoc += fn.loc
            totals.pureLoc += fn.loc
        } else {
            stats.impureLoc += fn.loc
            totals.impureLoc += fn.loc
            for (const effect of fn.sideEffects) {
                stats.sideEffectBreakdown[effect] = (stats.sideEffectBreakdown[effect] ?? 0) + fn.loc
                totals.sideEffectBreakdown[effect] = (totals.sideEffectBreakdown[effect] ?? 0) + fn.loc
            }
        }
    }

    return { functions: allFunctions, byLayer: byLayer as Record<ArchLayer, LayerStats>, totals }
}

function formatPercent(n: number, d: number): string {
    if (d === 0) return 'N/A'
    return `${((n / d) * 100).toFixed(1)}%`
}

function formatLayerReport(byLayer: Record<ArchLayer, LayerStats>, totals: LayerStats): string {
    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const lines: string[] = [
        '',
        '┌─────────────┬────────┬────────┬────────┬────────────┬───────┐',
        '│ Layer       │  Total │   Pure │ Impure │ Pure ratio │   Fns │',
        '├─────────────┼────────┼────────┼────────┼────────────┼───────┤',
    ]
    for (const layer of layers) {
        const s: LayerStats = byLayer[layer]
        if (s.totalLoc === 0) continue
        lines.push(
            `│ ${layer.padEnd(11)} │ ${String(s.totalLoc).padStart(6)} │ ${String(s.pureLoc).padStart(6)} │ ${String(s.impureLoc).padStart(6)} │ ${formatPercent(s.pureLoc, s.totalLoc).padStart(10)} │ ${String(s.fnCount).padStart(5)} │`,
        )
    }
    lines.push('├─────────────┼────────┼────────┼────────┼────────────┼───────┤')
    lines.push(
        `│ ${'TOTAL'.padEnd(11)} │ ${String(totals.totalLoc).padStart(6)} │ ${String(totals.pureLoc).padStart(6)} │ ${String(totals.impureLoc).padStart(6)} │ ${formatPercent(totals.pureLoc, totals.totalLoc).padStart(10)} │ ${String(totals.fnCount).padStart(5)} │`,
    )
    lines.push('└─────────────┴────────┴────────┴────────┴────────────┴───────┘')
    lines.push('(All values are LOC — non-empty lines inside function bodies)')

    lines.push('')
    lines.push('Side-effect categories (LOC in impure functions):')
    const sorted: [string, number][] = Object.entries(totals.sideEffectBreakdown)
        .sort(([, a], [, b]) => b - a)
    for (const [category, locCount] of sorted) {
        lines.push(`  ${category.padEnd(20)} ${locCount} LOC`)
    }
    lines.push('')

    return lines.join('\n')
}

const {minimumPurityRatio: MINIMUM_PURITY_RATIO} = readBudgetSync<{minimumPurityRatio: number}>('purity/purity-ratio.json')

describe('function purity ratio (LOC)', () => {
    it('pure LOC ratio must be at least 55%', async () => {
        const { byLayer, totals } = await analyzeAllFunctions()

        const report: string = formatLayerReport(byLayer, totals)
        console.info(report)

        expect(totals.totalLoc).toBeGreaterThan(0)
        const purityRatio: number = totals.pureLoc / totals.totalLoc
        console.info(`Overall purity ratio: ${(purityRatio * 100).toFixed(1)}% (${totals.pureLoc} / ${totals.totalLoc} LOC)`)

        await recordHealthMetric({
            metricId: 'purity-ratio',
            metricName: 'Purity Ratio',
            description: 'Share of function LOC classified as pure by lexical side-effect detection.',
            category: 'Purity',
            current: purityRatio,
            budget: MINIMUM_PURITY_RATIO,
            comparison: 'gte',
            unit: 'ratio',
            details: {totals, byLayer},
        })

        expect(
            purityRatio,
            `Purity ratio ${(purityRatio * 100).toFixed(1)}% is below the ${(MINIMUM_PURITY_RATIO * 100).toFixed(0)}% threshold. `
            + `${totals.impureLoc} LOC in impure functions out of ${totals.totalLoc} total LOC.`,
        ).toBeGreaterThanOrEqual(MINIMUM_PURITY_RATIO)
    }, 30000)

    it('functions in pure/ directories have no detected side effects', async () => {
        const { functions } = await analyzeAllFunctions()

        const pureDirFunctions: FunctionInfo[] = functions.filter(fn => fn.file.includes('/pure/'))
        const violations: FunctionInfo[] = pureDirFunctions.filter(fn => fn.sideEffects.length > 0)
        const violationLoc: number = violations.reduce((sum, fn) => sum + fn.loc, 0)
        const totalPureDirLoc: number = pureDirFunctions.reduce((sum, fn) => sum + fn.loc, 0)

        if (violations.length > 0) {
            const report: string = violations
                .map(fn => `  ${fn.file}:${fn.line} ${fn.name}() [${fn.loc} LOC] — ${fn.sideEffects.join(', ')}`)
                .join('\n')
            console.warn(`Functions in pure/ with detected side effects:\n${report}`)
        }

        console.info(
            `pure/ directory: ${totalPureDirLoc} LOC across ${pureDirFunctions.length} functions, ${violationLoc} LOC with side-effect indicators`,
        )
        await recordHealthMetric({
            metricId: 'purity-ratio-pure-dir-side-effects',
            metricName: 'Purity Ratio Pure Directory Side Effects',
            description: 'Impure LOC detected inside pure/ directories by lexical side-effect detection.',
            category: 'Purity',
            current: violationLoc,
            budget: 0,
            comparison: 'lte',
            unit: 'LOC',
            details: {
                totalPureDirLoc,
                violations,
            },
        })
        expect(violationLoc).toBe(0)
    }, 30000)
})
