/**
 * `implicit-globals` — count references to side-effect-flavoured symbols
 * per file, broken down by category and aggregated per community.
 *
 * The point: a function's true input set should be visible in its type
 * signature. When a function reaches for `fs.appendFileSync` directly,
 * the caller has no idea that's happening — the dependency is "implicit"
 * (hidden in the import graph or the JavaScript runtime). The fix is FP
 * pattern 3 (Reader env): thread `env: {fs, ...}` so callers see it.
 *
 * Tiering (2026-05-26): not all impurity is equal, and gating console.log
 * with the same weight as fs.writeFile was producing noise that masked
 * real signal. Categories now split into three tiers:
 *
 *   - STRICT   — external-world effects + non-local nondeterminism that
 *                also creates real coupling. Regression FAILS the gate.
 *                fs, network, process, dynamic-import, timer, path-io.
 *
 *   - ADVISORY — local nondeterminism (test-determinism concern, not
 *                coupling). Shown in violation messages, but never
 *                contributes to the gated score. Add freely; the gate
 *                won't move. time, random, crypto.randomBytes/randomUUID.
 *
 *   - REPORT   — write-only side effects with no coupling impact.
 *                Completely dropped: not counted, not shown. console.
 *
 * Operationally: `perCommunity[c]` (the gated number, written to the
 * baseline file) is the STRICT-tier sum only. The advisory counts are
 * surfaced in violation messages so reviewers can see them, but they
 * don't affect severity. Console references vanish from the report
 * entirely.
 *
 * "Reference" = any occurrence in the file's AST where the symbol is
 * resolved as a *free identifier* (i.e. not a function parameter
 * shadowing it). That covers the import itself, each call site, and
 * each property read.
 *
 * Categories (kept narrow on purpose — false positives erode trust):
 *   - `fs`             [strict]   : node:fs, node:fs/promises imports + usages
 *   - `path-io`        [strict]   : node:path imports BUT ONLY when the file
 *                                   also imports fs (pure path math isn't impure)
 *   - `process`        [strict]   : process.env, process.argv, process.cwd, etc.
 *   - `network`        [strict]   : node:http/https/net/dgram + fetch
 *   - `dynamic-import` [strict]   : `import(...)` expressions
 *   - `timer`          [strict]   : setTimeout, setInterval, setImmediate, ...
 *   - `time`           [advisory] : Date.now(), `new Date()` (zero-arg), performance.now()
 *   - `random`         [advisory] : Math.random(), crypto.randomBytes/randomUUID/getRandomValues
 *   - `crypto`         [advisory] : node:crypto imports + usages (deterministic
 *                                   ones too; coarse-grained for now — TODO split)
 *   - `console`        [report]   : every console.* call (dropped from counts)
 *
 * Notes on what we DO NOT flag:
 *   - Type-only imports — types are runtime-erased.
 *   - Pure path math when fs is absent — pure functions are fine.
 *   - `Date.UTC(...)`, `new Date(isoString)` — deterministic given input.
 *
 * Severity policy:
 *   - strict > 0 AND (no baseline OR strict > baseline) → fail (new/regressed)
 *   - strict > 0 AND strict ≤ baseline → warn (existing strict surface)
 *   - strict = 0 AND advisory > 0 → warn (nondeterminism present, not gated)
 *   - else → no violation
 */
import {Node, SyntaxKind, type SourceFile as MorphSourceFile} from 'ts-morph'
import {loadBaseline} from '../../_internal/baseline-store.ts'
import {registerMeasure} from '../../_internal/registry.ts'

const SKILL_DOC = 'brain/workflows/engineering/architectural-complexity/fp-rearchitecting/address_measures/address-implicit-globals.md'
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

type Tier = 'strict' | 'advisory' | 'report'

/**
 * Per-category gating tier. See module docstring for rationale.
 *   strict   → contributes to the gated score; regression fails the gate.
 *   advisory → counted and shown in messages; never contributes to score.
 *   report   → silently dropped — not counted, not shown.
 */
const CATEGORY_TIER: ReadonlyMap<GlobalCategory, Tier> = new Map([
    ['fs', 'strict'],
    ['network', 'strict'],
    ['process', 'strict'],
    ['dynamic-import', 'strict'],
    ['timer', 'strict'],
    ['path-io', 'strict'],
    ['time', 'advisory'],
    ['random', 'advisory'],
    ['crypto', 'advisory'],
    ['console', 'report'],
])

