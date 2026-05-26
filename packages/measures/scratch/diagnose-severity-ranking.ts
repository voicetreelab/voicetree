#!/usr/bin/env node
/**
 * Diagnostic: full severity-ranked list + sanity checks.
 *
 * Prints:
 *   - import-graph diameter estimate (sampled — full pairwise BFS would
 *     be too expensive on the full repo, but we can probe enough random
 *     reachable pairs to get a tight upper bound)
 *   - rank of caller-named "interesting" pairs (passed via --probe)
 *   - cumulative recoverable-LOC curve at thresholds [5, 10, 20, 50, 100]
 *
 * Invoke from repo root via the dev box:
 *   node scripts/run-remote.mjs npx --prefix packages/measures tsx \\
 *     packages/measures/scratch/diagnose-severity-ranking.ts
 */
import {readFile} from 'node:fs/promises'
import {clusterCallDags} from '../src/duplication-workflow/cluster-call-dags.ts'
import {clusterDuplicates} from '../src/duplication-per-function/cluster-duplicates.ts'
import {extractFunctions} from '../src/duplication-extract/extract-functions.ts'
import {
    rankSeverity,
    type RankablePair,
    type SeverityRankedPair,
} from '../src/duplication-ranking/severity-ranking.ts'
import {discoverPackages} from '../src/_shared/discovery/discover-packages.ts'
import {discoverSourceFiles} from '../src/_shared/discovery/function-discovery.ts'
import {
    buildUndirectedImportIndex,
    importIndexStats,
    MAX_IMPORT_DISTANCE,
    shortestImportDistance,
    type UndirectedImportIndex,
} from '../src/_shared/graph/import-distance.ts'
import {buildImportGraph} from '../src/_shared/graph/import-graph.ts'

/** Names the caller wants to locate in the ranking. */
const PROBE_NAMES: readonly string[] = [
    'getAvailableFoldersForSelector',
    'agentWait',
    'agentClose',
    'agentOutput',
]

const THRESHOLD_PROBES: readonly number[] = [5, 10, 20, 50, 100]

function estimateDiameter(index: UndirectedImportIndex, sampleSize: number): {sampled: number; maxObserved: number; reachableRate: number} {
    const keys = [...index.relativePathToFile.keys()]
    if (keys.length < 2) return {sampled: 0, maxObserved: 0, reachableRate: 0}

    // Deterministic LCG so the diagnostic is reproducible — no Math.random.
    let seed = 0xdeadbeef
    function next(): number {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed
    }

    let maxObserved = 0
    let reachable = 0
    let attempted = 0
    while (attempted < sampleSize) {
        const i = next() % keys.length
        const j = next() % keys.length
        if (i === j) continue
        attempted += 1
        const dist = shortestImportDistance(index, keys[i], keys[j])
        if (dist < MAX_IMPORT_DISTANCE) {
            reachable += 1
            if (dist > maxObserved) maxObserved = dist
        }
    }
    return {
        sampled: attempted,
        maxObserved,
        reachableRate: reachable / attempted,
    }
}

function findRanks(ranked: readonly SeverityRankedPair[], names: readonly string[]): Map<string, number[]> {
    const ranks = new Map<string, number[]>()
    for (const name of names) ranks.set(name, [])
    ranked.forEach((pair, index) => {
        for (const name of names) {
            if (pair.aEndpoint.name === name || pair.bEndpoint.name === name) {
                ranks.get(name)!.push(index + 1)
            }
        }
    })
    return ranks
}

function fmtPair(pair: SeverityRankedPair): string {
    return `sev=${pair.severity.toFixed(1)} loc=${pair.minLoc} sim=${pair.similarity.toFixed(2)} dist=${pair.importDistance} src=${pair.source}\n`
        + `  A: ${pair.aEndpoint.file}:${pair.aEndpoint.line} ${pair.aEndpoint.name}\n`
        + `  B: ${pair.bEndpoint.file}:${pair.bEndpoint.line} ${pair.bEndpoint.name}`
}

