import {describe, it} from 'vitest'
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
import {assertHealthBudget, recordHealthMetric} from '../../_shared/writers/report-writer.ts'

// Severity threshold for the recoverable-LOC denominator. Set just below the
// median severity of the per-function check's >= 0.7 pairs. Admits cross-
// tier re-implementations (e.g. daemon vs shell pipelines), keeps same-file
// siblings out (importDistance = 0 → log2(2) = 1 weight floor), biases the
// metric toward genuinely-recoverable mass. Adjust this BEFORE tightening
// the hard-gate budget — keep them in sync.
const SEVERITY_THRESHOLD: number = 20

// Hard gate: any PR that increases this fails. Ratchet down as refactors
// land; never up.
//
// Captured 2026-05-26 first full-repo calibration run:
//   569 deduped rankable pairs (549 per-function + 40 workflow incl
//     fuzzy band; ~20 pairs surfaced only by the workflow signal)
//   import graph: 922 vertices, 1953 undirected edges
//     sampled diameter: max-observed-hops=7 (cap=8 is generous)
//     52.5% of random module pairs are reachable
//   ranked-pair distance buckets: 110 same-file, 121 unreachable
//   pairs at or above SEVERITY_THRESHOLD: 111
//   recoverable LOC at SEVERITY_THRESHOLD: 2525  ← hard gate value
const MAX_RECOVERABLE_LOC: number = 2525

// High-severity warning tier. Picks the dominant tail of the severity
// distribution (the cumulative curve at sev>=50 was 23 pairs / 884 LOC on
// the first calibration run — the most obviously-recoverable mass).
//
// HIGH_SEVERITY_CUTOFF = 50 is the histogram knee — pairs of this severity
// are dominated by large cross-package or unreachable-module dups. Below 50
// is the dense [25, 50) bucket of medium-sized internal twins.
//
// MAX_HIGH_SEVERITY_LOC = 200 is intentionally well below the current 884:
// the warning is meant to over-fire while the worst offenders (the 152-
// line popup pair alone is ~152 LOC) are still around. Once those land, a
// realistic ratchet target is ~100-150.
const HIGH_SEVERITY_CUTOFF: number = 50
const MAX_HIGH_SEVERITY_LOC: number = 200

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

/**
 * Build the `formattedSummary` `assertHealthBudget` expects:
 *   empty string → metric is within budget, do nothing
 *   non-empty    → human-readable breach summary + top offenders
 *
 * Format kept short on purpose — `assertHealthBudget` puts this directly
 * into the vitest failure message for `severity='gate'` and into the
 * dashboard warning line for `severity='warning'`.
 */
function breachSummary(
    metricId: string,
    current: number,
    budget: number,
    unit: string,
    topOffenders: readonly SeverityRankedPair[],
): string {
    if (current <= budget) return ''
    return [
        `${metricId}: ${current} ${unit} > budget ${budget} (over by ${current - budget})`,
        `Top offenders:`,
        formatTopRows(topOffenders),
    ].join('\n')
}

function pairDetailFor(pair: SeverityRankedPair): Record<string, unknown> {
    return {
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
    }
}

