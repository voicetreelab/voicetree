import {readFile} from 'node:fs/promises'
import {dirname, relative, resolve} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../_shared/discovery/discover-packages'
import {type SourceFile, scanSourceFiles} from '../../_shared/graph/import-graph'
import {communityAtDepth} from '../../_shared/community/community-at-depth.ts'
import {
    GLOBAL_SIDE_EFFECT_CATEGORIES,
    extractFunctions,
    propagateImpurity,
    type FnEntry,
} from '../../_shared/purity-analysis'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

// --- Per-community behavioral complexity scanner ---
//
// Surfaces hidden mutable state + impure globals that the structural import-graph
// measure (hierarchical-complexity.test.ts) cannot see. Empirical anchor:
// graph-db-server/state/ scores BW=0.0 in the import-graph (cleanest community)
// yet holds 9 module-level mutable bindings — the source of the dual-state bug.
// See voicetree-8-5/redteam-fp-visibility-falsifier-empirical.md.

const REPO_ROOT: string = DEFAULT_REPO_ROOT

const MUTABLE_CONTAINER_CTORS: ReadonlySet<string> = new Set([
    'Map', 'Set', 'WeakMap', 'WeakSet',
])


type StateBinding = {
    readonly file: string
    readonly line: number
    readonly name: string
    readonly kind: 'let' | 'mutable-container' | 'mutable-array'
    readonly detail: string
}

type CommunityBehavioralReport = {
    readonly id: string
    readonly fileCount: number
    readonly stateBindings: readonly StateBinding[]
    readonly stateBindingCount: number
    readonly functionCount: number
    readonly impureFunctionCount: number
    readonly impureFunctionRatio: number
    readonly globalsByCategory: Readonly<Record<string, number>>
    readonly impureGlobalsCount: number
    readonly score: number
}

// --- Module-level state binding detection ---
//
// Counts as state binding when at the source file top level:
//   1. any `let` declaration                          → mutable binding
//   2. `const x = new Map()/new Set()/new WeakMap/Set` → mutable container
//   3. `const x: T[] = []` or `const x = []`           → mutable array container
//
// Plain `const x = literal | object literal` is NOT flagged: precision over recall.
// Imports, types, interfaces, function declarations, classes are all not flagged.

function classifyInitializer(init: ts.Expression | undefined): StateBinding['kind'] | null {
    if (!init) return null
    if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)
        && MUTABLE_CONTAINER_CTORS.has(init.expression.text)) {
        return 'mutable-container'
    }
    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)
        && MUTABLE_CONTAINER_CTORS.has(init.expression.text)) {
        return 'mutable-container'
    }
    if (ts.isArrayLiteralExpression(init) && init.elements.length === 0) {
        return 'mutable-array'
    }
    return null
}

function detectStateBindings(filePath: string, sf: ts.SourceFile): StateBinding[] {
    const bindings: StateBinding[] = []
    const rel: string = relative(REPO_ROOT, filePath)
    for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt)) continue
        const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0
        for (const decl of stmt.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name)) continue
            const line = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1
            if (isLet) {
                bindings.push({
                    file: rel, line, name: decl.name.text,
                    kind: 'let',
                    detail: decl.type ? `let ${decl.name.text}: ${decl.type.getText(sf)}` : `let ${decl.name.text}`,
                })
                continue
            }
            const initKind = classifyInitializer(decl.initializer)
            if (initKind) {
                bindings.push({
                    file: rel, line, name: decl.name.text,
                    kind: initKind,
                    detail: `const ${decl.name.text} = ${decl.initializer?.getText(sf).slice(0, 40) ?? ''}`,
                })
            }
        }
    }
    return bindings
}

// --- Aggregate per community ---

type CommunityAccumulator = {
    files: SourceFile[]
    bindings: StateBinding[]
    fns: FnEntry[]
}

