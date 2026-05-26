/**
 * Shape measure: top-level exported symbols per file.
 *
 * What it measures
 * ----------------
 * For each source file in a touched community, count distinct top-level
 * exported symbols. Counts:
 *
 *   - `export const x = ...`     (one per declared binding, incl. destructured)
 *   - `export function foo() {}`
 *   - `export class C {}` / `enum E` / `interface I` / `type T`
 *   - `export default ...`       (one `default`)
 *   - `export {x, y}`            (one per re-exported name)
 *   - `export {x} from 'mod'`    (each name; re-exports are still channels)
 *   - `export * from 'mod'`      (one synthetic `*:mod` token)
 *   - `export type X` and other type-only exports — they count too
 *
 * Per-community score is **max across all files** — the widest barrel
 * in the community drives the signal.
 *
 * Severity
 * --------
 *   - count > 5   → warn  (Pattern M1 / deep-narrow modules budget)
 *   - count > 10  → warn  (hard threshold, still warn — gate is advisory)
 *   - count > 30  → fail  (clearly a barrel anti-pattern)
 */
// See `_ast-helpers.ts` — must match ts-morph's TS version (compilerNode
// returns nodes from that TS instance, and SyntaxKind constants differ).
import {ts} from 'ts-morph'
import {communityForFile} from '../../../_shared/community/community-at-depth.ts'
import {registerMeasure} from '../../_internal/registry.ts'

const SKILL_DOC = 'brain/workflows/engineering/architectural-complexity/fp-rearchitecting/address_measures/address-boundary-width.md'
import type {
    Severity,
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const EXPORTS_WARN_SOFT = 5
export const EXPORTS_WARN_HARD = 10
export const EXPORTS_FAIL = 30

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return modifiers?.some(modifier => modifier.kind === kind) ?? false
}

function collectBindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text]
    const nested = name.elements.map(element => {
        if (ts.isOmittedExpression(element)) return []
        return collectBindingNames(element.name)
    })
    return nested.flat()
}

function collectExportedDeclarationSymbols(statement: ts.Statement): string[] {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return []
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ['default']

    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap(d => collectBindingNames(d.name))
    }

    if ((ts.isFunctionDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement))
        && statement.name) {
        return [statement.name.text]
    }

    if (ts.isModuleDeclaration(statement) && statement.name) {
        // export namespace X {} / export module 'x' {}
        return [statement.name.getText()]
    }

    return []
}

function collectExportDeclarationSymbols(statement: ts.ExportDeclaration): string[] {
    if (!statement.exportClause) {
        // `export * from 'mod'` — a single channel that fans out to the
        // whole imported module. Count as one symbol with a synthetic name
        // so it can't accidentally collide with a real export named '*'.
        const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : 'local'
        return [`*:${specifier}`]
    }
    if (ts.isNamespaceExport(statement.exportClause)) return [statement.exportClause.name.text]
    return statement.exportClause.elements.map(element => element.name.text)
}

/**
 * Pure: `(SourceFile) → array of distinct top-level exported symbol names`.
 *
 * "Distinct" by name within the file — if a symbol is re-exported in two
 * `export {x}` clauses it counts once. Use the length of the returned
 * array for the per-file count.
 */
export function exportedSymbols(sourceFile: ts.SourceFile): readonly string[] {
    const symbols: Set<string> = new Set()
    for (const statement of sourceFile.statements) {
        for (const symbol of collectExportedDeclarationSymbols(statement)) symbols.add(symbol)
        if (ts.isExportAssignment(statement) && !statement.isExportEquals) symbols.add('default')
        if (ts.isExportDeclaration(statement)) {
            for (const symbol of collectExportDeclarationSymbols(statement)) symbols.add(symbol)
        }
    }
    return [...symbols].sort()
}

function severityFor(count: number): Severity {
    if (count > EXPORTS_FAIL) return 'fail'
    if (count > EXPORTS_WARN_SOFT) return 'warn'
    return 'pass'
}

type FileExportDetail = {
    readonly file: string
    readonly count: number
    readonly symbols: readonly string[]
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const touched = new Set(parsedSubgraph.touchedCommunities)

    const project = parsedSubgraph.getProject()
    const detailsByCommunity = new Map<string, FileExportDetail[]>()
    for (const community of touched) detailsByCommunity.set(community, [])

    for (const file of parsedSubgraph.files) {
        const community = communityForFile(file, parsedSubgraph.depth)
        if (!touched.has(community)) continue
        const tsSourceFile = project.getSourceFile(file.absolutePath)?.compilerNode
        if (!tsSourceFile) continue
        const symbols = exportedSymbols(tsSourceFile)
        detailsByCommunity.get(community)!.push({
            file: file.relativePath,
            count: symbols.length,
            symbols,
        })
    }

    const perCommunity: Record<string, number> = {}
    const violations: Violation[] = []
    for (const [community, files] of detailsByCommunity) {
        if (files.length === 0) { perCommunity[community] = 0; continue }
        const sorted = [...files].sort((a, b) => b.count - a.count)
        const worst = sorted[0]
        perCommunity[community] = worst.count
        const sev = severityFor(worst.count)
        if (sev === 'pass') continue
        violations.push({
            community,
            score: worst.count,
            baseline: null,
            severity: sev,
            message: `exports-per-file ${worst.count} in ${worst.file} exceeds ${sev === 'fail' ? EXPORTS_FAIL : EXPORTS_WARN_SOFT}`
                + `\nSee: ${SKILL_DOC}`,
        })
    }

    return {
        measureId: 'exports-per-file',
        perCommunity,
        violations,
    }
}

export const exportsPerFileMeasure: SubgraphMeasure = {
    id: 'exports-per-file',
    axis: 'shape',
    scope: 'file',
    needsTsMorph: true,
    needsInbound: false,
    run,
}

registerMeasure(exportsPerFileMeasure)
