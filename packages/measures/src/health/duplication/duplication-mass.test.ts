import {describe, expect, it} from 'vitest'
import {clusterCallDags} from '../../_shared/duplication/cluster-call-dags.ts'
import {clusterDuplicates} from '../../_shared/duplication/cluster-duplicates.ts'
import {extractFunctions} from '../../_shared/duplication/extract-functions.ts'
import {
    rankSeverity,
    severityHistogram,
    type RankablePair,
    type SeverityRankedPair,
} from '../../_shared/duplication/severity-ranking.ts'
import {discoverPackages} from '../../_shared/discovery/discover-packages.ts'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery.ts'
import {
    buildUndirectedImportIndex,
    importIndexStats,
    MAX_IMPORT_DISTANCE,
    shortestImportDistance,
} from '../../_shared/graph/import-distance.ts'
import {buildImportGraph} from '../../_shared/graph/import-graph.ts'
import {recordHealthMetric} from '../../_shared/writers/report-writer.ts'

// Captured 2026-05-26 on first calibration run.
//
// Severity threshold rationale: we picked a value just below the median
// severity of the per-function check's >= 0.7 pairs. That admits cross-tier
// re-implementations (e.g. daemon vs shell pipelines), keeps same-file
// siblings out (they get importDistance = 0 → log2(2) = 1 weight floor),
// and biases the metric toward genuinely-recoverable mass. Adjust this
// before tightening the budget — keep them in sync.
const SEVERITY_THRESHOLD: number = 20

// Captured 2026-05-26 first full-repo run:
//   569 deduped rankable pairs (549 per-function + 40 workflow incl
//     fuzzy band; ~20 pairs surfaced only by the workflow signal)
//   import graph: 922 vertices, 1953 undirected edges
//     sampled diameter: max-observed-hops=7 (cap=8 is generous)
//     52.5% of random module pairs are reachable; 47.5% land at the cap
//   distance buckets across the ranked pairs: 110 same-file,
//     121 unreachable (cap=8)
//   pairs at or above severity threshold (20): 111
//   recoverable LOC: 2525
// Budget = current + 50 headroom per spec. Ratchet DOWN as duplicates
// merge, never up.
const MAX_RECOVERABLE_LOC: number = 2575

const PER_FUNCTION_MIN_SCORE: number = 0.7
// The workflow check's fuzzy band caps at score 0.40 (max=0.6×0+0.4×1.0)
// per the workflow diagnostic, with a long noise tail below 0.20. 0.30
// admits the genuine high-edgeJ near-dups (e.g. daemon vs shell
// getAvailableFoldersForSelector at edgeJ=0.93 → score 0.37) without
// dragging in single-band LSH-collision noise.
const WORKFLOW_MIN_SCORE: number = 0.3

function makeRankablePairs(
    perFunctionPairs: ReadonlyArray<{readonly aId: string; readonly bId: string; readonly score: number}>,
    workflowPairs: ReadonlyArray<{
        readonly aId: string
        readonly bId: string
        readonly score: number
        readonly exactMatch: boolean
        readonly edgeSetJaccard: number
    }>,
): RankablePair[] {
    // Deduplicate by canonical pair-id so a pair surfaced by both checks
    // does not double-count toward recoverable LOC. Prefer the higher-
    // similarity record so the severity ranking sees the strongest signal
    // we have for that pair.
    const byKey = new Map<string, RankablePair>()
    function put(candidate: RankablePair): void {
        const key = candidate.aId < candidate.bId
            ? `${candidate.aId}|${candidate.bId}`
            : `${candidate.bId}|${candidate.aId}`
        const existing = byKey.get(key)
        if (!existing || existing.similarity < candidate.similarity) {
            byKey.set(key, candidate)
        }
    }
    for (const pair of perFunctionPairs) {
        put({aId: pair.aId, bId: pair.bId, similarity: pair.score, source: 'function'})
    }
    for (const pair of workflowPairs) {
        put({
            aId: pair.aId,
            bId: pair.bId,
            similarity: pair.score,
            source: 'workflow',
            extra: {exactMatch: pair.exactMatch, edgeSetJaccard: pair.edgeSetJaccard},
        })
    }
    return [...byKey.values()]
}

function formatTopRows(pairs: readonly SeverityRankedPair[]): string {
    return pairs.map(pair =>
        `  sev=${pair.severity.toFixed(1).padStart(6)}  loc=${String(pair.minLoc).padStart(3)}  sim=${pair.similarity.toFixed(2)}  dist=${pair.importDistance}  src=${pair.source.padEnd(8)}`
        + ` ${pair.aEndpoint.file}:${pair.aEndpoint.line} ${pair.aEndpoint.name}`
        + `  ↔  ${pair.bEndpoint.file}:${pair.bEndpoint.line} ${pair.bEndpoint.name}`,
    ).join('\n')
}

