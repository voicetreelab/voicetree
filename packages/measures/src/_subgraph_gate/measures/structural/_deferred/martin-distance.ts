/**
 * Martin abstractness/instability distance from the main sequence,
 * computed per community at the same depth used by structural-orange.
 *
 * Definitions:
 *   Ce = outgoing cross-community edges (file-level, dedup'd by target file)
 *   Ca = incoming cross-community edges
 *   I  = Ce / (Ce + Ca)                  ∈ [0, 1]   — instability
 *   A  = abstract_decls / total_decls    ∈ [0, 1]   — abstractness
 *   D  = |A + I − 1|                     ∈ [0, 1]   — distance from
 *                                                       the main sequence
 *
 * Main sequence (A + I ≈ 1) is healthy:
 *   ports/types pkg: A=0.9, I=0.1 → stable abstraction.
 *   shell pkg:       A=0.1, I=0.9 → concrete swappable adapter.
 *
 * Zone of pain (A + I << 1) is `utils/`-bucket failure:
 *   concrete impls that everyone depends on, depending on nothing.
 *
 * Decl classification (from TS AST, no type checker):
 *   abstract:  TypeAliasDeclaration, InterfaceDeclaration,
 *              ClassDeclaration with `abstract` modifier.
 *   concrete:  ClassDeclaration without `abstract`, FunctionDeclaration,
 *              const-arrow exports (`export const X = (...) => ...`),
 *              VariableDeclaration (non-arrow), EnumDeclaration.
 *   ignored:   ExportDeclaration re-exports, namespace blocks.
 *
 * We deliberately do NOT use the TypeChecker — counting at the syntactic
 * level keeps the measure cheap, and the abstractness signal is dominated
 * by what's *declared* rather than what's *inferred*.
 *
 * needsInbound = true:
 *   Ca requires seeing edges from outside the touched community pointing
 *   into it; without inbound the I we compute will be biased toward 1.
 *
 * needsTsMorph = false:
 *   ts.createSourceFile is enough; we walk top-level statements only.
 */
import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import type {Edge, SourceFile} from '../../../../_shared/graph/import-graph.ts'
import {loadBaseline} from '../../../_internal/baseline-store.ts'
import {registerMeasure} from '../../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'martin-distance'

export const MARTIN_DISTANCE_WARN = 0.4
export const MARTIN_DISTANCE_FAIL = 0.6

export type DeclClassification = {
    readonly abstract: number
    readonly concrete: number
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return mods?.some(m => m.kind === kind) ?? false
}

function isArrowLike(node: ts.Node): boolean {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true
    return false
}

/**
 * Classify the top-level declarations of one source file as abstract
 * or concrete. Re-exports / namespace blocks are not counted.
 *
 * Pure of side effects.
 */
export function classifyDecls(filePath: string, text: string): DeclClassification {
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    let abstractCount = 0
    let concreteCount = 0

    for (const stmt of sf.statements) {
        // Type alias / interface = pure abstract.
        if (ts.isTypeAliasDeclaration(stmt)) { abstractCount++; continue }
        if (ts.isInterfaceDeclaration(stmt)) { abstractCount++; continue }

        if (ts.isClassDeclaration(stmt)) {
            if (hasModifier(stmt, ts.SyntaxKind.AbstractKeyword)) abstractCount++
            else concreteCount++
            continue
        }

        if (ts.isFunctionDeclaration(stmt)) {
            // Body-less function decl is an overload signature — abstract.
            if (!stmt.body) abstractCount++
            else concreteCount++
            continue
        }

        if (ts.isEnumDeclaration(stmt)) {
            concreteCount++
            continue
        }

        if (ts.isVariableStatement(stmt)) {
            // const X = (...) => ... → concrete fn
            // const X = literal     → concrete value
            // Either way, it's a concrete decl. Count one per declarator.
            for (const d of stmt.declarationList.declarations) {
                if (d.initializer && isArrowLike(d.initializer)) concreteCount++
                else concreteCount++
            }
        }
        // ExportDeclaration / ImportDeclaration / NamespaceExport: ignored.
    }
    return {abstract: abstractCount, concrete: concreteCount}
}

