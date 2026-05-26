#!/usr/bin/env node
/**
 * Diagnostic: look at the fuzzy LSH band of the call-DAG check.
 *
 * The workflow-duplication health test reports only pairs at or above the
 * 0.7 score threshold. With the current 0.6/0.4 weighting, only exact-match
 * pairs can clear 0.7 (max fuzzy-only score is 0.4 * 1.0 = 0.4), so the
 * health test currently shows zero fuzzy hits. This script answers the
 * "is the fuzzy band signal or noise?" question:
 *
 *   (1) Histogram of fuzzy-only candidate pair scores.
 *   (2) Top-30 fuzzy-only pairs by score, with locations + DAG metadata.
 *   (3) Top-5 fuzzy pairs with their edgeSets side-by-side, labelled
 *       [both]/[A-only]/[B-only].
 *
 * No persisted output. Prints to stdout. Invoke from repo root:
 *
 *   node --no-warnings=ExperimentalWarning --experimental-strip-types \
 *     packages/measures/scratch/diagnose-workflow-dups.ts
 *
 * Or (preferred for heavy runs) route via the dev box:
 *
 *   node scripts/run-remote.mjs node --no-warnings=ExperimentalWarning \
 *     --experimental-strip-types \
 *     packages/measures/scratch/diagnose-workflow-dups.ts
 */
import {readFile} from 'node:fs/promises'
import {
    buildCallDagIndex,
    callDagFingerprint,
    type CallDagFingerprint,
} from '../src/duplication-workflow/call-dag-fingerprint.ts'
import {clusterCallDags, type WorkflowPair} from '../src/duplication-workflow/cluster-call-dags.ts'
import {discoverPackages} from '../src/_shared/discovery/discover-packages.ts'
import {discoverSourceFiles} from '../src/_shared/discovery/function-discovery.ts'
import {extractFunctions, type FunctionRecord} from '../src/duplication-extract/extract-functions.ts'

const HISTOGRAM_BUCKETS: number = 10
const TOP_N_FUZZY: number = 30
const EDGESET_DIFF_PAIRS: number = 5

function bucketIndex(score: number): number {
    if (score >= 1) return HISTOGRAM_BUCKETS - 1
    if (score < 0) return 0
    return Math.floor(score * HISTOGRAM_BUCKETS)
}

function formatHistogram(scores: readonly number[]): string {
    const counts: number[] = new Array(HISTOGRAM_BUCKETS).fill(0)
    for (const score of scores) counts[bucketIndex(score)] += 1
    const max = Math.max(1, ...counts)
    const barWidth = 40

    const lines: string[] = []
    lines.push(`Total fuzzy-only candidates: ${scores.length}`)
    lines.push('')
    lines.push('  score range        count      distribution')
    lines.push('  ---------------    -------    ------------------------------')
    for (let bucket = 0; bucket < HISTOGRAM_BUCKETS; bucket += 1) {
        const lower = (bucket / HISTOGRAM_BUCKETS).toFixed(1)
        const upper = ((bucket + 1) / HISTOGRAM_BUCKETS).toFixed(1)
        const count = counts[bucket]
        const bar = '█'.repeat(Math.round((count / max) * barWidth))
        lines.push(`  [${lower}, ${upper})${bucket === HISTOGRAM_BUCKETS - 1 ? ']' : ')'}     ${String(count).padStart(7)}    ${bar}`)
    }
    return lines.join('\n')
}

function formatEndpoint(pair: WorkflowPair, side: 'a' | 'b'): string {
    const endpoint = side === 'a' ? pair.a : pair.b
    return `${endpoint.packageName}:${endpoint.file}:${endpoint.line} ${endpoint.name} [depth=${endpoint.dagDepth},edges=${endpoint.dagEdgeCount}]`
}

function formatFuzzyPair(pair: WorkflowPair): string {
    return `${formatEndpoint(pair, 'a')}\n  ↔  ${formatEndpoint(pair, 'b')}\n  score=${pair.score.toFixed(3)}  edgeJ=${pair.edgeSetJaccard.toFixed(3)}`
}

function diffEdgeSets(setA: ReadonlySet<string>, setB: ReadonlySet<string>): string {
    const both: string[] = []
    const aOnly: string[] = []
    const bOnly: string[] = []
    for (const edge of setA) {
        if (setB.has(edge)) both.push(edge)
        else aOnly.push(edge)
    }
    for (const edge of setB) {
        if (!setA.has(edge)) bOnly.push(edge)
    }
    both.sort()
    aOnly.sort()
    bOnly.sort()

    const lines: string[] = []
    lines.push(`  edges total: A=${setA.size} B=${setB.size}  intersection=${both.length}  union=${setA.size + setB.size - both.length}`)
    for (const edge of both) lines.push(`    [both]    ${edge}`)
    for (const edge of aOnly) lines.push(`    [A-only]  ${edge}`)
    for (const edge of bOnly) lines.push(`    [B-only]  ${edge}`)
    return lines.join('\n')
}

