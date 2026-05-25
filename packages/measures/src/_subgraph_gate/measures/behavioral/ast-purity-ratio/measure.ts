/**
 * `ast-purity-ratio` — full implementation. The sibling entrypoint
 * (`../ast-purity-ratio.ts`) is a thin barrel that re-exports this module
 * via `export *`; keeping the body in a single file holds the community's
 * boundary-width to the same surface as the pre-decomp single-file form.
 *
 * Public surface is intentionally narrow: `analyzeFile`, `measure`,
 * `MEASURE_ID`. All AST helpers, classification rules, severity logic, and
 * impurity-indicator tables are module-local — they exist for one caller
 * (this file) and must not leak into the community's boundary count.
 */
import {Node, SyntaxKind, type SourceFile as MorphSourceFile} from 'ts-morph'
import {loadBaseline} from '../../../_internal/baseline-store.ts'
import {registerMeasure} from '../../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'ast-purity-ratio'

// ──────────────────────────────────────────────────────────────────────
// Types — all module-local. None are re-exported because no external
// caller imports them today; if a consumer ever needs them, re-export
// explicitly through the entrypoint barrel.
// ──────────────────────────────────────────────────────────────────────

type FunctionPurityClass = 'pure' | 'impure'

type FunctionPurityRecord = {
    readonly name: string
    readonly file: string
    readonly line: number
    readonly classification: FunctionPurityClass
    readonly impurityReasons: readonly string[]
}

type FileFunctionReport = {
    readonly filePath: string
    readonly functions: readonly FunctionPurityRecord[]
    readonly pureCount: number
    readonly impureCount: number
}

type RuleCtx = {
    readonly paramNames: ReadonlySet<string>
    readonly impureLocalNames: ReadonlySet<string>
}

type Rule = (node: Node, ctx: RuleCtx) => string | null

type FunctionLikeRecord = {
    readonly node: Node
    readonly name: string
}

// ──────────────────────────────────────────────────────────────────────
// Impurity indicators. Kept in lockstep with implicit-globals.ts but
// intentionally NOT shared — the two measures emit different signals
// (count of references vs. yes/no per function), and sharing would
// silently couple their futures.
// ──────────────────────────────────────────────────────────────────────

const IMPURE_ROOT_IDENTIFIERS: ReadonlySet<string> = new Set([
    'console', 'process', 'fetch',
    'setTimeout', 'setInterval', 'setImmediate',
    'clearTimeout', 'clearInterval', 'clearImmediate',
])

const IMPURE_CHAINS: ReadonlyArray<{root: string; method: string}> = [
    {root: 'Date', method: 'now'},
    {root: 'Math', method: 'random'},
    {root: 'performance', method: 'now'},
    {root: 'crypto', method: 'randomUUID'},
    {root: 'crypto', method: 'randomBytes'},
    {root: 'crypto', method: 'getRandomValues'},
]

const IMPURE_MODULE_SPECIFIERS: ReadonlySet<string> = new Set([
    'fs', 'node:fs',
    'fs/promises', 'node:fs/promises',
    'crypto', 'node:crypto',
    'http', 'node:http',
    'https', 'node:https',
    'net', 'node:net',
    'dgram', 'node:dgram',
])

const MUTATING_METHOD_NAMES: ReadonlySet<string> = new Set([
    'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse',
    'fill', 'copyWithin',
    'set', 'add', 'delete', 'clear',
    'assign',
])

// ──────────────────────────────────────────────────────────────────────
// AST navigation helpers.
// ──────────────────────────────────────────────────────────────────────

function getRootIdentifier(node: Node): Node | null {
    let cur: Node = node
    while (true) {
        if (Node.isPropertyAccessExpression(cur)) {
            cur = cur.getExpression()
        } else if (Node.isElementAccessExpression(cur)) {
            cur = cur.getExpression()
        } else if (Node.isCallExpression(cur)) {
            cur = cur.getExpression()
        } else if (Node.isNonNullExpression(cur)) {
            cur = cur.getExpression()
        } else if (Node.isAsExpression(cur)) {
            cur = cur.getExpression()
        } else if (Node.isParenthesizedExpression(cur)) {
            cur = cur.getExpression()
        } else {
            return Node.isIdentifier(cur) ? cur : null
        }
    }
}