function aggregatePerCommunity(
    files: readonly SourceFile[],
    bindingsByFile: ReadonlyMap<string, readonly StateBinding[]>,
    fnsByFile: ReadonlyMap<string, readonly FnEntry[]>,
    depth: number,
): CommunityBehavioralReport[] {
    const byCommunity = new Map<string, CommunityAccumulator>()
    for (const file of files) {
        const id = communityAtDepth(file.packageName, file.relToSrc, depth)
        if (!byCommunity.has(id)) byCommunity.set(id, {files: [], bindings: [], fns: []})
        const acc = byCommunity.get(id)!
        acc.files.push(file)
        const fb = bindingsByFile.get(file.absolutePath)
        if (fb) acc.bindings.push(...fb)
        const ff = fnsByFile.get(file.relativePath)
        if (ff) acc.fns.push(...ff)
    }

    return [...byCommunity.entries()].map(([id, acc]) => {
        const impureCount = acc.fns.filter(f => f.sideEffects.length > 0).length
        const ratio = acc.fns.length === 0 ? 0 : impureCount / acc.fns.length

        const globalsByCategory: Record<string, number> = Object.fromEntries(
            GLOBAL_SIDE_EFFECT_CATEGORIES.map(c => [c, 0]),
        )
        let impureGlobalsCount = 0
        for (const fn of acc.fns) {
            for (const effect of fn.sideEffects) {
                if (effect in globalsByCategory) {
                    globalsByCategory[effect] += 1
                    impureGlobalsCount += 1
                }
            }
        }

        const stateBindingCount = acc.bindings.length
        // Score: state bindings dominate (hidden coupling channel) + small global-effects term.
        const score = stateBindingCount * 3 + Math.round(impureGlobalsCount / 4)

        return {
            id,
            fileCount: acc.files.length,
            stateBindings: acc.bindings,
            stateBindingCount,
            functionCount: acc.fns.length,
            impureFunctionCount: impureCount,
            impureFunctionRatio: ratio,
            globalsByCategory,
            impureGlobalsCount,
            score,
        }
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

// --- Report formatting ---

function formatGlobalsBreakdown(globals: Readonly<Record<string, number>>): string {
    const items = Object.entries(globals).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)
    if (items.length === 0) return '—'
    return items.map(([cat, n]) => `${cat}=${n}`).join(' ')
}

function formatReport(reports: readonly CommunityBehavioralReport[], topN = 10): string {
    const lines: string[] = ['']
    lines.push('='.repeat(80))
    lines.push('BEHAVIORAL COMPLEXITY — hidden mutable state + impure globals per community')
    lines.push('='.repeat(80))
    lines.push('  state bindings = top-level `let` + `const Map/Set/[]` (mutable references)')
    lines.push('  impure ratio   = fns with detected side effects / total fns')
    lines.push('  score          = state_bindings × 3 + globals/4 (state dominates)\n')

    const header = '  ' + [
        '#'.padStart(3),
        'Community'.padEnd(42),
        'Files'.padStart(5),
        'State'.padStart(5),
        'Fns'.padStart(4),
        'Impure%'.padStart(7),
        'Score'.padStart(5),
    ].join(' ')
    lines.push(header)
    lines.push('  ' + '─'.repeat(80))
    for (const [i, r] of reports.slice(0, topN).entries()) {
        lines.push('  ' + [
            String(i + 1).padStart(3),
            r.id.padEnd(42),
            String(r.fileCount).padStart(5),
            String(r.stateBindingCount).padStart(5),
            String(r.functionCount).padStart(4),
            `${(r.impureFunctionRatio * 100).toFixed(0)}%`.padStart(7),
            String(r.score).padStart(5),
        ].join(' '))
    }
    if (reports.length > topN) {
        lines.push(`  … +${reports.length - topN} more (set BEHAVIORAL_TOP_N env var to see more)`)
    }

    lines.push('')
    lines.push(`Top ${topN} communities with mutable state — detail:`)
    for (const r of reports.filter(r => r.stateBindingCount > 0).slice(0, topN)) {
        lines.push(`\n  ${r.id}  (${r.stateBindingCount} bindings, globals: ${formatGlobalsBreakdown(r.globalsByCategory)})`)
        for (const b of r.stateBindings.slice(0, 12)) {
            lines.push(`    ${b.file}:${b.line}  [${b.kind}]  ${b.detail}`)
        }
        if (r.stateBindings.length > 12) {
            lines.push(`    … +${r.stateBindings.length - 12} more`)
        }
    }
    return lines.join('\n')
}

// --- Test ---

const {orangeBehavioralBudget: ORANGE_BEHAVIORAL_BUDGET} = readBudgetSync<{orangeBehavioralBudget: number}>('complexity/behavioral-complexity.json')
const GRAPH_DB_SERVER_STATE_GOLD_STANDARD_SCORE_FLOOR = 6

describe('behavioral complexity', () => {
    it('reports hidden mutable state + impure globals per community at all directory containment depths', async () => {
        const topN = process.env.BEHAVIORAL_TOP_N ? parseInt(process.env.BEHAVIORAL_TOP_N, 10) : 10
        const scope = process.env.BEHAVIORAL_SCOPE ? resolve(process.env.BEHAVIORAL_SCOPE) : null

        const packages = await discoverPackages()
        const allFiles = await scanSourceFiles(packages, REPO_ROOT)
        const files = scope
            ? allFiles.filter(f => f.absolutePath.startsWith(scope + '/') || f.absolutePath === scope)
            : allFiles
        if (scope) console.info(`\nScoped to: ${scope}  (${files.length}/${allFiles.length} files)`)

        const bindingsByFile = new Map<string, readonly StateBinding[]>()
        const fnsByFile = new Map<string, FnEntry[]>()
        const allFns: FnEntry[] = []

        await Promise.all(files.map(async f => {
            const text = await readFile(f.absolutePath, 'utf8')
            const sf = ts.createSourceFile(f.absolutePath, text, ts.ScriptTarget.Latest, true)
            bindingsByFile.set(f.absolutePath, detectStateBindings(f.absolutePath, sf))
            const fns = extractFunctions(f.absolutePath, sf)
            fnsByFile.set(f.relativePath, fns)
            allFns.push(...fns)
        }))
        propagateImpurity(allFns)

        const maxDepth = Math.max(...files.map(f => {
            const dir = dirname(f.relToSrc)
            return dir === '.' ? 0 : dir.split('/').length
        }))

        let depth1Reports: CommunityBehavioralReport[] = []
        const allReports: CommunityBehavioralReport[] = []
        for (let depth = 1; depth <= maxDepth; depth++) {
            const reports = aggregatePerCommunity(files, bindingsByFile, fnsByFile, depth)
            console.info(`\n${'='.repeat(60)}\nDEPTH ${depth}\n${'='.repeat(60)}`)
            console.info(formatReport(reports, topN))
            allReports.push(...reports)
            if (depth === 1) depth1Reports = reports
        }

        // Gold-standard guard uses depth-1 community ID — must remain discoverable at depth 1
        const stateReport = depth1Reports.find(r => r.id === 'graph-db-server/state')
        const overBudget = allReports.filter(r => r.score > ORANGE_BEHAVIORAL_BUDGET)
        const maxScore = allReports.reduce((max, r) => Math.max(max, r.score), 0)

        await recordHealthMetric({
            metricId: 'behavioral-complexity',
            metricName: 'Behavioral Complexity Orange Gate',
            description: 'Per-community hidden mutable state + impure globals score (state × 3 + globals/4). Fractal: evaluated at all directory containment depths.',
            category: 'Behavioral',
            current: maxScore,
            budget: ORANGE_BEHAVIORAL_BUDGET,
            comparison: 'lte',
            unit: 'score',
            details: {
                overBudget: overBudget.slice(0, 20),
                topScored: [...allReports].sort((a, b) => b.score - a.score).slice(0, 20),
                communityCount: allReports.length,
                maxDepth,
                graphDbServerState: stateReport ?? null,
            },
        })

        // Gold-standard guard: the empirical falsifier case MUST remain visible.
        // If graph-db-server/state drops below the original detection floor, the scanner is broken
        // (graph-db-server/state holds 9 module-level mutable bindings — see
        // voicetree-8-5/redteam-fp-visibility-falsifier-empirical.md).
        expect(
            stateReport,
            'graph-db-server/state community must be discovered — scanner is broken otherwise',
        ).toBeDefined()
        expect(
            stateReport!.stateBindingCount,
            `graph-db-server/state should hold at least 6 module-level mutable bindings (found ${stateReport!.stateBindingCount}); scanner is broken otherwise`,
        ).toBeGreaterThanOrEqual(6)
        expect(
            stateReport!.score,
            `graph-db-server/state MUST exceed the gold-standard detection floor; score=${stateReport!.score} floor=${GRAPH_DB_SERVER_STATE_GOLD_STANDARD_SCORE_FLOOR}`,
        ).toBeGreaterThan(GRAPH_DB_SERVER_STATE_GOLD_STANDARD_SCORE_FLOOR)

        if (overBudget.length > 0) {
            const lines: string[] = [
                '',
                `Orange behavioral gate: ${overBudget.length} communities exceed score budget (> ${ORANGE_BEHAVIORAL_BUDGET}).`,
                'Highest hidden coupling (state_bindings × 3 + globals/4):',
            ]
            for (const [i, r] of overBudget.slice(0, 5).entries()) {
                lines.push(`  ${i + 1}. ${r.id}  score=${r.score}  state=${r.stateBindingCount}  fns(impure)=${r.impureFunctionCount}/${r.functionCount}`)
            }
            lines.push('')
            lines.push('Lower ORANGE_BEHAVIORAL_BUDGET as you eliminate module-level mutable bindings.')
            throw new Error(lines.join('\n'))
        }
    }, 60000)
})
