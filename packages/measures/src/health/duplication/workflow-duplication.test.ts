import {readFile} from 'node:fs/promises'
import {describe, expect, it} from 'vitest'
import {clusterCallDags} from '../../duplication-workflow/cluster-call-dags'
import {extractFunctions} from '../../duplication-extract/extract-functions'
import {formatCallDagRows} from '../../duplication-workflow/format-call-dag-rows'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

// Captured 2026-05-26 on first full-repo run: observed 16 pairs at or above
// the 0.7 score threshold (all exact-match) across 4318 discovered functions
// (868 non-trivial). Budget = observed + 5 headroom so the gate does not
// flap; ratchet DOWN as duplicate workflows are merged, never up.
const MAX_WORKFLOW_DUPLICATE_PAIRS: number = 21

const SCORE_THRESHOLD: number = 0.7

describe('workflow (call-DAG) duplication health', () => {
    it('keeps the count of >=0.7-score call-DAG duplicate pairs within budget', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const records = await extractFunctions(files, path => readFile(path, 'utf8'))
        // topK large enough to see the full distribution; details still
        // store only the top 20.
        const result = clusterCallDags(records, {topK: 100000})
        const overThreshold = result.pairs.filter(pair => pair.score >= SCORE_THRESHOLD)
        const top20 = overThreshold.slice(0, 20)
        const exactMatchesAtThreshold = overThreshold.filter(pair => pair.exactMatch).length

        console.info(`\nTotal functions analysed: ${result.stats.totalFunctions}`)
        console.info(`Non-trivial functions after triviality filter: ${result.stats.nonTrivialFunctions}`)
        console.info(`Exact-hash buckets with >=2 members: ${result.stats.exactBucketsWithDuplicates}`)
        console.info(`Candidate pairs (exact ∪ fuzzy LSH): ${result.stats.candidatePairs}`)
        console.info(`Scored pairs: ${result.stats.scoredPairs}`)
        console.info(`Pairs at or above score ${SCORE_THRESHOLD}: ${overThreshold.length}  (exact: ${exactMatchesAtThreshold})`)
        console.info(`Name-resolution losiness: ${result.stats.unresolvedInternalCalleeTotal} unresolved-internal, ${result.stats.resolutionCollisionTotal} same-name+arity collisions`)
        console.info(`\nTop 20 workflow duplicate pairs:\n${formatCallDagRows(top20)}`)

        await recordHealthMetric({
            metricId: 'workflow-duplicate-pairs',
            metricName: `Workflow Duplicate Pairs (call-DAG, >=${SCORE_THRESHOLD} score)`,
            description: 'Count of function pairs whose call-DAG fingerprints score >= the threshold (0.6 weight for exact hash match, 0.4 weight for edge-set Jaccard). Catches re-implemented multi-function workflows the per-function check cannot see.',
            category: 'Structure',
            current: overThreshold.length,
            budget: MAX_WORKFLOW_DUPLICATE_PAIRS,
            comparison: 'lte',
            unit: 'pairs',
            details: {
                totalFunctions: result.stats.totalFunctions,
                nonTrivialFunctions: result.stats.nonTrivialFunctions,
                fileCount: files.length,
                scoreThreshold: SCORE_THRESHOLD,
                exactMatchesAtThreshold,
                resolution: {
                    unresolvedInternalCalleeTotal: result.stats.unresolvedInternalCalleeTotal,
                    resolutionCollisionTotal: result.stats.resolutionCollisionTotal,
                },
                topPairs: top20.map(pair => ({
                    packageA: pair.a.packageName,
                    fileA: pair.a.file,
                    lineA: pair.a.line,
                    nameA: pair.a.name,
                    dagDepthA: pair.a.dagDepth,
                    dagEdgeCountA: pair.a.dagEdgeCount,
                    packageB: pair.b.packageName,
                    fileB: pair.b.file,
                    lineB: pair.b.line,
                    nameB: pair.b.name,
                    dagDepthB: pair.b.dagDepth,
                    dagEdgeCountB: pair.b.dagEdgeCount,
                    score: Number(pair.score.toFixed(3)),
                    exactMatch: pair.exactMatch,
                    edgeSetJaccard: Number(pair.edgeSetJaccard.toFixed(3)),
                })),
            },
        })

        expect.soft(overThreshold.length).toBeLessThanOrEqual(MAX_WORKFLOW_DUPLICATE_PAIRS)
    }, 180000)
})
