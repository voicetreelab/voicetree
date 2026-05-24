/**
 * `implicit-globals` — count references to side-effect-flavoured symbols
 * per file, broken down by category, aggregated per community.
 *
 * The point: a function's true input set should be visible in its type
 * signature. When a function reaches for `fs.appendFileSync` or `Date.now()`
 * directly, the caller has no idea that's happening — the dependency is
 * "implicit" (hidden in the import graph or in the JavaScript runtime).
 * Fix is FP pattern 3 (Reader env): thread an `env` argument carrying
 * `env.fs`, `env.now()` etc.
 *
 * "Reference" here = any occurrence in the file's AST where the symbol
 * is resolved as a *free identifier* (i.e. not a function parameter
 * shadowing it). That covers:
 *   - the import itself (`import * as fs from 'node:fs'`)
 *   - each call site (`fs.writeFile(...)`)
 *   - each property read (`process.env.HOME`)
 *
 * Categorisation matches the FP-pattern routing — the gate's error
 * message can point at the precise category that's leaking.
 *
 * Categories (kept narrow on purpose — false positives erode trust):
 *   - `fs`      : node:fs, node:fs/promises imports + their named usages
 *   - `path-io` : node:path imports BUT ONLY when the file also imports fs
 *                 (pure path math is not impure; co-occurrence with fs is
 *                 the signal we care about)
 *   - `process` : `process.env`, `process.argv`, `process.cwd`, `process.exit`,
 *                 `process.platform`, `process.stdout`/`stderr` writes
 *   - `time`    : `Date.now()`, `new Date()` with no args, `performance.now()`
 *   - `random`  : `Math.random()`, `crypto.randomBytes`, `crypto.randomUUID`
 *   - `console` : every `console.*` call
 *   - `crypto`  : node:crypto imports + usages (NOT Math.random — that's `random`)
 *   - `timer`   : `setTimeout`, `setInterval`, `setImmediate`, `clearTimeout`,
 *                 `clearInterval`, `clearImmediate`
 *   - `network` : node:http / node:https / node:net / node:dgram imports + usages,
 *                 `fetch(...)` calls
 *   - `dynamic-import` : `import(...)` expressions
 *
 * Notes on what we DO NOT flag:
 *   - Type-only imports (`import type {Stats} from 'node:fs'`) — types are
 *     erased at runtime; they don't create runtime coupling.
 *   - `path.posix.sep` / `path.SEP` / pure path math when the file does
 *     not also touch fs — pure functions are fine.
 *   - `Date.UTC(...)`, `new Date(isoString)` — deterministic given input.
 *
 * Per-community score: sum of all category counts across files in the
 * touched community. Threshold 0; baseline-aware severity (a community
 * that already had 12 console calls gets `warn` while a regression
 * (e.g. 12 → 13) gets `fail`).
 */
import {Node, SyntaxKind, type SourceFile as MorphSourceFile} from 'ts-morph'
import {loadBaseline} from '../../_internal/baseline-store.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'implicit-globals'

export type GlobalCategory =
    | 'fs'
    | 'path-io'
    | 'process'
    | 'time'
    | 'random'
    | 'console'
    | 'crypto'
    | 'timer'
    | 'network'
    | 'dynamic-import'

export const ALL_CATEGORIES: readonly GlobalCategory[] = [
    'fs', 'path-io', 'process', 'time', 'random', 'console', 'crypto', 'timer', 'network', 'dynamic-import',
] as const

type CategoryCounts = Partial<Record<GlobalCategory, number>>

export type FileImplicitGlobalsReport = {
    readonly filePath: string
    readonly byCategory: CategoryCounts
    readonly total: number
}

// --- Module specifier → category map ---

const MODULE_TO_CATEGORY: ReadonlyMap<string, GlobalCategory> = new Map([
    ['fs', 'fs'], ['node:fs', 'fs'],
    ['fs/promises', 'fs'], ['node:fs/promises', 'fs'],
    ['path', 'path-io'], ['node:path', 'path-io'],
    ['crypto', 'crypto'], ['node:crypto', 'crypto'],
    ['http', 'network'], ['node:http', 'network'],
    ['https', 'network'], ['node:https', 'network'],
    ['net', 'network'], ['node:net', 'network'],
    ['dgram', 'network'], ['node:dgram', 'network'],
])