type CategoryCounts = Partial<Record<GlobalCategory, number>>

export type FileImplicitGlobalsReport = {
    readonly filePath: string
    readonly byCategory: CategoryCounts
    readonly total: number
    /**
     * Count of strict-tier usage sites that occur OUTSIDE any function with
     * an `env` parameter (or at module top-level). High leaky count = Pattern 3
     * not applied; effects are reaching past the env-injection boundary.
     * Currently reported but not gated; the gate scores on strict-tier total
     * regardless of leaky/honest. TODO(leaky-weight): once communities have
     * had a pass at Pattern 3, weight leaky usages 2× in the gated score.
     */
    readonly leakyStrict: number
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
type LeakyAccumulator = {count: number}

function bumpLeakyIfStrict(category: GlobalCategory, node: Node, leaky: LeakyAccumulator): void {
    if (CATEGORY_TIER.get(category) !== 'strict') return
    if (isLeakyUsage(node)) leaky.count += 1
}

function countFreeUsages(
    sourceFile: MorphSourceFile,
    importBindings: ReadonlyMap<string, GlobalCategory>,
    params: ReadonlySet<string>,
    out: CategoryCounts,
    leaky: LeakyAccumulator,
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
            bumpLeakyIfStrict(importCategory, node, leaky)
            return
        }

        // Free global identifier → category lookup.
        const globalCategory = GLOBAL_IDENT_TO_CATEGORY.get(name)
        if (globalCategory) {
            bump(out, globalCategory, 1)
            bumpLeakyIfStrict(globalCategory, node, leaky)
            return
        }

        // Property-chain rules (Date.now, Math.random, performance.now).
        const chainCategory = matchChainRule(node)
        if (chainCategory) {
            bump(out, chainCategory, 1)
            bumpLeakyIfStrict(chainCategory, node, leaky)
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
 * Walk up from a usage site to find the nearest enclosing function. If that
 * function has a parameter named `env` it's an env-using shell — the usage
 * is "honest" (Pattern 3 applied). Otherwise the usage is "leaky": the
 * effect leaked out of any env-injection boundary.
 *
 * No-enclosing-function (module top-level) is treated as leaky too — a
 * top-level `fs.writeFile(...)` runs at import time and there is no env
 * to thread through.
 */
function isLeakyUsage(node: Node): boolean {
    let cur: Node | undefined = node.getParent()
    while (cur) {
        if (
            Node.isFunctionDeclaration(cur)
            || Node.isFunctionExpression(cur)
            || Node.isArrowFunction(cur)
            || Node.isMethodDeclaration(cur)
        ) {
            for (const p of cur.getParameters()) {
                if (p.getNameNode().getText() === 'env') return false
            }
            return true
        }
        cur = cur.getParent()
    }
    return true
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

/**
 * Drop report-tier categories from the count entirely — they're not
 * tracked anywhere, by design.
 */
function stripReportTier(counts: CategoryCounts): CategoryCounts {
    const out: CategoryCounts = {}
    for (const [cat, n] of Object.entries(counts)) {
        if (CATEGORY_TIER.get(cat as GlobalCategory) === 'report') continue
        if ((n ?? 0) > 0) out[cat as GlobalCategory] = n
    }
    return out
}

export function analyzeFile(sourceFile: MorphSourceFile): FileImplicitGlobalsReport {
    const filePath = sourceFile.getFilePath()
    const params = collectParamNames(sourceFile)
    const {nameToCategory, counts, hasFsImport} = collectImportBindings(sourceFile)
    const leaky: LeakyAccumulator = {count: 0}
    countFreeUsages(sourceFile, nameToCategory, params, counts, leaky)
    countNonDeterministicConstructions(sourceFile, counts)
    countDynamicImports(sourceFile, counts)
    const withoutPureIo = maybeStripPathIo(counts, hasFsImport)
    const final = stripReportTier(withoutPureIo)
    const total = Object.values(final).reduce((sum, n) => sum + (n ?? 0), 0)
    return {filePath, byCategory: final, total, leakyStrict: leaky.count}
}

/**
 * Split per-category counts into strict and advisory subtotals. Report
 * tier is already stripped upstream in {@link stripReportTier}, so it
 * does not appear here.
 */
function tierSums(byCategory: CategoryCounts): {strict: number, advisory: number} {
    let strict = 0
    let advisory = 0
    for (const [cat, n] of Object.entries(byCategory)) {
        const count = n ?? 0
        if (count === 0) continue
        const tier = CATEGORY_TIER.get(cat as GlobalCategory)
        if (tier === 'strict') strict += count
        else if (tier === 'advisory') advisory += count
    }
    return {strict, advisory}
}

function classifySeverity(
    strict: number,
    advisory: number,
    baselineStrict: number | null,
): 'pass' | 'warn' | 'fail' {
    if (strict === 0 && advisory === 0) return 'pass'
    if (strict > 0 && (baselineStrict === null || strict > baselineStrict)) return 'fail'
    return 'warn'
}

function formatTierBreakdown(byCategory: CategoryCounts): string {
    const strict: string[] = []
    const advisory: string[] = []
    const entries = Object.entries(byCategory)
        .filter(([, n]) => (n ?? 0) > 0)
        .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    for (const [cat, n] of entries) {
        const fragment = `${cat}=${n}`
        const tier = CATEGORY_TIER.get(cat as GlobalCategory)
        if (tier === 'strict') strict.push(fragment)
        else if (tier === 'advisory') advisory.push(fragment)
    }
    const parts: string[] = []
    if (strict.length > 0) parts.push(`strict[${strict.join(' ')}]`)
    if (advisory.length > 0) parts.push(`advisory[${advisory.join(' ')}]`)
    return parts.length > 0 ? parts.join(' ') : '—'
}

function buildMessage(
    strict: number,
    advisory: number,
    leakyStrict: number,
    baselineStrict: number | null,
    breakdown: CategoryCounts,
): string {
    const baselineFragment = baselineStrict === null
        ? '(no baseline)'
        : `strict baseline=${baselineStrict}`
    const leakyFragment = leakyStrict > 0
        ? ` leaky-shell=${leakyStrict} (strict-tier uses outside any env-taking function — Pattern 3 not applied here)`
        : ''
    return (
        `strict=${strict} advisory=${advisory}${leakyFragment} ${baselineFragment}: ${formatTierBreakdown(breakdown)}. `
        + 'Strict tier is the gated score — thread an `env` argument '
        + '(FP pattern 3: Reader-env) so callers see fs/network/process dependencies. '
        + 'Advisory tier (time/random/crypto) is informational and does not affect the gate.'
        + `\nSee: ${SKILL_DOC}`
    )
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const project = parsedSubgraph.getProject()
    const touched = new Set(parsedSubgraph.touchedCommunities)

    // perCommunity holds the gated score (strict-tier sum). Breakdown
    // is kept separately so messages can show the advisory tier too.
    const perCommunity: Record<string, number> = {}
    const breakdownByCommunity: Record<string, CategoryCounts> = {}
    const leakyByCommunity: Record<string, number> = {}
    for (const community of touched) {
        perCommunity[community] = 0
        breakdownByCommunity[community] = {}
        leakyByCommunity[community] = 0
    }

    for (const file of parsedSubgraph.files) {
        const community = parsedSubgraph.communityMap.get(file.absolutePath)
        if (!community || !touched.has(community)) continue
        const morphFile = project.getSourceFile(file.absolutePath)
        if (!morphFile) continue
        const report = analyzeFile(morphFile)
        const {strict} = tierSums(report.byCategory)
        perCommunity[community] = (perCommunity[community] ?? 0) + strict
        leakyByCommunity[community] = (leakyByCommunity[community] ?? 0) + report.leakyStrict
        const bucket = breakdownByCommunity[community]
        for (const [cat, n] of Object.entries(report.byCategory)) {
            bucket[cat as GlobalCategory] = (bucket[cat as GlobalCategory] ?? 0) + (n ?? 0)
        }
    }

    const baseline = await loadBaseline(MEASURE_ID)
    const violations: Violation[] = []
    for (const community of touched) {
        const breakdown = breakdownByCommunity[community]
        const {strict, advisory} = tierSums(breakdown)
        const leakyStrict = leakyByCommunity[community] ?? 0
        if (strict === 0 && advisory === 0) continue
        const baselineStrict = community in baseline ? baseline[community] : null
        violations.push({
            community,
            score: strict,
            baseline: baselineStrict,
            severity: classifySeverity(strict, advisory, baselineStrict),
            message: buildMessage(strict, advisory, leakyStrict, baselineStrict, breakdown),
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
