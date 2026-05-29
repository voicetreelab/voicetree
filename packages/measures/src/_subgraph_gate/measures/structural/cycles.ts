/**
 * Strongly-connected components on the touched-community subgraph.
 *
 * A community's score = number of non-trivial SCCs (size > 1) that
 * touch the community. Any SCC means a cycle; any cycle reaching into
 * a touched community is a fail.
 *
 * Classification:
 *   - INTRA-COMMUNITY cycle: every member file lives in the touched
 *     community. Bad — hidden coupling inside one module. Fails the gate.
 *   - CROSS-PACKAGE cycle: SCC spans ≥2 packages. Worse — leaks across
 *     ownership lines. Also fails (severity 'fail' either way; we surface
 *     classification in the message for triage).
 *   - CROSS-COMMUNITY (same-package) cycle: SCC spans communities inside
 *     one package. Bad but the smallest scope; fails.
 *
 * Fix patterns: same as #8 (DSM upper-triangular) — pattern 1, pattern 5,
 * P3 tier-ordered packages.
 *
 * needsInbound = true:
 *   SCC detection requires seeing back-edges into the touched community
 *   that close the cycle. Outbound-only would miss them.
 *
 * needsTsMorph = false: edge list arithmetic only.
 */
import type {Edge, SourceFile} from '../../../_shared/graph/import-graph.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'cycles'
/**
 * Single per-measure threshold (replaces the old per-community baseline
 * ratchet). Strict zero-tolerance — matches the old `CYCLES_BUDGET = 0`
 * absolute. Cycles are categorical (infinite-recursion risk, tier-order
 * violation). 8 grandfathered communities have cycles > 0 and now fail
 * when touched; fix the cycle rather than persist via baseline.
 */
export const CYCLES_THRESHOLD = 0

export type CycleClassification = 'intra-community' | 'cross-community' | 'cross-package'

export type SccReport = {
    readonly members: readonly string[]
    readonly communities: readonly string[]
    readonly packages: readonly string[]
    readonly classification: CycleClassification
}

/**
 * Tarjan SCC. Pure: nodes + adjacency → list of non-trivial SCCs
 * (size > 1, OR a self-loop). Self-loops count because a file
 * importing itself is a cycle.
 */
export function findNonTrivialSccs(
    nodes: readonly string[],
    adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
    let nextIndex = 0
    const index = new Map<string, number>()
    const lowLink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    const sccs: string[][] = []

    const strongconnect = (v: string): void => {
        index.set(v, nextIndex)
        lowLink.set(v, nextIndex)
        nextIndex++
        stack.push(v)
        onStack.add(v)

        for (const w of adjacency.get(v) ?? []) {
            if (!index.has(w)) {
                strongconnect(w)
                lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!))
            } else if (onStack.has(w)) {
                lowLink.set(v, Math.min(lowLink.get(v)!, index.get(w)!))
            }
        }

        if (lowLink.get(v) === index.get(v)) {
            const scc: string[] = []
            while (true) {
                const w = stack.pop()!
                onStack.delete(w)
                scc.push(w)
                if (w === v) break
            }
            // Non-trivial = size > 1 OR a self-loop on the singleton.
            const isSelfLoop = scc.length === 1 && (adjacency.get(scc[0])?.has(scc[0]) ?? false)
            if (scc.length > 1 || isSelfLoop) sccs.push(scc.sort())
        }
    }

    for (const v of nodes) if (!index.has(v)) strongconnect(v)
    return sccs.sort((a, b) => a[0].localeCompare(b[0]))
}

function classify(
    scc: readonly string[],
    communityMap: ReadonlyMap<string, string>,
    packageMap: ReadonlyMap<string, string>,
): SccReport {
    const communities = new Set<string>()
    const packages = new Set<string>()
    for (const m of scc) {
        const c = communityMap.get(m); if (c) communities.add(c)
        const p = packageMap.get(m); if (p) packages.add(p)
    }
    const classification: CycleClassification =
        packages.size > 1 ? 'cross-package'
        : communities.size > 1 ? 'cross-community'
        : 'intra-community'
    return {
        members: scc,
        communities: [...communities].sort(),
        packages: [...packages].sort(),
        classification,
    }
}

function packageMapFromFiles(files: readonly SourceFile[]): Map<string, string> {
    return new Map(files.map(f => [f.absolutePath, f.packageName]))
}

function adjacencyFromEdges(
    files: readonly SourceFile[],
    edges: readonly Edge[],
): {nodes: string[]; adjacency: ReadonlyMap<string, ReadonlySet<string>>} {
    const nodes = files.map(f => f.absolutePath).sort()
    const adj = new Map<string, Set<string>>()
    for (const n of nodes) adj.set(n, new Set())
    for (const e of edges) {
        adj.get(e.from.absolutePath)?.add(e.to.absolutePath)
    }
    return {nodes, adjacency: adj}
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input

    const {nodes, adjacency} = adjacencyFromEdges(parsedSubgraph.files, parsedSubgraph.edges)
    const sccs = findNonTrivialSccs(nodes, adjacency)
    const packageMap = packageMapFromFiles(parsedSubgraph.files)
    const reports = sccs.map(scc => classify(scc, parsedSubgraph.communityMap, packageMap))

    const perCommunity: Record<string, number> = {}
    const reportsByCommunity = new Map<string, SccReport[]>()
    for (const community of parsedSubgraph.touchedCommunities) {
        perCommunity[community] = 0
        reportsByCommunity.set(community, [])
    }
    for (const report of reports) {
        for (const community of report.communities) {
            if (!perCommunity.hasOwnProperty(community)) continue
            perCommunity[community]++
            reportsByCommunity.get(community)!.push(report)
        }
    }

    const violations: Violation[] = []
    for (const community of parsedSubgraph.touchedCommunities) {
        const current = perCommunity[community]
        if (current <= CYCLES_THRESHOLD) continue
        const examples = reportsByCommunity.get(community)!.slice(0, 3)
        const summary = examples.map(r => `${r.classification}: ${r.communities.join('+')} [${r.members.length} files]`).join('; ')
        violations.push({
            community,
            score: current,
            baseline: null,
            severity: 'fail',
            message: `cycles: ${current} non-trivial SCC(s) touching ${community} > threshold ${CYCLES_THRESHOLD} — ${summary}`,
        })
    }
    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const cyclesMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: true,
    run,
}

registerMeasure(cyclesMeasure)