describe('duplication mass health', () => {
    it('reports recoverable-LOC hard gate + high-severity warning', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const records = await extractFunctions(files)
        const recordsById = new Map(records.map(record => [record.id, record]))

        // Pull pairs from BOTH existing checks. Use the same threshold the
        // per-function health test uses; admit the workflow check's fuzzy
        // band per the workflow diagnostic so high-distance / high-edgeJ
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

        // Single rank pass; both metrics filter from the same result.
        const rankable = makeRankablePairs(perFunctionPairs, workflowResult.pairs)
        const ranked = rankSeverity(rankable, recordsById, importDistance)

        // Metric 1: hard gate over the recoverable-LOC denominator.
        const aboveThreshold = ranked.filter(pair => pair.severity >= SEVERITY_THRESHOLD)
        const recoverableLoc = aboveThreshold.reduce((sum, pair) => sum + pair.minLoc, 0)
        const top20Mass = ranked.slice(0, 20)

        // Metric 2: warning over the high-severity LOC tail.
        const highSeverity = ranked.filter(pair => pair.severity >= HIGH_SEVERITY_CUTOFF)
        const highSeverityLoc = highSeverity.reduce((sum, pair) => sum + pair.minLoc, 0)
        const top20HighSeverity = highSeverity.slice(0, 20)

        // Distance-bucket diagnostics — useful when investigating a breach.
        const unreachable = ranked.filter(pair => pair.importDistance === MAX_IMPORT_DISTANCE).length
        const sameFile = ranked.filter(pair => pair.importDistance === 0).length
        const histogram = severityHistogram(ranked, 25)

        console.info(`\nPair sources: function=${perFunctionPairs.length} workflow=${workflowResult.pairs.length} → deduped rankable=${rankable.length}`)
        console.info(`Import graph: ${importStats.vertices} vertices, ${importStats.edges} undirected edges`)
        console.info(`Distance buckets: sameFile=${sameFile}, atCap(${MAX_IMPORT_DISTANCE})=${unreachable}`)
        console.info(`\n[gate]    SEVERITY_THRESHOLD=${SEVERITY_THRESHOLD}  → ${aboveThreshold.length} pairs, ${recoverableLoc} LOC  (budget ${MAX_RECOVERABLE_LOC})`)
        console.info(`[warning] HIGH_SEVERITY_CUTOFF=${HIGH_SEVERITY_CUTOFF}  → ${highSeverity.length} pairs, ${highSeverityLoc} LOC  (budget ${MAX_HIGH_SEVERITY_LOC})`)
        console.info('\nSeverity histogram (bucket width=25, first 8 buckets):')
        console.info(formatHistogram(histogram, 8))
        console.info(`\nTop 20 by severity:\n${formatTopRows(top20Mass)}`)
        if (highSeverity.length > 0) {
            console.info(`\nHigh-severity tail (sev>=${HIGH_SEVERITY_CUTOFF}, top 20):\n${formatTopRows(top20HighSeverity)}`)
        }

        await recordHealthMetric({
            metricId: 'duplication-recoverable-loc',
            metricName: 'Recoverable LOC (severity-weighted duplication mass)',
            description: 'Sum of min(loc_A, loc_B) across per-function and call-DAG duplicate pairs whose severity (mass × similarity × log2(2 + import-distance)) meets the threshold. Hard gate: any PR that increases this fails. Ratchet down only.',
            category: 'Structure',
            current: recoverableLoc,
            budget: MAX_RECOVERABLE_LOC,
            comparison: 'lte',
            severity: 'gate',
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
                topPairs: top20Mass.map(pairDetailFor),
            },
        })

        await recordHealthMetric({
            metricId: 'duplication-high-severity-loc',
            metricName: `High-severity duplication LOC (severity >= ${HIGH_SEVERITY_CUTOFF})`,
            description: `Sum of min(loc_A, loc_B) across duplicate pairs whose severity is at or above the high-severity cutoff (${HIGH_SEVERITY_CUTOFF}). Warning-only: surfaces the dominant tail of mass × similarity × log-distance so operators can see the largest concrete refactor targets even when the overall recoverable-LOC gate is satisfied.`,
            category: 'Structure',
            current: highSeverityLoc,
            budget: MAX_HIGH_SEVERITY_LOC,
            comparison: 'lte',
            severity: 'warning',
            unit: 'loc',
            details: {
                highSeverityCutoff: HIGH_SEVERITY_CUTOFF,
                pairsAtOrAboveCutoff: highSeverity.length,
                topPairs: top20HighSeverity.map(pairDetailFor),
            },
        })

        // Gate first (fails the test on breach), then warning (only logs).
        assertHealthBudget({
            metricId: 'duplication-recoverable-loc',
            formattedSummary: breachSummary(
                'duplication-recoverable-loc',
                recoverableLoc,
                MAX_RECOVERABLE_LOC,
                'loc',
                top20Mass.slice(0, 10),
            ),
            severity: 'gate',
        })
        assertHealthBudget({
            metricId: 'duplication-high-severity-loc',
            formattedSummary: breachSummary(
                'duplication-high-severity-loc',
                highSeverityLoc,
                MAX_HIGH_SEVERITY_LOC,
                'loc',
                top20HighSeverity.slice(0, 10),
            ),
            severity: 'warning',
        })
    }, 180000)
})