// --- Identifier (global) → category map ---

const GLOBAL_IDENT_TO_CATEGORY: ReadonlyMap<string, GlobalCategory> = new Map([
    ['console', 'console'],
    ['process', 'process'],
    ['fetch', 'network'],
    ['setTimeout', 'timer'],
    ['setInterval', 'timer'],
    ['setImmediate', 'timer'],
    ['clearTimeout', 'timer'],
    ['clearInterval', 'timer'],
    ['clearImmediate', 'timer'],
])

/**
 * Property-chain rules for globals that are themselves pure namespaces
 * (Date, Math, crypto) but expose impure surfaces. We only flag the
 * specific impure methods, not every property.
 */
type ChainRule = {
    readonly root: string
    readonly method: string
    readonly category: GlobalCategory
}

const CHAIN_RULES: readonly ChainRule[] = [
    {root: 'Date', method: 'now', category: 'time'},
    {root: 'Math', method: 'random', category: 'random'},
    {root: 'performance', method: 'now', category: 'time'},
    {root: 'crypto', method: 'randomUUID', category: 'random'},
    {root: 'crypto', method: 'randomBytes', category: 'random'},
    {root: 'crypto', method: 'getRandomValues', category: 'random'},
]

// --- AST walker ---

/**
 * Collect the names that are function/method parameters at any scope —
 * those are *not* free identifiers and must not be counted even if they
 * happen to be named `fs` or `console`. (A function written defensively
 * as `const log = (env, fs) => fs.append(...)` is using a parameter,
 * not the global — and that's actually the GOOD pattern we're trying
 * to push people toward.)
 */
function collectParamNames(sourceFile: MorphSourceFile): ReadonlySet<string> {
    const params = new Set<string>()
    sourceFile.forEachDescendant(node => {
        if (
            Node.isParameterDeclaration(node)
            || Node.isBindingElement(node)
        ) {
            const nameNode = node.getNameNode()
            if (Node.isIdentifier(nameNode)) params.add(nameNode.getText())
            else {
                nameNode.forEachDescendant(d => {
                    if (
                        Node.isIdentifier(d)
                        && d.getParent()?.getKind() === SyntaxKind.BindingElement
                    ) params.add(d.getText())
                })
            }
        }
    })
    return params
}

/**
 * Collect the names locally bound by imports in this file, mapped to the
 * source-module category. These names ARE the implicit dependencies —
 * we count both the import itself and each downstream usage to give a
 * proportional severity signal.
 */
function collectImportBindings(sourceFile: MorphSourceFile): {
    readonly nameToCategory: ReadonlyMap<string, GlobalCategory>
    readonly counts: CategoryCounts
    readonly hasFsImport: boolean
} {
    const nameToCategory = new Map<string, GlobalCategory>()
    const counts: CategoryCounts = {}
    let hasFsImport = false
    for (const importDecl of sourceFile.getImportDeclarations()) {
        // Type-only imports are runtime-erased and not impure.
        if (importDecl.isTypeOnly()) continue
        const specifier = importDecl.getModuleSpecifierValue()
        const category = MODULE_TO_CATEGORY.get(specifier)
        if (!category) continue
        if (category === 'fs') hasFsImport = true
        // Count the import statement itself as one "incident" of the
        // implicit dependency on that subsystem.
        bump(counts, category, 1)
        // And record every locally bound name so we can count usage
        // sites too — a file that imports `fs` and uses it 30 times is
        // 30x as coupled as one that imports it and uses it once.
        const defaultImport = importDecl.getDefaultImport()
        if (defaultImport) nameToCategory.set(defaultImport.getText(), category)
        for (const named of importDecl.getNamedImports()) {
            if (named.isTypeOnly()) continue
            nameToCategory.set(named.getAliasNode()?.getText() ?? named.getName(), category)
        }
        const namespace = importDecl.getNamespaceImport()
        if (namespace) nameToCategory.set(namespace.getText(), category)
    }
    return {nameToCategory, counts, hasFsImport}
}

