import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../..')

const SOURCE_ROOTS: readonly string[] = [
    join(REPO_ROOT, 'packages/libraries'),
    join(REPO_ROOT, 'packages/systems'),
    join(REPO_ROOT, 'webapp/src'),
]

function isProductionSource(filePath: string): boolean {
    return (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
        && !filePath.endsWith('.test.ts')
        && !filePath.endsWith('.test.tsx')
        && !filePath.endsWith('.spec.ts')
        && !filePath.endsWith('.d.ts')
        && !filePath.endsWith('.config.ts')
        && !filePath.includes('__tests__')
        && !filePath.includes('integration-tests')
        && !filePath.includes('node_modules')
        && !filePath.includes('/dist/')
        && !filePath.includes('/build/')
}

async function listSourceFiles(root: string): Promise<string[]> {
    const results: string[] = []

    async function walk(dir: string): Promise<void> {
        let entries
        try {
            entries = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        await Promise.all(entries.map(async entry => {
            const fullPath: string = join(dir, entry.name)
            if (entry.isDirectory()) {
                await walk(fullPath)
            } else if (entry.isFile() && isProductionSource(fullPath)) {
                results.push(fullPath)
            }
        }))
    }

    await walk(root)
    return results.sort()
}

type FunctionInfo = {
    readonly name: string
    readonly file: string
    readonly line: number
    readonly isExported: boolean
    readonly isAsync: boolean
    readonly sideEffects: readonly string[]
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

function detectSideEffects(bodyText: string): string[] {
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

function extractFunctions(filePath: string, sourceFile: ts.SourceFile): FunctionInfo[] {
    const functions: FunctionInfo[] = []
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

    function visit(node: ts.Node): void {
        if (ts.isFunctionDeclaration(node) && node.name) {
            const bodyText: string = getBodyText(node)
            if (bodyText) {
                functions.push({
                    name: node.name.text,
                    file: relPath,
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                    isExported: isExported(node),
                    isAsync: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
                    sideEffects: detectSideEffects(bodyText),
                })
            }
        }

        if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
            const init: ts.Expression = node.initializer
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
                const bodyText: string = getBodyText(init)
                if (bodyText) {
                    functions.push({
                        name: node.name.text,
                        file: relPath,
                        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                        isExported: isExported(node),
                        isAsync: hasModifier(init, ts.SyntaxKind.AsyncKeyword),
                        sideEffects: detectSideEffects(bodyText),
                    })
                }
            }
        }

        if (ts.isMethodDeclaration(node) && node.name) {
            const bodyText: string = getBodyText(node)
            if (bodyText) {
                functions.push({
                    name: node.name.getText(sourceFile),
                    file: relPath,
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                    isExported: false,
                    isAsync: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
                    sideEffects: detectSideEffects(bodyText),
                })
            }
        }

        ts.forEachChild(node, visit)
    }

    ts.forEachChild(sourceFile, child => visit(child))
    return functions
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
    total: number
    pure: number
    impure: number
    sideEffectBreakdown: Record<string, number>
}

async function analyzeAllFunctions(): Promise<{
    functions: FunctionInfo[]
    byLayer: Record<ArchLayer, LayerStats>
    totals: LayerStats
}> {
    const allFiles: string[] = (await Promise.all(SOURCE_ROOTS.map(listSourceFiles))).flat()
    const allFunctions: FunctionInfo[] = []

    await Promise.all(allFiles.map(async filePath => {
        const text: string = await readFile(filePath, 'utf8')
        const sourceFile: ts.SourceFile = ts.createSourceFile(
            filePath, text, ts.ScriptTarget.Latest, true,
        )
        const functions: FunctionInfo[] = extractFunctions(filePath, sourceFile)
        allFunctions.push(...functions)
    }))

    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const byLayer: Record<string, LayerStats> = {}
    for (const layer of layers) {
        byLayer[layer] = { total: 0, pure: 0, impure: 0, sideEffectBreakdown: {} }
    }

    const totals: LayerStats = { total: 0, pure: 0, impure: 0, sideEffectBreakdown: {} }

    for (const fn of allFunctions) {
        const layer: ArchLayer = classifyLayer(fn.file)
        const stats: LayerStats = byLayer[layer]
        stats.total++
        totals.total++

        if (fn.sideEffects.length === 0) {
            stats.pure++
            totals.pure++
        } else {
            stats.impure++
            totals.impure++
            for (const effect of fn.sideEffects) {
                stats.sideEffectBreakdown[effect] = (stats.sideEffectBreakdown[effect] ?? 0) + 1
                totals.sideEffectBreakdown[effect] = (totals.sideEffectBreakdown[effect] ?? 0) + 1
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
        '┌─────────────┬───────┬──────┬────────┬────────────┐',
        '│ Layer       │ Total │ Pure │ Impure │ Pure ratio │',
        '├─────────────┼───────┼──────┼────────┼────────────┤',
    ]
    for (const layer of layers) {
        const s: LayerStats = byLayer[layer]
        if (s.total === 0) continue
        lines.push(
            `│ ${layer.padEnd(11)} │ ${String(s.total).padStart(5)} │ ${String(s.pure).padStart(4)} │ ${String(s.impure).padStart(6)} │ ${formatPercent(s.pure, s.total).padStart(10)} │`,
        )
    }
    lines.push('├─────────────┼───────┼──────┼────────┼────────────┤')
    lines.push(
        `│ ${'TOTAL'.padEnd(11)} │ ${String(totals.total).padStart(5)} │ ${String(totals.pure).padStart(4)} │ ${String(totals.impure).padStart(6)} │ ${formatPercent(totals.pure, totals.total).padStart(10)} │`,
    )
    lines.push('└─────────────┴───────┴──────┴────────┴────────────┘')

    lines.push('')
    lines.push('Side-effect categories across impure functions:')
    const sorted: [string, number][] = Object.entries(totals.sideEffectBreakdown)
        .sort(([, a], [, b]) => b - a)
    for (const [category, count] of sorted) {
        lines.push(`  ${category.padEnd(20)} ${count}`)
    }
    lines.push('')

    return lines.join('\n')
}

describe('function purity ratio', () => {
    it('reports the ratio of pure to impure functions across the codebase', async () => {
        const { byLayer, totals } = await analyzeAllFunctions()

        const report: string = formatLayerReport(byLayer, totals)
        console.info(report)

        expect(totals.total).toBeGreaterThan(0)
        const purityRatio: number = totals.pure / totals.total
        console.info(`Overall purity ratio: ${(purityRatio * 100).toFixed(1)}%`)
    })

    it('functions in pure/ directories have no detected side effects', async () => {
        const { functions } = await analyzeAllFunctions()

        const pureDirFunctions: FunctionInfo[] = functions.filter(fn => fn.file.includes('/pure/'))
        const violations: FunctionInfo[] = pureDirFunctions.filter(fn => fn.sideEffects.length > 0)

        if (violations.length > 0) {
            const report: string = violations
                .map(fn => `  ${fn.file}:${fn.line} ${fn.name}() — ${fn.sideEffects.join(', ')}`)
                .join('\n')
            console.warn(`Functions in pure/ with detected side effects:\n${report}`)
        }

        console.info(
            `pure/ directory: ${pureDirFunctions.length} functions, ${violations.length} with side-effect indicators`,
        )
        expect(violations.length).toBeLessThanOrEqual(pureDirFunctions.length * 0.05)
    })
})
