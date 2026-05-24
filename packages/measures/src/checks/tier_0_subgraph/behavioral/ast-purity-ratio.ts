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
    const reasons = new Set<string>()
    const paramNames = collectFunctionParamNames(fn)

    body.forEachDescendant(node => {
        // 1. Reference to impure global / impure-imported name.
        if (Node.isIdentifier(node)) {
            const name = node.getText()
            // Skip the identifier portion of declarations/property keys.
            const parent = node.getParent()
            if (parent && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) return
            if (parent && Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return
            if (parent && Node.isVariableDeclaration(parent) && parent.getNameNode() === node) return
            if (parent && Node.isParameterDeclaration(parent) && parent.getNameNode() === node) return
            if (parent && Node.isFunctionDeclaration(parent) && parent.getNameNode() === node) return
            if (parent && Node.isBindingElement(parent) && parent.getNameNode() === node) return

            // Parameter shadow — using a parameter named `fs`, not the global.
            if (paramNames.has(name)) return

            if (IMPURE_ROOT_IDENTIFIERS.has(name)) reasons.add(`uses-global:${name}`)
            else if (impureLocalNames.has(name)) reasons.add(`uses-impure-import:${name}`)
        }

        // 1b. Chain rules — Date.now, Math.random etc.
        if (Node.isPropertyAccessExpression(node)) {
            const root = node.getExpression()
            const member = node.getNameNode().getText()
            if (Node.isIdentifier(root)) {
                const rootName = root.getText()
                if (paramNames.has(rootName)) return
                for (const rule of IMPURE_CHAINS) {
                    if (rule.root === rootName && rule.method === member) {
                        reasons.add(`uses-chain:${rootName}.${member}`)
                    }
                }
            }
        }

        // 1c. `new Date()` (zero args) — non-deterministic.
        if (Node.isNewExpression(node)) {
            const expr = node.getExpression()
            if (Node.isIdentifier(expr) && expr.getText() === 'Date') {
                const args = node.getArguments()
                if (args.length === 0) reasons.add('uses-chain:new Date()')
            }
        }

        // 1d. Dynamic import in body.
        if (node.getKind() === SyntaxKind.ImportKeyword) {
            const parent = node.getParent()
            if (parent && Node.isCallExpression(parent) && parent.getExpression() === node) {
                reasons.add('uses-dynamic-import')
            }
        }

        // 2. Parameter mutation: assignment to param.x or param[i].
        if (Node.isBinaryExpression(node)) {
            if (node.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
                const lhs = node.getLeft()
                if (Node.isPropertyAccessExpression(lhs) || Node.isElementAccessExpression(lhs)) {
                    const root = getRootIdentifier(lhs)
                    if (root && paramNames.has(root.getText())) {
                        reasons.add('mutates-param:assignment')
                    }
                }
            }
            // Compound assignments (+=, *= …) on param.x — same family.
            const op = node.getOperatorToken().getKind()
            const isCompound = op === SyntaxKind.PlusEqualsToken
                || op === SyntaxKind.MinusEqualsToken
                || op === SyntaxKind.AsteriskEqualsToken
                || op === SyntaxKind.SlashEqualsToken
                || op === SyntaxKind.PercentEqualsToken
                || op === SyntaxKind.AmpersandEqualsToken
                || op === SyntaxKind.BarEqualsToken
                || op === SyntaxKind.CaretEqualsToken
            if (isCompound) {
                const lhs = node.getLeft()
                if (Node.isPropertyAccessExpression(lhs) || Node.isElementAccessExpression(lhs)) {
                    const root = getRootIdentifier(lhs)
                    if (root && paramNames.has(root.getText())) {
                        reasons.add('mutates-param:compound-assignment')
                    }
                }
            }
        }

        // 2b. Mutating method calls on a parameter: param.push(x), param.sort()
        if (Node.isCallExpression(node)) {
            const callee = node.getExpression()
            if (Node.isPropertyAccessExpression(callee)) {
                const method = callee.getNameNode().getText()
                if (MUTATING_METHOD_NAMES.has(method)) {
                    const receiver = callee.getExpression()
                    const root = getRootIdentifier(receiver)
                    if (root && paramNames.has(root.getText())) {
                        reasons.add(`mutates-param:method-${method}`)
                    }
                }
            }
        }

        // 2c. `delete param.x` and `++param.x` / `--param.x`
        if (Node.isDeleteExpression(node)) {
            const target = node.getExpression()
            const root = getRootIdentifier(target)
            if (root && paramNames.has(root.getText())) {
                reasons.add('mutates-param:delete')
            }
        }
        if (Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)) {
            const op = node.getOperatorToken()
            if (op === SyntaxKind.PlusPlusToken || op === SyntaxKind.MinusMinusToken) {
                const operand = node.getOperand()
                if (Node.isPropertyAccessExpression(operand) || Node.isElementAccessExpression(operand)) {
                    const root = getRootIdentifier(operand)
                    if (root && paramNames.has(root.getText())) {
                        reasons.add('mutates-param:increment')
                    }
                }
            }
        }

        // 3. Synchronous throw.
        if (Node.isThrowStatement(node)) {
            reasons.add('throws')
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