function bump(counts: CategoryCounts, category: GlobalCategory, by: number): void {
    counts[category] = (counts[category] ?? 0) + by
}

/**
 * For each Identifier node in the file, if it resolves to one of our
 * tracked categories (and is NOT a parameter shadow, NOT inside the
 * identifier portion of an import/export declaration), bump its category.
 *
 * Special handling for property-chain rules: `Date.now` is flagged as
 * `time` but `Date.UTC` is not. We inspect the immediate parent
 * PropertyAccessExpression to decide.
 */
function countFreeUsages(
    sourceFile: MorphSourceFile,
    importBindings: ReadonlyMap<string, GlobalCategory>,
    params: ReadonlySet<string>,
    out: CategoryCounts,
): void {
    sourceFile.forEachDescendant(node => {
        if (!Node.isIdentifier(node)) return

        // Skip identifier portion of declarations (we don't want
        // `const fs = ...` to count as a usage of `fs`).
        const parent = node.getParent()
        if (!parent) return
        if (
            Node.isImportClause(parent)
            || Node.isImportSpecifier(parent)
            || Node.isImportEqualsDeclaration(parent)
            || Node.isExportSpecifier(parent)
            || Node.isNamespaceImport(parent)
            || Node.isNamedImports(parent)
        ) return
        if (Node.isVariableDeclaration(parent) && parent.getNameNode() === node) return
        if (Node.isParameterDeclaration(parent) && parent.getNameNode() === node) return
        if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === node) return
        if (Node.isBindingElement(parent) && parent.getNameNode() === node) return
        if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
            // We're the `.name` half of `foo.name` — only count when we
            // hit the root identifier.
            return
        }
        // Parameter shadow: a `const log = (fs) => fs.x` is using the
        // parameter, not the global.
        const name = node.getText()
        if (params.has(name)) return

        // Imported name → count as that category's usage.
        const importCategory = importBindings.get(name)
        if (importCategory) {
            bump(out, importCategory, 1)
            return
        }

        // Free global identifier → category lookup.
        const globalCategory = GLOBAL_IDENT_TO_CATEGORY.get(name)
        if (globalCategory) {
            bump(out, globalCategory, 1)
            return
        }

        // Property-chain rules (Date.now, Math.random, performance.now).
        const chainCategory = matchChainRule(node)
        if (chainCategory) {
            bump(out, chainCategory, 1)
            return
        }
    })
}

function matchChainRule(rootId: Node): GlobalCategory | null {
    const name = rootId.getText()
    const parent = rootId.getParent()
    if (!parent || !Node.isPropertyAccessExpression(parent)) return null
    if (parent.getExpression() !== rootId) return null
    const member = parent.getNameNode().getText()
    for (const rule of CHAIN_RULES) {
        if (rule.root === name && rule.method === member) return rule.category
    }
    return null
}

/**
 * `new Date()` (zero args) is non-deterministic; `new Date(iso)` is fine.
 * Same is true for `new Date(year, month, ...)` — those are deterministic.
 */
function countNonDeterministicConstructions(sourceFile: MorphSourceFile, out: CategoryCounts): void {
    sourceFile.forEachDescendant(node => {
        if (!Node.isNewExpression(node)) return
        const expr = node.getExpression()
        if (!Node.isIdentifier(expr) || expr.getText() !== 'Date') return
        const args = node.getArguments()
        if (args.length === 0) bump(out, 'time', 1)
    })
}

/**
 * `import('./foo')` expressions are runtime coupling that the static
 * import graph cannot see — same family of "hidden edge" as the rest.
 */
function countDynamicImports(sourceFile: MorphSourceFile, out: CategoryCounts): void {
    sourceFile.forEachDescendant(node => {
        if (node.getKind() === SyntaxKind.ImportKeyword) {
            const parent = node.getParent()
            if (parent && Node.isCallExpression(parent) && parent.getExpression() === node) {
                bump(out, 'dynamic-import', 1)
            }
        }
    })
}

