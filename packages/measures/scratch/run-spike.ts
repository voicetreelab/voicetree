/**
 * SPIKE runner — NOT production code.
 *
 * Reproduces the per-community priority score (the structural-orange "orange gate")
 * via two paths:
 *   FULL : full-graph parse (existing behaviour from hierarchical-complexity.test.ts).
 *   SUB  : subgraph parse via parseSubgraphFromFullGraph + parseSubgraphLean.
 *
 * Compares per-community scores for the TOUCHED community and prints timing.
 *
 * Usage:  npx tsx packages/measures/scratch/run-spike.ts <relative/path/to/file.ts> [more files...]
 */
import {dirname, relative, resolve} from 'node:path'
import {performance} from 'node:perf_hooks'
import {discoverPackages, DEFAULT_REPO_ROOT} from '../src/_shared/discovery/discover-packages.js'
import {buildImportGraph, type Edge, type SourceFile} from '../src/_shared/graph/import-graph.js'
import {parseSubgraphFromFullGraph, parseSubgraphLean, communityAtDepth, siblingGroupParent} from './parse-subgraph.js'

const DEPTH = 1  // depth-1 is where the structural-orange gate is canonically reported.

// --- replica of the priority-score computation from hierarchical-complexity.test.ts ---
// We re-implement here (rather than refactor the test) because the spike rule is
// "don't touch the existing full-graph runner".

type CommunityPriority = {
    readonly community: string
    readonly parent: string
    readonly outEdges: number
    readonly fanOut: number
    readonly score: number
}

