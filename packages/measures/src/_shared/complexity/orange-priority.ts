/**
 * Sibling-group formation and priority-score computation.
 *
 * Used by the structural-orange gate (hierarchical-complexity.test.ts) and
 * by the upcoming subgraph-scoped commit gate. Extracted from the test file
 * so the gate's copy cannot drift from the test's copy — a regression that
 * would otherwise let a "lucky" commit pass the gate and only later fail
 * the test on pre-push.
 *
 * Two public deep functions:
 *
 *   formSiblingGroups(files, edges, depth)
 *     Returns a rich {@link SiblingGroupReport} per parent directory with
 *     intra-parent cross-community structural metrics: boundary width,
 *     tree-width, normalized entropy, modularity Q, and the DSM matrix.
 *     This is what the existing hierarchical-complexity test consumes.
 *
 *   computePriorityScoresAtDepth(files, edges, depth)
 *     Returns the minimal per-community {@link CommunityPriority} list
 *     (outEdges, fanOut, score = outEdges × max(1, fanOut)) sorted by
 *     score descending. This is the input the subgraph-commit-gate needs;
 *     it intentionally re-derives intra-parent edges from scratch rather
 *     than reusing formSiblingGroups so it can run without computing the
 *     ts-morph-heavy DSM/entropy/Q matrices.
 *
 * Both functions agree on per-community score: every CommunityPriority
 * with outEdges > 0 returned by computePriorityScoresAtDepth has a
 * matching CommunityReport inside formSiblingGroups (same outEdges, same
 * fanOut). This is exercised by the spike runner (parity check).
 */
import type {Edge, SourceFile} from '../graph/import-graph.ts'
import {communityAtDepth, siblingGroupParent} from '../community/community-at-depth.ts'
import {computeDsm, computeModularityQ, computeNormalizedEntropy, computeTreeWidth} from './hierarchical-complexity-measures.ts'

export type CommunityReport = {
    readonly id: string
    readonly fileCount: number
    readonly boundaryFileCount: number
    readonly boundaryWidth: number
    readonly fanOut: number
    readonly fanIn: number
    readonly outEdges: number
    readonly inEdges: number
    readonly couplingIntensity: number
}

export type SiblingGroupReport = {
    readonly parentId: string
    readonly depth: number
    readonly communityCount: number
    readonly fileCount: number
    readonly communities: readonly CommunityReport[]
    readonly crossEdgeCount: number
    readonly treeWidth: number
    readonly normalizedEntropy: number
    readonly modularityQ: number
    readonly dsm: { readonly names: readonly string[]; readonly matrix: readonly (readonly number[])[] }
}

export type CommunityPriority = {
    readonly community: string
    readonly parent: string
    readonly outEdges: number
    readonly fanOut: number
    readonly score: number
}

/**
 * Group files into communities at the given depth, partition by parent,
 * and compute per-sibling-group structural metrics. Only sibling groups
 * with ≥2 communities are reported (single-community groups have no
 * cross-edges to measure).
 */