function formatHistogram(buckets: ReadonlyArray<{lower: number; upper: number; count: number}>, topN: number): string {
    if (buckets.length === 0) return '  (no pairs)'
    const max = Math.max(1, ...buckets.map(bucket => bucket.count))
    return buckets.slice(0, topN).map(bucket => {
        const bar = '█'.repeat(Math.round((bucket.count / max) * 40))
        return `  [${bucket.lower.toFixed(0).padStart(5)}, ${bucket.upper.toFixed(0).padStart(5)})  ${String(bucket.count).padStart(5)}  ${bar}`
    }).join('\n')
}

describe('duplication-recoverable-loc health', () => {
    it('keeps severity-weighted recoverable LOC within budget', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const records = await extractFunctions(files)
        const recordsById = new Map(records.map(record => [record.id, record]))

        // Pull pairs from BOTH existing checks. Use the same thresholds the
        // standalone health tests use for the per-function check; pull the
        // workflow check's fuzzy band as well so high-distance/high-edgeJ
        // pairs are eligible for severity weighting.
        const perFunctionPairs = clusterDuplicates(records, {
            topK: Number.MAX_SAFE_INTEGER,
            minScore: PER_FUNCTION_MIN_SCORE,
        })
        const workflowResult = clusterCallDags(records, {
            topK: Number.MAX_SAFE_INTEGER,
            minScore: WORKFLOW_MIN_SCORE,
        })

        const importGraph = await buildImportGraph(packages)
        const importIndex = buildUndirectedImportIndex(importGraph)
        const importStats = importIndexStats(importIndex)
        const importDistance = (from: string, to: string): number =>
            shortestImportDistance(importIndex, from, to)

        const rankable = makeRankablePairs(perFunctionPairs, workflowResult.pairs)
        const ranked = rankSeverity(rankable, recordsById, importDistance)

        const aboveThreshold = ranked.filter(pair => pair.severity >= SEVERITY_THRESHOLD)
        const recoverableLoc = aboveThreshold.reduce((sum, pair) => sum + pair.minLoc, 0)
        const top20 = ranked.slice(0, 20)
        const histogram = severityHistogram(ranked, 25)

        // Diagnostic counts: how many unreachable / disconnected endpoints.
        const unreachable = ranked.filter(pair => pair.importDistance === MAX_IMPORT_DISTANCE).length
        const sameFile = ranked.filter(pair => pair.importDistance === 0).length

        console.info(`\nPair sources: function=${perFunctionPairs.length} workflow=${workflowResult.pairs.length} → deduped rankable=${rankable.length}`)
        console.info(`Import graph: ${importStats.vertices} vertices, ${importStats.edges} undirected edges`)
        console.info(`Distance buckets: sameFile=${sameFile}, atCap(${MAX_IMPORT_DISTANCE})=${unreachable}`)
        console.info(`Severity threshold: ${SEVERITY_THRESHOLD}`)
        console.info(`Pairs at or above threshold: ${aboveThreshold.length}`)
        console.info(`Recoverable LOC at threshold: ${recoverableLoc}\n`)
        console.info('Severity histogram (bucket width=25, first 8 buckets):')
        console.info(formatHistogram(histogram, 8))
        console.info(`\nTop 20 by severity:\n${formatTopRows(top20)}`)

        await recordHealthMetric({
            metricId: 'duplication-recoverable-loc',
            metricName: 'Recoverable LOC (severity-weighted duplication mass)',
            description: 'Sum of min(loc_A, loc_B) across all per-function and call-DAG duplicate pairs whose severity (mass × similarity × log2(2 + import-distance)) meets the threshold. An estimate of LOC that could be deleted by merging duplicates.',
            category: 'Structure',
            current: recoverableLoc,
            budget: MAX_RECOVERABLE_LOC,
            comparison: 'lte',
            unit: 'loc',
            details: {
                severityThreshold: SEVERITY_THRESHOLD,
                pairsAtOrAboveThreshold: aboveThreshold.length,
                perFunctionPairs: perFunctionPairs.length,
                workflowPairs: workflowResult.pairs.length,
                dedupedRankable: rankable.length,
                importGraph: importStats,
                sameFilePairs: sameFile,
                unreachablePairs: unreachable,
                topPairs: top20.map(pair => ({
                    packageA: pair.aEndpoint.packageName,
                    fileA: pair.aEndpoint.file,
                    lineA: pair.aEndpoint.line,
                    nameA: pair.aEndpoint.name,
                    locA: pair.aEndpoint.loc,
                    packageB: pair.bEndpoint.packageName,
                    fileB: pair.bEndpoint.file,
                    lineB: pair.bEndpoint.line,
                    nameB: pair.bEndpoint.name,
                    locB: pair.bEndpoint.loc,
                    similarity: Number(pair.similarity.toFixed(3)),
                    importDistance: pair.importDistance,
                    severity: Number(pair.severity.toFixed(2)),
                    source: pair.source,
                })),
            },
        })

        expect.soft(recoverableLoc).toBeLessThanOrEqual(MAX_RECOVERABLE_LOC)
    }, 180000)
})