function computePriorityScoresAtDepth(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    depth: number,
): CommunityPriority[] {
    const fileCommunities = new Map<string, string>()
    for (const f of files) fileCommunities.set(f.absolutePath, communityAtDepth(f.packageName, f.relToSrc, depth))

    // Only intra-parent cross-community edges count toward outEdges/fanOut (matches the existing test).
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
            if (outE === 0) continue  // stable cores excluded by design
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

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    if (args.length === 0) {
        console.error('Usage: npx tsx packages/measures/scratch/run-spike.ts <rel/path/to/file.ts> [...]')
        process.exit(2)
    }
    const changedRel = args
    const changedAbs = changedRel.map(p => resolve(DEFAULT_REPO_ROOT, p))

    console.log('\n=== SPIKE: subgraph-scoped structural-orange ===')
    console.log(`changed files: ${changedRel.length}`)
    for (const p of changedRel) console.log(`  - ${p}`)

    // ---------------------------------------------------------------
    // FULL path
    // ---------------------------------------------------------------
    console.log('\n[FULL] building full import graph...')
    const tFull0 = performance.now()
    const packages = await discoverPackages()
    const fullGraph = await buildImportGraph(packages)
    const fullScores = computePriorityScoresAtDepth(fullGraph.files, fullGraph.edges, DEPTH)
    const tFull = performance.now() - tFull0
    console.log(`[FULL] graph: ${fullGraph.files.length} files, ${fullGraph.edges.length} edges`)
    console.log(`[FULL] wall-clock: ${tFull.toFixed(0)}ms`)

    // Identify touched communities from the full-graph file list
    const touchedCommunities = new Set<string>()
    for (const f of fullGraph.files) {
        if (changedAbs.includes(f.absolutePath)) {
            touchedCommunities.add(communityAtDepth(f.packageName, f.relToSrc, DEPTH))
        }
    }
    if (touchedCommunities.size === 0) {
        console.error(`\n[ERROR] none of the changed files mapped to a community. Check paths.`)
        process.exit(1)
    }
    console.log(`[FULL] touched communities: ${[...touchedCommunities].join(', ')}`)
    const fullTouchedScores = new Map(fullScores.filter(s => touchedCommunities.has(s.community)).map(s => [s.community, s]))

    // ---------------------------------------------------------------
    // SUB-from-full path (correctness check, independent of IO speedup)
    // ---------------------------------------------------------------
    console.log('\n[SUB-from-full] re-scoring touched community on subgraph trimmed from full graph...')
    const tSubFromFull0 = performance.now()
    const subFromFull = await parseSubgraphFromFullGraph(fullGraph, changedAbs, /*hops=*/1, DEPTH)
    const subFromFullScores = computePriorityScoresAtDepth(subFromFull.files, subFromFull.edges, DEPTH)
    const tSubFromFull = performance.now() - tSubFromFull0
    console.log(`[SUB-from-full] subgraph: ${subFromFull.files.length} files, ${subFromFull.edges.length} edges`)
    console.log(`[SUB-from-full] wall-clock (excl. full-graph build): ${tSubFromFull.toFixed(0)}ms`)

    // ---------------------------------------------------------------
    // SUB-lean path (IO-realistic — only reads touched-community files)
    // ---------------------------------------------------------------
    console.log('\n[SUB-lean] building lean subgraph (only reads touched-community files)...')
    const tSubLean0 = performance.now()
    const subLean = await parseSubgraphLean(changedRel, /*hops=*/1, DEPTH)
    const subLeanScores = computePriorityScoresAtDepth(subLean.files, subLean.edges, DEPTH)
    const tSubLean = performance.now() - tSubLean0
    console.log(`[SUB-lean] subgraph: ${subLean.files.length} files, ${subLean.edges.length} edges`)
    console.log(`[SUB-lean] wall-clock (full pipeline): ${tSubLean.toFixed(0)}ms`)

    // ---------------------------------------------------------------
    // Compare per-touched-community scores
    // ---------------------------------------------------------------
    console.log('\n=== SCORE COMPARISON (touched communities only) ===')
    const allTouched = [...touchedCommunities].sort()
    let mismatchCount = 0
    for (const c of allTouched) {
        const f = fullTouchedScores.get(c)
        const a = subFromFullScores.find(s => s.community === c)
        const b = subLeanScores.find(s => s.community === c)
        const fStr = f ? `outE=${f.outEdges} fan=${f.fanOut} score=${f.score}` : '(no score — stable core)'
        const aStr = a ? `outE=${a.outEdges} fan=${a.fanOut} score=${a.score}` : '(no score)'
        const bStr = b ? `outE=${b.outEdges} fan=${b.fanOut} score=${b.score}` : '(no score)'
        const fScore = f?.score ?? 0
        const aScore = a?.score ?? 0
        const bScore = b?.score ?? 0
        const matchA = fScore === aScore ? 'MATCH' : 'MISMATCH'
        const matchB = fScore === bScore ? 'MATCH' : 'MISMATCH'
        if (fScore !== aScore || fScore !== bScore) mismatchCount++
        console.log(`\n  community: ${c}`)
        console.log(`    FULL          : ${fStr}`)
        console.log(`    SUB-from-full : ${aStr}  [${matchA}]`)
        console.log(`    SUB-lean      : ${bStr}  [${matchB}]`)
    }

    console.log('\n=== TIMING SUMMARY ===')
    console.log(`  FULL          : ${tFull.toFixed(0)}ms`)
    console.log(`  SUB-from-full : ${tSubFromFull.toFixed(0)}ms (excludes full-graph build — only meaningful as correctness check)`)
    const speedupX = (tFull / tSubLean).toFixed(1)
    const pctFaster = ((1 - tSubLean / tFull) * 100).toFixed(1)
    console.log(`  SUB-lean      : ${tSubLean.toFixed(0)}ms  -->  speedup vs FULL: ${speedupX}x  (${pctFaster}% faster)`)

    console.log('\n=== VERDICT ===')
    if (mismatchCount === 0) console.log('  Per-community priority scores MATCH on both subgraph variants for the touched community(ies).')
    else console.log(`  ${mismatchCount} touched community(ies) MISMATCH. Spike kills the design.`)

    process.exit(mismatchCount === 0 ? 0 : 1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
