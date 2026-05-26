/**
 * Shape measure: per-function McCabe cyclomatic complexity.
 *
 * What it measures
 * ----------------
 * For every function-like declaration in every file inside a touched
 * community, compute classic McCabe cyclomatic complexity:
 *
 *   base = 1
 *   +1 per: if, else-if, case, for, for-in, for-of, while, do, catch,
 *           ?: (conditional), &&, ||, ??
 *
 * (`else` on its own adds 0 — it's the alternative branch of an `if`
 * we already counted. `else-if` is parsed as `if (...) ... else <IfStmt>`
 * so the nested IfStatement adds 1 naturally.)
 *
 * Per-community score is the **max** across all functions in the
 * community — the worst offender is the one that bites a reader.
 *
 * Severity
 * --------
 * Shape measures are advisory. Thresholds:
 *   - score > 10  → warn  (Pattern 4 / ADT-replaces-switch territory)
 *   - score > 15  → warn  (hard threshold, still warn — gate is advisory)
 *   - score > 30  → fail  (clearly a bug / refactor blocker)
 *
 * Even at the fail threshold, the runner only blocks when severity='fail',
 * so cc=12 lands a warn that the agent sees but doesn't have to fix
 * to land the commit.
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

export const CYCLOMATIC_WARN_SOFT = 10
export const CYCLOMATIC_FAIL = 30

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

function cyclomaticIncrement(node: ts.Node): number {
    if (ts.isIfStatement(node)) return 1
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) return 1
    if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return 1
    if (ts.isCatchClause(node)) return 1
    if (ts.isConditionalExpression(node)) return 1
    if (ts.isCaseClause(node)) return 1
    if (isLogicalExpression(node)) return 1
    return 0
}

/**
 * Pure: `(FunctionLikeDeclaration) → cyclomatic complexity score`.
 *
 * Stops at nested function boundaries so each function's score is
 * exactly its own body, not its body plus the bodies of inner closures.
 * That matches the McCabe-per-function reporting convention and avoids
 * double-counting decision points that already appear in the inner
 * function's own score.
 */
export function scoreCyclomatic(root: ts.FunctionLikeDeclaration): number {
    let score = 1
    function visit(node: ts.Node): void {
        if (node !== root && isFunctionLikeBoundary(node)) return
        score += cyclomaticIncrement(node)
        ts.forEachChild(node, visit)
    }
    visit(root)
    return score
}

function severityFor(score: number): Severity {
    if (score > CYCLOMATIC_FAIL) return 'fail'
    if (score > CYCLOMATIC_WARN_SOFT) return 'warn'
    return 'pass'
}

type PerCommunityDetail = {
    readonly maxScore: number
    readonly worstFunctions: readonly (FunctionDetail & {readonly file: string})[]
}

function aggregate(
    detailsByCommunity: ReadonlyMap<string, ReadonlyArray<FunctionDetail & {readonly file: string}>>,
): Map<string, PerCommunityDetail> {
    const out = new Map<string, PerCommunityDetail>()
    for (const [community, fns] of detailsByCommunity) {
        if (fns.length === 0) {
            out.set(community, {maxScore: 0, worstFunctions: []})
            continue
        }
        const sorted = [...fns].sort((a, b) => b.score - a.score)
        out.set(community, {
            maxScore: sorted[0]?.score ?? 0,
            worstFunctions: sorted.slice(0, 5),
        })
    }
    return out
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
        const fns = walkFunctions(tsSourceFile, scoreCyclomatic).map(fn => ({...fn, file: file.relativePath}))
        const bucket = detailsByCommunity.get(community)!
        bucket.push(...fns)
    }

    const aggregated = aggregate(detailsByCommunity)
    const perCommunity: Record<string, number> = {}
    const violations: Violation[] = []
    for (const [community, detail] of aggregated) {
        perCommunity[community] = detail.maxScore
        if (detail.worstFunctions.length === 0) continue
        const worst = detail.worstFunctions[0]
        const sev = severityFor(worst.score)
        if (sev === 'pass') continue
        violations.push({
            community,
            score: detail.maxScore,
            baseline: null,
            severity: sev,
            message: `cyclomatic complexity ${worst.score} in ${worst.file}:${worst.line} ${worst.name}() exceeds ${sev === 'fail' ? CYCLOMATIC_FAIL : CYCLOMATIC_WARN_SOFT}`,
        })
    }

    return {
        measureId: 'cyclomatic-per-fn',
        perCommunity,
        violations,
    }
}

export const cyclomaticPerFnMeasure: SubgraphMeasure = {
    id: 'cyclomatic-per-fn',
    axis: 'shape',
    scope: 'file',
    needsTsMorph: true,
    needsInbound: false,
    run,
}

registerMeasure(cyclomaticPerFnMeasure)