async function classifyFile(file: SourceFile): Promise<DeclClassification> {
    try {
        const text = await readFile(file.absolutePath, 'utf8')
        return classifyDecls(file.absolutePath, text)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {abstract: 0, concrete: 0}
        throw err
    }
}

type CommunityMartin = {
    readonly community: string
    readonly ca: number
    readonly ce: number
    readonly instability: number
    readonly abstract: number
    readonly concrete: number
    readonly abstractness: number
    readonly distance: number
}

function communityEdgeCounts(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    communityMap: ReadonlyMap<string, string>,
    community: string,
): {ca: number; ce: number} {
    const membership = new Set(
        files.filter(f => communityMap.get(f.absolutePath) === community).map(f => f.absolutePath),
    )
    // Dedup edges by (from, to) — multiple imports across different files
    // can land on the same edge after path resolution; we want a single
    // "depends on" relationship per (fromFile, toFile).
    const seen = new Set<string>()
    let ca = 0
    let ce = 0
    for (const e of edges) {
        const key = `${e.from.absolutePath}\0${e.to.absolutePath}`
        if (seen.has(key)) continue
        seen.add(key)
        const fromIn = membership.has(e.from.absolutePath)
        const toIn = membership.has(e.to.absolutePath)
        if (fromIn && !toIn) ce++
        else if (!fromIn && toIn) ca++
    }
    return {ca, ce}
}

async function metricsForCommunity(
    community: string,
    files: readonly SourceFile[],
    edges: readonly Edge[],
    communityMap: ReadonlyMap<string, string>,
): Promise<CommunityMartin> {
    const inCommunity = files.filter(f => communityMap.get(f.absolutePath) === community)
    const decls = await Promise.all(inCommunity.map(classifyFile))
    const abstractCount = decls.reduce((s, d) => s + d.abstract, 0)
    const concreteCount = decls.reduce((s, d) => s + d.concrete, 0)
    const total = abstractCount + concreteCount

    const {ca, ce} = communityEdgeCounts(files, edges, communityMap, community)
    const instabDenom = ca + ce
    const instability = instabDenom === 0 ? 0 : ce / instabDenom
    const abstractness = total === 0 ? 0 : abstractCount / total
    const distance = Math.abs(abstractness + instability - 1)
    return {community, ca, ce, instability, abstract: abstractCount, concrete: concreteCount, abstractness, distance}
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const perCommunity: Record<string, number> = {}
    const detailsByCommunity = new Map<string, CommunityMartin>()
    for (const community of parsedSubgraph.touchedCommunities) {
        const m = await metricsForCommunity(community, parsedSubgraph.files, parsedSubgraph.edges, parsedSubgraph.communityMap)
        perCommunity[community] = m.distance
        detailsByCommunity.set(community, m)
    }

    const baseline = await loadBaseline(MEASURE_ID)
    const violations: Violation[] = []
    for (const community of parsedSubgraph.touchedCommunities) {
        const m = detailsByCommunity.get(community)!
        const current = m.distance
        const baselineScore = community in baseline ? baseline[community] : null

        if (current >= MARTIN_DISTANCE_FAIL) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `martin-distance D=${current.toFixed(2)} (A=${m.abstractness.toFixed(2)} I=${m.instability.toFixed(2)} Ca=${m.ca} Ce=${m.ce}) — zone of pain`,
            })
            continue
        }
        if (current >= MARTIN_DISTANCE_WARN) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'warn',
                message: `martin-distance D=${current.toFixed(2)} (A=${m.abstractness.toFixed(2)} I=${m.instability.toFixed(2)}) — off the main sequence`,
            })
            continue
        }
        if (baselineScore !== null && current > baselineScore + 0.01) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `martin-distance regressed: ${baselineScore.toFixed(2)} -> ${current.toFixed(2)}`,
            })
        }
    }
    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const martinDistanceMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: true,
    run,
}

registerMeasure(martinDistanceMeasure)
