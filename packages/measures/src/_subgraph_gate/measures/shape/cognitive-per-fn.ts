/**
 * Shape measure: per-function cognitive complexity (Sonarsource variant).
 *
 * What it measures
 * ----------------
 * Cognitive complexity differs from McCabe cyclomatic in two ways:
 *
 *   1. Nested control structures cost more than flat ones. Each level of
 *      nesting adds `+ nesting` on top of the base `+ 1` for any
 *      "structural" break (if, for, while, do, switch, catch, ternary).
 *
 *   2. `else` / `else if` add +1 each (the alternative, not the alternative-
 *      structure), with NO additional nesting penalty for `else if` (it's
 *      an alternative to the original `if`, not a new branch in cognitive
 *      terms).
 *
 *   3. Logical operator chains count by mixed-operator count
 *      (`a && b && c` → +1; `a && b || c` → +2; `a && (b || c)` → +1 + +1).
 *
 * Per-community score is the **max** across all functions in the
 * community — the worst offender drives the gate signal.
 *
 * Rules implemented (subset of canonical Sonar spec)
 * --------------------------------------------------
 * Implemented:
 *   - B1 Increment for each break in linear flow: if, switch (per case),
 *        for, foreach, while, do, catch, conditional (ternary).
 *   - B2 No increment for `else` keyword alone, but +1 for the `else`
 *        branch presence; +1 for `else if` (no nesting bump).
 *   - B3 Logical operator chains (mixed-operator counting).
 *   - B4 Recursion: +1 for each direct recursive call (by-name match).
 *   - B5 Labelled break/continue: +1 each.
 *   - C1 Nesting penalty: structures inside if/for/while/switch/catch
 *        accumulate one extra increment per containing-structure level.
 *
 * NOT implemented (Sonar spec corner cases we deliberately skipped):
 *   - Sequence of mixed logical ops within a single boolean cluster is
 *     simplified: we count operator-changes, which matches Sonar for the
 *     common case but slightly under-counts on `a && b || c && d` shapes.
 *   - Methods themselves don't get a nesting bump from being declared
 *     inside a class — class is structural-only.
 *   - Macro / template literal expansions are not penalised (we don't
 *     expand them).
 *
 * The implemented subset is the one the canonical Sonar test corpus
 * exercises for TS, so cog scores match the reference implementation on
 * every fixture in `cognitive-per-fn.test.ts`.
 */
// See `_ast-helpers.ts` — must match ts-morph's TS version (compilerNode
// returns nodes from that TS instance, and SyntaxKind constants differ).
import {ts} from 'ts-morph'
import {communityForFile} from '../../../_shared/community/community-at-depth.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    Severity,
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'
import {isFunctionLikeBoundary, walkFunctions, type FunctionDetail} from './_ast-helpers.ts'

export const COGNITIVE_WARN_SOFT = 8
export const COGNITIVE_FAIL = 30

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

function countLogicalOperatorChains(expression: ts.BinaryExpression): number {
    const operators: ts.SyntaxKind[] = []
    function collect(node: ts.Expression): void {
        if (!isLogicalExpression(node)) return
        collect(node.left)
        operators.push(node.operatorToken.kind)
        collect(node.right)
    }
    collect(expression)
    if (operators.length === 0) return 0
    let chains = 1
    for (let i = 1; i < operators.length; i += 1) {
        if (operators[i] !== operators[i - 1]) chains += 1
    }
    return chains
}

function isDirectRecursiveCall(node: ts.CallExpression, name: string): boolean {
    if (name === '<anonymous>' || name === 'constructor') return false
    // Bare identifier: matches `foo()` inside `function foo() {...}`.
    if (ts.isIdentifier(node.expression)) return node.expression.text === name
    // Property access: only counts as recursion when the receiver is `this`
    // (e.g. `this.process()` inside a method named `process`). Counting
    // every `<anything>.<sameName>()` was a false-positive trap — e.g.
    // `xs.find(p)` inside a function called `find` is NOT recursion.
    if (ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        return node.expression.name.text === name
    }
    return false
}

/**
 * Pure: `(FunctionLikeDeclaration, fnName, sourceFile) → cognitive score`.
 *
 * Stops at nested-function boundaries so each function's score is its own
 * body. The recursion bonus uses the enclosing function's `name` — calls
 * to other functions don't count, only self-calls.
 */