function collectFunctionParamNames(fn: Node): ReadonlySet<string> {
    const params = new Set<string>()
    if (
        !Node.isFunctionDeclaration(fn)
        && !Node.isFunctionExpression(fn)
        && !Node.isArrowFunction(fn)
        && !Node.isMethodDeclaration(fn)
        && !Node.isConstructorDeclaration(fn)
        && !Node.isGetAccessorDeclaration(fn)
        && !Node.isSetAccessorDeclaration(fn)
    ) return params
    for (const param of fn.getParameters()) {
        const nameNode = param.getNameNode()
        if (Node.isIdentifier(nameNode)) {
            params.add(nameNode.getText())
            continue
        }
        nameNode.forEachDescendant(d => {
            if (
                Node.isIdentifier(d)
                && d.getParent()?.getKind() === SyntaxKind.BindingElement
            ) params.add(d.getText())
        })
    }
    return params
}

function bodyOf(fn: Node): Node | null {
    if (
        Node.isFunctionDeclaration(fn)
        || Node.isFunctionExpression(fn)
        || Node.isMethodDeclaration(fn)
        || Node.isConstructorDeclaration(fn)
        || Node.isGetAccessorDeclaration(fn)
        || Node.isSetAccessorDeclaration(fn)
    ) return fn.getBody() ?? null
    if (Node.isArrowFunction(fn)) return fn.getBody()
    return null
}

function isParamMemberAccess(target: Node, paramNames: ReadonlySet<string>): boolean {
    if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) return false
    const root = getRootIdentifier(target)
    return root !== null && paramNames.has(root.getText())
}

// ──────────────────────────────────────────────────────────────────────
// Classification rules — each returns a reason string or null.
// ──────────────────────────────────────────────────────────────────────

const COMPOUND_ASSIGN_TOKENS: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.PlusEqualsToken,
    SyntaxKind.MinusEqualsToken,
    SyntaxKind.AsteriskEqualsToken,
    SyntaxKind.SlashEqualsToken,
    SyntaxKind.PercentEqualsToken,
    SyntaxKind.AmpersandEqualsToken,
    SyntaxKind.BarEqualsToken,
    SyntaxKind.CaretEqualsToken,
])

const DECLARATION_PARENT_KINDS_FOR_IDENTIFIER: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.PropertyAccessExpression,
    SyntaxKind.PropertyAssignment,
    SyntaxKind.VariableDeclaration,
    SyntaxKind.Parameter,
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.BindingElement,
])

function isDeclarationOrPropertyKey(identifier: Node): boolean {
    const parent = identifier.getParent()
    if (!parent) return false
    if (!DECLARATION_PARENT_KINDS_FOR_IDENTIFIER.has(parent.getKind())) return false
    const nameNode = (parent as unknown as {getNameNode?: () => Node | undefined}).getNameNode?.()
    return nameNode === identifier
}

function checkImpureIdentifier(node: Node, ctx: RuleCtx): string | null {
    if (!Node.isIdentifier(node)) return null
    if (isDeclarationOrPropertyKey(node)) return null
    const name = node.getText()
    if (ctx.paramNames.has(name)) return null
    if (IMPURE_ROOT_IDENTIFIERS.has(name)) return `uses-global:${name}`
    if (ctx.impureLocalNames.has(name)) return `uses-impure-import:${name}`
    return null
}

function checkImpureChain(node: Node, ctx: RuleCtx): string | null {
    if (!Node.isPropertyAccessExpression(node)) return null
    const root = node.getExpression()
    if (!Node.isIdentifier(root)) return null
    const rootName = root.getText()
    if (ctx.paramNames.has(rootName)) return null
    const member = node.getNameNode().getText()
    const hit = IMPURE_CHAINS.find(r => r.root === rootName && r.method === member)
    return hit ? `uses-chain:${rootName}.${member}` : null
}

function checkNewDateZeroArgs(node: Node): string | null {
    if (!Node.isNewExpression(node)) return null
    const expr = node.getExpression()
    if (!Node.isIdentifier(expr) || expr.getText() !== 'Date') return null
    return node.getArguments().length === 0 ? 'uses-chain:new Date()' : null
}

function checkDynamicImport(node: Node): string | null {
    if (node.getKind() !== SyntaxKind.ImportKeyword) return null
    const parent = node.getParent()
    if (!parent || !Node.isCallExpression(parent)) return null
    return parent.getExpression() === node ? 'uses-dynamic-import' : null
}