export function formSiblingGroups(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    depth: number,
): SiblingGroupReport[] {
    const fileCommunities = new Map<string, string>()
    for (const file of files) {
        fileCommunities.set(file.absolutePath, communityAtDepth(file.packageName, file.relToSrc, depth))
    }

    const communitiesByParent = new Map<string, Map<string, SourceFile[]>>()
    for (const file of files) {
        const community = fileCommunities.get(file.absolutePath)!
        const parent = siblingGroupParent(community, depth)
        if (!communitiesByParent.has(parent)) communitiesByParent.set(parent, new Map())
        const parentMap = communitiesByParent.get(parent)!
        if (!parentMap.has(community)) parentMap.set(community, [])
        parentMap.get(community)!.push(file)
    }

    const reports: SiblingGroupReport[] = []

    for (const [parentId, communityMap] of [...communitiesByParent].sort(([a], [b]) => a.localeCompare(b))) {
        if (communityMap.size < 2) continue

        const intraParentEdges = edges.filter(e => {
            const fromC = fileCommunities.get(e.from.absolutePath)!
            const toC = fileCommunities.get(e.to.absolutePath)!
            const fromP = siblingGroupParent(fromC, depth)
            const toP = siblingGroupParent(toC, depth)
            return fromP === parentId && toP === parentId
        })
        const crossEdges = intraParentEdges.filter(e => {
            const fromC = fileCommunities.get(e.from.absolutePath)!
            const toC = fileCommunities.get(e.to.absolutePath)!
            return fromC !== toC
        })

        const communityNames = [...communityMap.keys()].sort()
        const shortNames = communityNames.map(c => c.split('/').pop()!)

        const boundaryFiles = new Set<string>()
        for (const e of crossEdges) {
            boundaryFiles.add(e.from.absolutePath)
            boundaryFiles.add(e.to.absolutePath)
        }

        const outEdgesByComm = new Map<string, number>()
        const inEdgesByComm = new Map<string, number>()
        const fanOutTargets = new Map<string, Set<string>>()
        const fanInSources = new Map<string, Set<string>>()
        for (const name of communityNames) {
            outEdgesByComm.set(name, 0)
            inEdgesByComm.set(name, 0)
            fanOutTargets.set(name, new Set())
            fanInSources.set(name, new Set())
        }
        for (const e of crossEdges) {
            const fromC = fileCommunities.get(e.from.absolutePath)!
            const toC = fileCommunities.get(e.to.absolutePath)!
            outEdgesByComm.set(fromC, (outEdgesByComm.get(fromC) ?? 0) + 1)
            inEdgesByComm.set(toC, (inEdgesByComm.get(toC) ?? 0) + 1)
            fanOutTargets.get(fromC)!.add(toC)
            fanInSources.get(toC)!.add(fromC)
        }

        const communityReports: CommunityReport[] = communityNames.map(name => {
            const cFiles = communityMap.get(name)!
            const bCount = cFiles.filter(f => boundaryFiles.has(f.absolutePath)).length
            const outE = outEdgesByComm.get(name) ?? 0
            const inE = inEdgesByComm.get(name) ?? 0
            return {
                id: name,
                fileCount: cFiles.length,
                boundaryFileCount: bCount,
                boundaryWidth: cFiles.length === 0 ? 0 : bCount / cFiles.length,
                fanOut: fanOutTargets.get(name)?.size ?? 0,
                fanIn: fanInSources.get(name)?.size ?? 0,
                outEdges: outE,
                inEdges: inE,
                couplingIntensity: cFiles.length === 0 ? 0 : (outE + inE) / cFiles.length,
            }
        })

        const treeWidth = computeTreeWidth(crossEdges, boundaryFiles)
        const entropy = computeNormalizedEntropy(crossEdges, communityNames, fileCommunities)
        const modularityQ = computeModularityQ(intraParentEdges, fileCommunities, communityNames)
        const dsm = computeDsm(crossEdges, communityNames, shortNames, fileCommunities)

        const totalFiles = [...communityMap.values()].reduce((sum, f) => sum + f.length, 0)

        reports.push({
            parentId,
            depth,
            communityCount: communityMap.size,
            fileCount: totalFiles,
            communities: communityReports,
            crossEdgeCount: crossEdges.length,
            treeWidth,
            normalizedEntropy: entropy,
            modularityQ,
            dsm,
        })
    }

    return reports
}

/**
 * Compute the per-community structural-orange priority score at the given
 * depth: `outEdges × max(1, fanOut)`, where both are measured strictly
 * over *intra-parent* cross-community edges (an edge from `pkg/a/foo` to
 * `pkg/a/bar` counts; an edge from `pkg/a/foo` to `otherpkg/x/bar` does not).
 *
 * Communities with `outEdges === 0` are stable cores by design and are
 * excluded from the output entirely (they are healthy — including them
 * would dilute the priority ranking).
 *
 * Returned list is sorted score-descending, parent ASC as a tiebreak.
 */
export function computePriorityScoresAtDepth(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    depth: number,
): CommunityPriority[] {
    const fileCommunities = new Map<string, string>()
    for (const f of files) fileCommunities.set(f.absolutePath, communityAtDepth(f.packageName, f.relToSrc, depth))

    const result: CommunityPriority[] = []
    const communitiesByParent = new Map<string, Set<string>>()
    for (const f of files) {
        const c = fileCommunities.get(f.absolutePath)!
        const p = siblingGroupParent(c, depth)
        if (!communitiesByParent.has(p)) communitiesByParent.set(p, new Set())
        communitiesByParent.get(p)!.add(c)
    }

    for (const [parent, communitySet] of communitiesByParent) {
        if (communitySet.size < 2) continue
        const communityNames = [...communitySet]
        const outEdgesByComm = new Map<string, number>()
        const fanOutTargets = new Map<string, Set<string>>()
        for (const c of communityNames) {
            outEdgesByComm.set(c, 0)
            fanOutTargets.set(c, new Set())
        }
        for (const e of edges) {
            const fromC = fileCommunities.get(e.from.absolutePath)
            const toC = fileCommunities.get(e.to.absolutePath)
            if (!fromC || !toC) continue
            const fromP = siblingGroupParent(fromC, depth)
            const toP = siblingGroupParent(toC, depth)
            if (fromP !== parent || toP !== parent) continue
            if (fromC === toC) continue
            outEdgesByComm.set(fromC, (outEdgesByComm.get(fromC) ?? 0) + 1)
            fanOutTargets.get(fromC)!.add(toC)
        }

        for (const c of communityNames) {
            const outE = outEdgesByComm.get(c) ?? 0
            if (outE === 0) continue
            const fanOut = fanOutTargets.get(c)?.size ?? 0
            result.push({
                community: c,
                parent,
                outEdges: outE,
                fanOut,
                score: outE * Math.max(1, fanOut),
            })
        }
    }

    result.sort((a, b) => b.score - a.score)
    return result
}
