/**
 * `ast-purity-ratio` — per-file function-purity classification, aggregated
 * to a per-community impurity *ratio* (impure / total).
 *
 * The file-local form of the visibility check. Even when every implicit
 * global has been threaded through an `env` parameter (`implicit-globals`
 * has reached 0), individual functions can still:
 *   - mutate one of their own parameters (`arg.push(x)`, `arg.x = ...`)
 *   - throw synchronously (`throw new Error(...)`)
 *   - await an impure receiver (`await env.fs.read(...)` — still impure
 *     even though the impurity is now properly declared via `env`)
 *
 * Those are detectable from the function's own AST without a call graph.
 * Transitive purity (function calls another impure function) is left to
 * the full-graph pre-push pass; that needs the call graph this gate does
 * not build.
 *
 * Classification (per function):
 *   IMPURE if body contains ANY of:
 *     1. a reference to one of the {@link implicit-globals} categories
 *        (see CATEGORY_INDICATORS below — kept in lockstep)
 *     2. parameter mutation: `param.foo = x`, `param.push(x)`, `param[i] = x`,
 *        unary `delete param.x`, prefix/postfix `++param.foo`
 *     3. synchronous throw: `throw <expr>`
 *     4. await of a call whose receiver root is a known impure global
 *        (`await fs.readFile(...)`, `await fetch(...)`)
 *
 *   PURE otherwise.
 *
 * Functions counted: top-level function declarations, arrow / function
 * expressions assigned to variables, and class method declarations.
 * Type-only declarations and IIFE side-effects are NOT counted here —
 * they're not "functions" the orange-priority measure would weigh.
 *
 * Threshold: `impure / total` ratio per community. If a baseline exists,
 * a community is `pass` when within +0.0 of baseline, `warn` when over
 * baseline but ≤ 0.8 absolute, `fail` when > 0.8 absolute (overwhelmingly
 * impure community = full FCIS rework needed). If no baseline:
 *   - 0.0 ≤ r ≤ 0.5  → pass (default tolerance, openable to tightening)
 *   - 0.5 < r ≤ 0.8  → warn
 *   - 0.8 < r        → fail
 *
 * The default-no-baseline thresholds match the brief; tune by tightening
 * the upper bound once the codebase has been swept once.
 */
import {Node, SyntaxKind, type SourceFile as MorphSourceFile} from 'ts-morph'
import {loadBaseline} from '../../../_shared/measures/baseline-store.ts'
import {registerMeasure} from '../../../_shared/measures/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../../_shared/measures/subgraph-measure.ts'

export const MEASURE_ID = 'ast-purity-ratio'

// --- Impurity indicators (kept in lockstep with implicit-globals.ts) ---
//
// We don't re-import the implicit-globals tables because:
//   1. They are flat-named (e.g. 'console') — fine for a flat lookup but
//      this measure needs to know about both root identifiers AND chain
//      receivers (`Date.now`, `Math.random`).
//   2. The signal is different: implicit-globals counts *references*;
//      ast-purity-ratio just needs a yes/no per function. Sharing would
//      couple two measures' semantics and make any future divergence
//      (e.g. relaxing one without the other) silently break.
// The duplication is intentional and small.

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
    'assign', // Object.assign(target, ...) — but we only flag when called as method on a param
])

// --- Result types ---

export type FunctionPurityClass = 'pure' | 'impure'

export type FunctionPurityRecord = {
    readonly name: string
    readonly file: string
    readonly line: number
    readonly classification: FunctionPurityClass
    readonly impurityReasons: readonly string[]
}

export type FileFunctionReport = {
    readonly filePath: string
    readonly functions: readonly FunctionPurityRecord[]
    readonly pureCount: number
    readonly impureCount: number
}

// --- File analysis ---

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

/**
 * Collect parameter names in scope at the function level (including
 * destructuring). Used by the mutation check — only mutations whose
 * receiver root resolves to one of these counts as "parameter mutation".
 */
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
        // Destructuring: walk children, collect each leaf binding name.
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

// --- Per-node-kind rules: each returns the reason string(s) added by this
// node, or null when it doesn't trigger. Keeping each rule as a small pure
// function gives the dispatcher a flat structure that ast-purity-ratio can
// itself confirm is pure.

type RuleCtx = {
    readonly paramNames: ReadonlySet<string>
    readonly impureLocalNames: ReadonlySet<string>
}

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
    // For each candidate parent the identifier is "decorative" when it is
    // the parent's nameNode; we treat any matching parent kind as such.
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

function isParamMemberAccess(target: Node, paramNames: ReadonlySet<string>): boolean {
    if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) return false
    const root = getRootIdentifier(target)
    return root !== null && paramNames.has(root.getText())
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

type Rule = (node: Node, ctx: RuleCtx) => string | null

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

/**
 * Pure function: AST classification only. Returns the reasons list so the
 * gate can explain why something failed; empty reasons → pure.
 */
function classifyFunction(
    fn: Node,
    impureLocalNames: ReadonlySet<string>,
): {classification: FunctionPurityClass; reasons: readonly string[]} {
    const body = bodyOf(fn)
    if (!body) {
        // Overload signatures, abstract methods, ambient declarations.
        // No body → no observable behavior → call it pure.
        return {classification: 'pure', reasons: []}
    }
    const ctx: RuleCtx = {
        paramNames: collectFunctionParamNames(fn),
        impureLocalNames,
    }
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

/**
 * Enumerate every function-like declaration in the source file:
 *   - function declarations (`function f() {}`)
 *   - function/arrow expressions in variable declarations (`const f = () => …`)
 *   - method declarations on classes / object literals
 *   - constructor / get / set accessors
 *
 * Returned in source order. Anonymous expressions get a stable
 * positional name (`<anon@<line>>`) for reporting.
 */
function collectFunctions(sourceFile: MorphSourceFile): readonly {node: Node; name: string}[] {
    const out: {node: Node; name: string}[] = []
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
            // Object-literal methods declared as `{ foo: () => … }` or `{ foo: function …}`.
            const init = node.getInitializer()
            if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                out.push({node: init, name: node.getName()})
            }
        }
    })
    return out
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

// --- Aggregation + severity ---

const NO_BASELINE_WARN_RATIO = 0.5
const NO_BASELINE_FAIL_RATIO = 0.8

function classifySeverity(
    ratio: number,
    baseline: number | null,
): 'pass' | 'warn' | 'fail' {
    if (baseline === null) {
        if (ratio <= NO_BASELINE_WARN_RATIO) return 'pass'
        if (ratio <= NO_BASELINE_FAIL_RATIO) return 'warn'
        return 'fail'
    }
    // Baseline-aware: tolerance of +0.0 — any regression = warn at minimum,
    // fail if it also crosses the absolute 0.8 fail line.
    if (ratio <= baseline + 1e-9) return 'pass'
    if (ratio <= NO_BASELINE_FAIL_RATIO) return 'warn'
    return 'fail'
}

function buildMessage(
    ratio: number,
    impure: number,
    total: number,
    baseline: number | null,
): string {
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