/**
 * Drop `path-io` counts unless the file also imports `fs` — pure path
 * math (join, dirname, resolve) is not impure, and flagging it would
 * be noise. Co-occurrence with fs is the actual IO signal.
 */
function maybeStripPathIo(counts: CategoryCounts, hasFsImport: boolean): CategoryCounts {
    if (hasFsImport) return counts
    if (!counts['path-io']) return counts
    const out = {...counts}
    delete out['path-io']
    return out
}

export function analyzeFile(sourceFile: MorphSourceFile): FileImplicitGlobalsReport {
    const filePath = sourceFile.getFilePath()
    const params = collectParamNames(sourceFile)
    const {nameToCategory, counts, hasFsImport} = collectImportBindings(sourceFile)
    countFreeUsages(sourceFile, nameToCategory, params, counts)
    countNonDeterministicConstructions(sourceFile, counts)
    countDynamicImports(sourceFile, counts)
    const final = maybeStripPathIo(counts, hasFsImport)
    const total = Object.values(final).reduce((sum, n) => sum + (n ?? 0), 0)
    return {filePath, byCategory: final, total}
}

function classifySeverity(
    score: number,
    baseline: number | null,
): 'pass' | 'warn' | 'fail' {
    if (score === 0) return 'pass'
    // Baseline-aware: existing surface = warn (already known), regression = fail.
    if (baseline !== null && score <= baseline) return 'warn'
    return 'fail'
}

function formatBreakdown(byCategory: CategoryCounts): string {
    const items = Object.entries(byCategory)
        .filter(([, n]) => (n ?? 0) > 0)
        .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    if (items.length === 0) return '—'
    return items.map(([cat, n]) => `${cat}=${n}`).join(' ')
}

function buildMessage(
    score: number,
    baseline: number | null,
    breakdown: CategoryCounts,
): string {
    const baselineFragment = baseline === null
        ? '(no baseline)'
        : `baseline=${baseline}`
    return (
        `${score} implicit-global reference(s) ${baselineFragment}: ${formatBreakdown(breakdown)}. `
        + 'These are hidden dependencies the type signature does not declare — '
        + 'thread an `env` argument (FP pattern 3: Reader-env) so callers see '
        + 'what the function actually depends on.'
    )
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const project = parsedSubgraph.getProject()
    const touched = new Set(parsedSubgraph.touchedCommunities)

    const perCommunity: Record<string, number> = {}
    const breakdownByCommunity: Record<string, CategoryCounts> = {}
    for (const community of touched) {
        perCommunity[community] = 0
        breakdownByCommunity[community] = {}
    }

    for (const file of parsedSubgraph.files) {
        const community = parsedSubgraph.communityMap.get(file.absolutePath)
        if (!community || !touched.has(community)) continue
        const morphFile = project.getSourceFile(file.absolutePath)
        if (!morphFile) continue
        const report = analyzeFile(morphFile)
        perCommunity[community] = (perCommunity[community] ?? 0) + report.total
        const bucket = breakdownByCommunity[community]
        for (const [cat, n] of Object.entries(report.byCategory)) {
            bucket[cat as GlobalCategory] = (bucket[cat as GlobalCategory] ?? 0) + (n ?? 0)
        }
    }

    const baseline = await loadBaseline(MEASURE_ID)
    const violations: Violation[] = []
    for (const community of touched) {
        const score = perCommunity[community] ?? 0
        if (score === 0) continue
        const baselineScore = community in baseline ? baseline[community] : null
        violations.push({
            community,
            score,
            baseline: baselineScore,
            severity: classifySeverity(score, baselineScore),
            message: buildMessage(score, baselineScore, breakdownByCommunity[community]),
        })
    }

    return {
        measureId: MEASURE_ID,
        perCommunity,
        violations,
    }
}

const measure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'behavioral',
    scope: 'file',
    needsTsMorph: true,
    needsInbound: false,
    run,
}

registerMeasure(measure)

export {measure}