function checkParamAssignment(node: Node, ctx: RuleCtx): string | null {
    if (!Node.isBinaryExpression(node)) return null
    const op = node.getOperatorToken().getKind()
    if (op === SyntaxKind.EqualsToken) {
        return isParamMemberAccess(node.getLeft(), ctx.paramNames) ? 'mutates-param:assignment' : null
    }
    if (COMPOUND_ASSIGN_TOKENS.has(op)) {
        return isParamMemberAccess(node.getLeft(), ctx.paramNames) ? 'mutates-param:compound-assignment' : null
    }
    return null
}

function checkMutatingMethodCall(node: Node, ctx: RuleCtx): string | null {
    if (!Node.isCallExpression(node)) return null
    const callee = node.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) return null
    const method = callee.getNameNode().getText()
    if (!MUTATING_METHOD_NAMES.has(method)) return null
    const root = getRootIdentifier(callee.getExpression())
    return root && ctx.paramNames.has(root.getText()) ? `mutates-param:method-${method}` : null
}

function checkParamDelete(node: Node, ctx: RuleCtx): string | null {
    if (!Node.isDeleteExpression(node)) return null
    const root = getRootIdentifier(node.getExpression())
    return root && ctx.paramNames.has(root.getText()) ? 'mutates-param:delete' : null
}

function checkParamIncrement(node: Node, ctx: RuleCtx): string | null {
    if (!Node.isPrefixUnaryExpression(node) && !Node.isPostfixUnaryExpression(node)) return null
    const op = node.getOperatorToken()
    if (op !== SyntaxKind.PlusPlusToken && op !== SyntaxKind.MinusMinusToken) return null
    return isParamMemberAccess(node.getOperand(), ctx.paramNames) ? 'mutates-param:increment' : null
}

function checkThrow(node: Node): string | null {
    return Node.isThrowStatement(node) ? 'throws' : null
}

const RULES: readonly Rule[] = [
    (n, c) => checkImpureIdentifier(n, c),
    (n, c) => checkImpureChain(n, c),
    n => checkNewDateZeroArgs(n),
    n => checkDynamicImport(n),
    (n, c) => checkParamAssignment(n, c),
    (n, c) => checkMutatingMethodCall(n, c),
    (n, c) => checkParamDelete(n, c),
    (n, c) => checkParamIncrement(n, c),
    n => checkThrow(n),
]

function classifyFunction(
    fn: Node,
    impureLocalNames: ReadonlySet<string>,
): {classification: FunctionPurityClass; reasons: readonly string[]} {
    const body = bodyOf(fn)
    if (!body) return {classification: 'pure', reasons: []}
    const ctx: RuleCtx = {paramNames: collectFunctionParamNames(fn), impureLocalNames}
    const reasons = new Set<string>()
    body.forEachDescendant(node => {
        for (const rule of RULES) {
            const reason = rule(node, ctx)
            if (reason !== null) reasons.add(reason)
        }
    })
    return {
        classification: reasons.size === 0 ? 'pure' : 'impure',
        reasons: [...reasons].sort(),
    }
}

// ──────────────────────────────────────────────────────────────────────
// Function enumeration.
// ──────────────────────────────────────────────────────────────────────

function collectFunctions(sourceFile: MorphSourceFile): readonly FunctionLikeRecord[] {
    const out: FunctionLikeRecord[] = []
    sourceFile.forEachDescendant(node => {
        if (Node.isFunctionDeclaration(node)) {
            out.push({node, name: node.getName() ?? `<anon@${node.getStartLineNumber()}>`})
        } else if (Node.isMethodDeclaration(node)) {
            out.push({node, name: node.getName()})
        } else if (Node.isConstructorDeclaration(node)) {
            out.push({node, name: 'constructor'})
        } else if (Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
            const prefix = Node.isGetAccessorDeclaration(node) ? 'get' : 'set'
            out.push({node, name: `${prefix} ${node.getName()}`})
        } else if (Node.isVariableDeclaration(node)) {
            const init = node.getInitializer()
            if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                const nameNode = node.getNameNode()
                const name = Node.isIdentifier(nameNode)
                    ? nameNode.getText()
                    : `<destructured@${node.getStartLineNumber()}>`
                out.push({node: init, name})
            }
        } else if (Node.isPropertyAssignment(node)) {
            const init = node.getInitializer()
            if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                out.push({node: init, name: node.getName()})
            }
        }
    })
    return out
}

// ──────────────────────────────────────────────────────────────────────
// Per-file analyzer (public).
// ──────────────────────────────────────────────────────────────────────