export function scoreCognitive(
    root: ts.FunctionLikeDeclaration,
    name: string,
): number {
    let score = 0

    function addStructural(nesting: number): void {
        score += 1 + nesting
    }

    function visitIfStatement(node: ts.IfStatement, nesting: number, isElseIf: boolean): void {
        if (isElseIf) score += 1
        else addStructural(nesting)

        visit(node.expression, nesting)
        visit(node.thenStatement, nesting + 1)

        if (!node.elseStatement) return
        if (ts.isIfStatement(node.elseStatement)) {
            visitIfStatement(node.elseStatement, nesting, true)
            return
        }

        score += 1
        visit(node.elseStatement, nesting + 1)
    }

    function visit(node: ts.Node, nesting: number): void {
        if (node !== root && isFunctionLikeBoundary(node)) return

        if (ts.isIfStatement(node)) {
            visitIfStatement(node, nesting, false)
            return
        }

        if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
            || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
            addStructural(nesting)
            ts.forEachChild(node, child => visit(child, nesting + 1))
            return
        }

        if (ts.isSwitchStatement(node)) {
            // Sonar: switch itself is +1+nesting; case labels do not stack additional increments.
            addStructural(nesting)
            for (const clause of node.caseBlock.clauses) {
                ts.forEachChild(clause, child => visit(child, nesting + 1))
            }
            return
        }

        if (ts.isCatchClause(node)) {
            addStructural(nesting)
            visit(node.block, nesting + 1)
            return
        }

        if (ts.isConditionalExpression(node)) {
            addStructural(nesting)
            ts.forEachChild(node, child => visit(child, nesting + 1))
            return
        }

        if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) {
            score += 1
        }

        if (ts.isCallExpression(node) && isDirectRecursiveCall(node, name)) {
            score += 1
        }

        if (isLogicalExpression(node) && !isLogicalExpression(node.parent)) {
            score += countLogicalOperatorChains(node)
        }

        ts.forEachChild(node, child => visit(child, nesting))
    }

    visit(root, 0)
    return score
}

function severityFor(score: number): Severity {
    if (score > COGNITIVE_FAIL) return 'fail'
    if (score > COGNITIVE_WARN_SOFT) return 'warn'
    return 'pass'
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const touched = new Set(parsedSubgraph.touchedCommunities)

    const project = parsedSubgraph.getProject()
    const detailsByCommunity = new Map<string, Array<FunctionDetail & {readonly file: string}>>()
    for (const community of touched) detailsByCommunity.set(community, [])

    for (const file of parsedSubgraph.files) {
        const community = communityForFile(file, parsedSubgraph.depth)
        if (!touched.has(community)) continue
        const tsSourceFile = project.getSourceFile(file.absolutePath)?.compilerNode
        if (!tsSourceFile) continue
        const fns = walkFunctions(tsSourceFile, (root, name) => scoreCognitive(root, name))
            .map(fn => ({...fn, file: file.relativePath}))
        detailsByCommunity.get(community)!.push(...fns)
    }

    const perCommunity: Record<string, number> = {}
    const violations: Violation[] = []
    for (const [community, fns] of detailsByCommunity) {
        if (fns.length === 0) { perCommunity[community] = 0; continue }
        const sorted = [...fns].sort((a, b) => b.score - a.score)
        const worst = sorted[0]
        perCommunity[community] = worst.score
        const sev = severityFor(worst.score)
        if (sev === 'pass') continue
        violations.push({
            community,
            score: worst.score,
            baseline: null,
            severity: sev,
            message: `cognitive complexity ${worst.score} in ${worst.file}:${worst.line} ${worst.name}() exceeds ${sev === 'fail' ? COGNITIVE_FAIL : COGNITIVE_WARN_SOFT}`,
        })
    }

    return {
        measureId: 'cognitive-per-fn',
        perCommunity,
        violations,
    }
}

export const cognitivePerFnMeasure: SubgraphMeasure = {
    id: 'cognitive-per-fn',
    axis: 'shape',
    scope: 'file',
    needsTsMorph: true,
    needsInbound: false,
    run,
}

registerMeasure(cognitivePerFnMeasure)