async function main(): Promise<void> {
    process.stdout.write('Discovering packages and source files…\n')
    const packages = await discoverPackages()
    const files = await discoverSourceFiles(packages)
    process.stdout.write(`Extracting functions from ${files.length} files…\n`)
    const records = await extractFunctions(files, path => readFile(path, 'utf8'))
    const recordsById = new Map(records.map(record => [record.id, record]))

    process.stdout.write('Running per-function clustering (minScore=0.7)…\n')
    const perFunction = clusterDuplicates(records, {topK: Number.MAX_SAFE_INTEGER, minScore: 0.7})
    process.stdout.write('Running workflow clustering (minScore=0.3 — matches health test)…\n')
    const workflow = clusterCallDags(records, {topK: Number.MAX_SAFE_INTEGER, minScore: 0.3})

    process.stdout.write('Building import graph…\n')
    const importGraph = await buildImportGraph(packages)
    const importIndex = buildUndirectedImportIndex(importGraph)
    const stats = importIndexStats(importIndex)
    process.stdout.write(`Import graph: ${stats.vertices} vertices, ${stats.edges} undirected edges\n\n`)

    process.stdout.write('=== Sampled diameter estimate (5000 random pairs) ===\n')
    const diam = estimateDiameter(importIndex, 5000)
    process.stdout.write(`Sampled ${diam.sampled} pairs; reachable=${(diam.reachableRate * 100).toFixed(1)}%; max observed hop count=${diam.maxObserved}\n`)
    process.stdout.write(`(Cap is ${MAX_IMPORT_DISTANCE}; if max < cap, the cap is generous.)\n\n`)

    // Build deduped rankable pairs the same way the health test does.
    const byKey = new Map<string, RankablePair>()
    function put(candidate: RankablePair): void {
        const key = candidate.aId < candidate.bId
            ? `${candidate.aId}|${candidate.bId}`
            : `${candidate.bId}|${candidate.aId}`
        const existing = byKey.get(key)
        if (!existing || existing.similarity < candidate.similarity) byKey.set(key, candidate)
    }
    for (const p of perFunction) {
        put({aId: p.aId, bId: p.bId, similarity: p.score, source: 'function'})
    }
    for (const p of workflow.pairs) {
        put({aId: p.aId, bId: p.bId, similarity: p.score, source: 'workflow'})
    }
    const rankable = [...byKey.values()]
    const ranked = rankSeverity(rankable, recordsById, (from, to) =>
        shortestImportDistance(importIndex, from, to))

    process.stdout.write(`=== Severity ranking: ${ranked.length} pairs ===\n`)
    process.stdout.write(`Median severity: ${ranked[Math.floor(ranked.length / 2)].severity.toFixed(2)}\n`)
    process.stdout.write(`Mean severity: ${(ranked.reduce((sum, p) => sum + p.severity, 0) / ranked.length).toFixed(2)}\n\n`)

    process.stdout.write('=== Cumulative recoverable LOC at threshold ===\n')
    for (const t of THRESHOLD_PROBES) {
        const passing = ranked.filter(pair => pair.severity >= t)
        const loc = passing.reduce((sum, pair) => sum + pair.minLoc, 0)
        process.stdout.write(`  threshold=${String(t).padStart(3)} → ${String(passing.length).padStart(4)} pairs, ${String(loc).padStart(5)} LOC\n`)
    }
    process.stdout.write('\n')

    process.stdout.write('=== Probe pair ranks ===\n')
    const ranks = findRanks(ranked, PROBE_NAMES)
    for (const [name, positions] of ranks) {
        if (positions.length === 0) {
            process.stdout.write(`  ${name}: NOT FOUND in any ranked pair\n`)
            continue
        }
        process.stdout.write(`  ${name}: ${positions.length} hit(s) at ranks [${positions.slice(0, 5).join(', ')}${positions.length > 5 ? '…' : ''}]\n`)
        // Print the top hit's full record so the user can see severity etc.
        const top = ranked[positions[0] - 1]
        process.stdout.write(`    top: ${fmtPair(top)}\n`)
    }
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