function collectImpureLocalNames(sourceFile: MorphSourceFile): ReadonlySet<string> {
    const names = new Set<string>()
    for (const importDecl of sourceFile.getImportDeclarations()) {
        if (importDecl.isTypeOnly()) continue
        if (!IMPURE_MODULE_SPECIFIERS.has(importDecl.getModuleSpecifierValue())) continue
        const def = importDecl.getDefaultImport()
        if (def) names.add(def.getText())
        for (const named of importDecl.getNamedImports()) {
            if (named.isTypeOnly()) continue
            names.add(named.getAliasNode()?.getText() ?? named.getName())
        }
        const ns = importDecl.getNamespaceImport()
        if (ns) names.add(ns.getText())
    }
    return names
}

export function analyzeFile(sourceFile: MorphSourceFile): FileFunctionReport {
    const filePath = sourceFile.getFilePath()
    const impureLocalNames = collectImpureLocalNames(sourceFile)
    const functions: FunctionPurityRecord[] = []
    let pureCount = 0
    let impureCount = 0
    for (const {node, name} of collectFunctions(sourceFile)) {
        const {classification, reasons} = classifyFunction(node, impureLocalNames)
        functions.push({
            name,
            file: filePath,
            line: node.getStartLineNumber(),
            classification,
            impurityReasons: reasons,
        })
        if (classification === 'pure') pureCount++
        else impureCount++
    }
    return {filePath, functions, pureCount, impureCount}
}

// ──────────────────────────────────────────────────────────────────────
// Severity classification / message.
// ──────────────────────────────────────────────────────────────────────

const NO_BASELINE_WARN_RATIO = 0.5
const NO_BASELINE_FAIL_RATIO = 0.8

function classifySeverity(ratio: number, baseline: number | null): 'pass' | 'warn' | 'fail' {
    if (baseline === null) {
        if (ratio <= NO_BASELINE_WARN_RATIO) return 'pass'
        if (ratio <= NO_BASELINE_FAIL_RATIO) return 'warn'
        return 'fail'
    }
    if (ratio <= baseline + 1e-9) return 'pass'
    if (ratio <= NO_BASELINE_FAIL_RATIO) return 'warn'
    return 'fail'
}

function buildMessage(ratio: number, impure: number, total: number, baseline: number | null): string {
    const baselineFragment = baseline === null
        ? '(no baseline — using default 0.5 warn / 0.8 fail)'
        : `baseline=${baseline.toFixed(2)}`
    return (
        `impure/total = ${impure}/${total} = ${ratio.toFixed(2)} ${baselineFragment}. `
        + 'Each impure function declares its side effects in its signature — '
        + 'split into a pure inner (transform) and an impure outer (env-touching) layer '
        + '(FP pattern 1: core/shell).'
    )
}

// ──────────────────────────────────────────────────────────────────────
// Measure run (community aggregation).
// ──────────────────────────────────────────────────────────────────────

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const project = parsedSubgraph.getProject()
    const touched = new Set(parsedSubgraph.touchedCommunities)

    const totals = new Map<string, {pure: number; impure: number}>()
    for (const community of touched) totals.set(community, {pure: 0, impure: 0})

    for (const file of parsedSubgraph.files) {
        const community = parsedSubgraph.communityMap.get(file.absolutePath)
        if (!community || !touched.has(community)) continue
        const morphFile = project.getSourceFile(file.absolutePath)
        if (!morphFile) continue
        const report = analyzeFile(morphFile)
        const acc = totals.get(community)!
        acc.pure += report.pureCount
        acc.impure += report.impureCount
    }

    const perCommunity: Record<string, number> = {}
    for (const [community, {pure, impure}] of totals) {
        const total = pure + impure
        perCommunity[community] = total === 0 ? 0 : impure / total
    }

    const baseline = await loadBaseline(MEASURE_ID)
    const violations: Violation[] = []
    for (const community of touched) {
        const {pure, impure} = totals.get(community)!
        const total = pure + impure
        if (total === 0) continue
        const ratio = impure / total
        const baselineScore = community in baseline ? baseline[community] : null
        const severity = classifySeverity(ratio, baselineScore)
        if (severity === 'pass') continue
        violations.push({
            community,
            score: ratio,
            baseline: baselineScore,
            severity,
            message: buildMessage(ratio, impure, total, baselineScore),
        })
    }

    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const measure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'behavioral',
    scope: 'file',
    needsTsMorph: true,
    needsInbound: false,
    run,
}

registerMeasure(measure)