function findRecord(records: readonly FunctionRecord[], id: string): FunctionRecord | undefined {
    return records.find(record => record.id === id)
}

async function main(): Promise<void> {
    process.stdout.write('Discovering packages and source files…\n')
    const packages = await discoverPackages()
    const files = await discoverSourceFiles(packages)
    process.stdout.write(`Extracting functions from ${files.length} files…\n`)
    const records = await extractFunctions(files, path => readFile(path, 'utf8'))
    process.stdout.write(`Extracted ${records.length} functions; clustering call-DAGs…\n`)

    // topK=Infinity so we see the full distribution; minScore=0 to keep all
    // scored fuzzy candidates.
    const result = clusterCallDags(records, {topK: Number.MAX_SAFE_INTEGER, minScore: 0})
    process.stdout.write('\n')
    process.stdout.write(`Stats: totalFunctions=${result.stats.totalFunctions}, nonTrivial=${result.stats.nonTrivialFunctions}, candidatePairs=${result.stats.candidatePairs}, scoredPairs=${result.stats.scoredPairs}\n`)
    process.stdout.write(`Resolution: ${result.stats.unresolvedInternalCalleeTotal} unresolved-internal, ${result.stats.resolutionCollisionTotal} same-name+arity collisions\n`)

    const fuzzyOnly = result.pairs.filter(pair => !pair.exactMatch)
    const fuzzyScores = fuzzyOnly.map(pair => pair.score)

    process.stdout.write('\n=== (1) Score histogram of fuzzy-only candidate pairs ===\n\n')
    process.stdout.write(formatHistogram(fuzzyScores))
    process.stdout.write('\n')

    process.stdout.write(`\n=== (2) Top ${TOP_N_FUZZY} fuzzy-only pairs by score ===\n\n`)
    const topFuzzy = fuzzyOnly.slice(0, TOP_N_FUZZY)
    if (topFuzzy.length === 0) {
        process.stdout.write('  (none — fuzzy band produced no candidate pairs)\n')
    } else {
        for (let index = 0; index < topFuzzy.length; index += 1) {
            process.stdout.write(`#${String(index + 1).padStart(2)}  ${formatFuzzyPair(topFuzzy[index])}\n\n`)
        }
    }

    process.stdout.write(`\n=== (3) Top ${EDGESET_DIFF_PAIRS} fuzzy pairs: edgeSet side-by-side ===\n\n`)
    if (topFuzzy.length === 0) {
        process.stdout.write('  (no fuzzy pairs to dump)\n')
        return
    }
    // Rebuild the DAG index once so we can recover the per-function edgeSet
    // values for printing. The orchestrator does not expose them on the
    // WorkflowPair (we only have the Jaccard ratio) — replaying the cheap
    // index build is the simplest non-invasive way to get them back.
    process.stdout.write('Rebuilding DAG index to recover per-function edgeSets…\n\n')
    const index = buildCallDagIndex(records)
    const fpCache = new Map<string, CallDagFingerprint>()
    function fingerprintFor(record: FunctionRecord): CallDagFingerprint {
        const cached = fpCache.get(record.id)
        if (cached) return cached
        const fp = callDagFingerprint(record, index)
        fpCache.set(record.id, fp)
        return fp
    }

    for (let index2 = 0; index2 < Math.min(EDGESET_DIFF_PAIRS, topFuzzy.length); index2 += 1) {
        const pair = topFuzzy[index2]
        const recA = findRecord(records, pair.aId)
        const recB = findRecord(records, pair.bId)
        process.stdout.write(`-- pair #${index2 + 1} ----------------------------------------------------\n`)
        process.stdout.write(`  A: ${formatEndpoint(pair, 'a')}\n`)
        process.stdout.write(`  B: ${formatEndpoint(pair, 'b')}\n`)
        process.stdout.write(`  score=${pair.score.toFixed(3)}  edgeJ=${pair.edgeSetJaccard.toFixed(3)}\n`)
        if (!recA || !recB) {
            process.stdout.write('  (could not resolve back to FunctionRecord — skipped)\n\n')
            continue
        }
        const fpA = fingerprintFor(recA)
        const fpB = fingerprintFor(recB)
        process.stdout.write(diffEdgeSets(fpA.edgeSet, fpB.edgeSet))
        process.stdout.write('\n\n')
    }
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
