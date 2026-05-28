/**
 * Banned relative imports per touched community.
 *
 * Mirrors the full-graph invariant (health/coupling/relative-import-depth.test.ts):
 * an import is "banned" when it is RELATIVE and either
 *   - crosses a package boundary (any depth), or
 *   - stays in-package but uses `../../` or deeper.
 *
 * Layout invariant — depth >= 2 is both necessary and sufficient.
 * In the monorepo scope (webapp/src, packages/systems/<X>/src,
 * packages/libraries/<X>/src, packages/systems/voicetree-mcp/bin),
 * `../y` from any in-scope file resolves inside the importer's own
 * package. Crossing a package boundary requires at least `../../`.
 * So we don't need to resolve specifiers on disk to determine cross-
 * package — the depth check covers both cases.
 *
 * That makes this measure a pure AST walk: count import declarations
 * whose specifier starts with `../../`. No filesystem access from this
 * file; ts.createSourceFile is the only TS API we need, and the
 * subgraph runner has already read the file bytes once via parseSubgraph.
 *
 * Why a subgraph version when full-graph already enforces the same rule:
 * the full-graph test only runs in the pre-push / CI path. A bad relative
 * import added during decomposition (e.g. `../../core/argv` after a folder
 * split) escapes commit and surfaces hours later. The subgraph gate runs
 * in pre-commit and fires immediately on the community the change touched.
 *
 * Scoring: perCommunity[c] = count of banned relative imports across
 * in-scope files in c.
 *
 * Thresholds (mirrors cycles.ts model):
 *   - Absolute fail: any banned import in a touched community.
 *   - Baseline-relative: any current > baseline is also a fail.
 *
 * needsInbound = false: only the importer's outgoing edges are relevant.
 * needsTsMorph = true: we walk file ASTs via the pre-warmed Project,
 *   which is already loaded by neighbouring measures (ast-purity-ratio,
 *   exports-per-file) — so this measure pays no incremental ts-morph cost.
 */
import {ts} from 'ts-morph'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

const MEASURE_ID = 'relative-import-depth'
/**
 * Single per-measure threshold (replaces the old per-community baseline
 * ratchet). Aligned with tier-1's `BANNED_RELATIVE_IMPORT_BUDGET = 0` in
 * `packages/measures/src/health/coupling/relative-import-depth.test.ts`
 * — zero tolerance. Current per-community max baseline is also 0, so no
 * regression is introduced by dropping the baseline file.
 */
export const RELATIVE_IMPORT_THRESHOLD = 0

type BannedImport = {
    readonly file: string
    readonly line: number
    readonly specifier: string
}

function isInScope(relativePath: string): boolean {
    if (relativePath.startsWith('webapp/src/')) return true
    if (relativePath.startsWith('packages/systems/voicetree-mcp/bin/')) return true
    if (/^packages\/systems\/[^/]+\/src\//.test(relativePath)) return true
    if (/^packages\/libraries\/[^/]+\/src\//.test(relativePath)) return true
    return false
}

function isBannedDepth(specifier: string): boolean {
    if (!specifier.startsWith('.')) return false
    const matches = specifier.match(/^(\.\.\/)+/)
    if (!matches) return false
    return matches[0].split('../').length - 1 >= 2
}

function collectBannedSpecifiers(sourceFile: ts.SourceFile): Array<{specifier: string; line: number}> {
    const out: Array<{specifier: string; line: number}> = []
    const record = (literal: ts.StringLiteralLike): void => {
        if (!isBannedDepth(literal.text)) return
        const {line} = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile))
        out.push({specifier: literal.text, line: line + 1})
    }
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) record(node.moduleSpecifier)
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) record(node.moduleSpecifier)
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [arg] = node.arguments
            if (arg && ts.isStringLiteralLike(arg)) record(arg)
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
            record(node.argument.literal)
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const expression = node.moduleReference.expression
            if (ts.isStringLiteralLike(expression)) record(expression)
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return out
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const touched = new Set(parsedSubgraph.touchedCommunities)
    const project = parsedSubgraph.getProject()

    const bannedByCommunity = new Map<string, BannedImport[]>()
    const perCommunity: Record<string, number> = {}
    for (const community of parsedSubgraph.touchedCommunities) {
        bannedByCommunity.set(community, [])
        perCommunity[community] = 0
    }

    for (const file of parsedSubgraph.files) {
        const community = parsedSubgraph.communityMap.get(file.absolutePath)
        if (!community || !touched.has(community)) continue
        if (!isInScope(file.relativePath)) continue
        const tsSourceFile = project.getSourceFile(file.absolutePath)?.compilerNode
        if (!tsSourceFile) continue
        for (const banned of collectBannedSpecifiers(tsSourceFile)) {
            bannedByCommunity.get(community)!.push({
                file: file.relativePath,
                line: banned.line,
                specifier: banned.specifier,
            })
            perCommunity[community]++
        }
    }

    const violations: Violation[] = []
    for (const community of parsedSubgraph.touchedCommunities) {
        const current = perCommunity[community]
        if (current <= RELATIVE_IMPORT_THRESHOLD) continue
        const examples = bannedByCommunity.get(community)!.slice(0, 3)
        const summary = examples.map(b => `${b.file}:${b.line} ${b.specifier}`).join('; ')
        violations.push({
            community,
            score: current,
            baseline: null,
            severity: 'fail',
            message: `relative-import-depth: ${current} banned relative import(s) (depth >= 2) in ${community} > threshold ${RELATIVE_IMPORT_THRESHOLD} — ${summary}`,
        })
    }
    return {measureId: MEASURE_ID, perCommunity, violations}
}

registerMeasure({
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: true,
    needsInbound: false,
    run,
})
