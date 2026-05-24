/**
 * `module-state-bindings` — count top-level mutable bindings per file,
 * aggregated per community.
 *
 * "Mutable" here is the narrow lexical sense: `let` and `var` declared
 * directly at the source-file top level. NOT inside any function, NOT
 * `const` (even `const x = new Map()` — the binding itself is immutable,
 * and `behavioral-complexity.test.ts` already widens to mutable-container
 * `const`s; this measure is the *strict* visibility precondition).
 *
 * Why we care: a top-level `let X = ...` is a hidden mutable cell that
 * the import graph cannot see. Two modules importing the same compiled
 * module both observe (and can mutate) the same cell. The classic
 * `graph-db-server/state/` failure mode — nine module-level `let`s
 * passing every structural check while shipping the dual-state bug.
 *
 * The fix is FP pattern 2 (state-threading): replace `let count = 0` +
 * `function tick() { count++ }` with `(s: State) => ({...s, count: s.count + 1})`,
 * making the state cell an explicit argument that the import graph
 * (and the type system) can see.
 *
 * Threshold: 0 — any module-level `let` or `var` is a fail. There is no
 * "small ok number" — one such binding is one invisible coupling channel.
 *
 * Per-community score: sum of file-level binding counts across files
 * that live in the touched community(ies). Files reached via import hops
 * are not counted (they're not what the user is changing right now;
 * the full-graph pre-push pass catches their bindings).
 */
import {Node, type SourceFile as MorphSourceFile} from 'ts-morph'
import {communityForFile} from '../../../_shared/community/community-at-depth.ts'
import {loadBaseline} from '../../_internal/baseline-store.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'module-state-bindings'

export type ModuleStateBinding = {
    readonly filePath: string
    readonly line: number
    readonly name: string
    /** `let` or `var` — both are mutable at module scope; `var` is even worse (hoisted). */
    readonly kind: 'let' | 'var'
}

/**
 * Walk a source file's top-level statements; collect `let`/`var`
 * declarations. Skips anything nested inside a function/class/block —
 * those are stack-local, not module-level.
 *
 * Pure function of the source file. No I/O. The ts-morph SourceFile
 * is passed in already populated by the caller.
 */
export function findModuleStateBindings(sourceFile: MorphSourceFile): readonly ModuleStateBinding[] {
    const bindings: ModuleStateBinding[] = []
    const filePath = sourceFile.getFilePath()
    for (const statement of sourceFile.getStatements()) {
        if (!Node.isVariableStatement(statement)) continue
        const declList = statement.getDeclarationList()
        const flagsKind = declList.getDeclarationKind()
        // ts-morph DeclarationKind: 'const' | 'let' | 'var'
        if (flagsKind === 'const') continue
        const kind: 'let' | 'var' = flagsKind === 'var' ? 'var' : 'let'
        for (const decl of declList.getDeclarations()) {
            const nameNode = decl.getNameNode()
            // Destructuring at module scope: still mutable — record each binding name.
            const names = collectIdentifierNames(nameNode)
            for (const name of names) {
                bindings.push({
                    filePath,
                    line: decl.getStartLineNumber(),
                    name,
                    kind,
                })
            }
        }
    }
    return bindings
}

function collectIdentifierNames(node: Node): readonly string[] {
    if (Node.isIdentifier(node)) return [node.getText()]
    // Object / array destructuring at top-level — recurse into binding elements.
    // A BindingElement can have BOTH `propertyName` (the rename source, like
    // `d` in `{d: renamed}`) AND `name` (the actual binding, `renamed`). We
    // want only the binding name, never the property source.
    const out: string[] = []
    node.forEachDescendant(d => {
        if (!Node.isBindingElement(d)) return
        const nameNode = d.getNameNode()
        if (Node.isIdentifier(nameNode)) out.push(nameNode.getText())
        // Nested destructuring (e.g. `let {a: {b}} = ...`) is recursed by
        // forEachDescendant continuing into the inner ObjectBindingPattern.
    })
    return out
}

function classifySeverity(
    score: number,
    baseline: number | null,
): 'pass' | 'warn' | 'fail' {
    // Strict precondition: any module-level mutable binding is a fail.
    // Baseline is informational only here — we never amnesty an existing
    // binding by saying "well it was there before"; this is the visibility
    // floor every other measure stands on.
    if (score === 0) return 'pass'
    if (baseline !== null && score <= baseline) return 'warn'
    return 'fail'
}

function buildMessage(score: number, baseline: number | null): string {
    const baselineFragment = baseline === null
        ? '(no baseline)'
        : `baseline=${baseline}`
    return (
        `${score} module-level mutable binding(s) ${baselineFragment}. `
        + 'Top-level `let`/`var` is a hidden cell the import graph cannot see — '
        + 'thread state through arguments (FP pattern 2: state-threading) '
        + 'rather than mutating a module-scoped cell.'
    )
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const project = parsedSubgraph.getProject()
    const touched = new Set(parsedSubgraph.touchedCommunities)

    const perCommunity: Record<string, number> = {}
    for (const community of touched) perCommunity[community] = 0

    for (const file of parsedSubgraph.files) {
        const community = parsedSubgraph.communityMap.get(file.absolutePath)
        if (!community || !touched.has(community)) continue
        const morphFile = project.getSourceFile(file.absolutePath)
        if (!morphFile) continue
        const bindings = findModuleStateBindings(morphFile)
        perCommunity[community] = (perCommunity[community] ?? 0) + bindings.length
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
            message: buildMessage(score, baselineScore),
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

// Re-export so the test file can avoid relying on the registry singleton
// (the side-effect registration above is for production wiring).
export {measure}
