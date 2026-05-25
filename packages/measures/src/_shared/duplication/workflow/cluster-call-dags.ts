/**
 * Call-DAG clustering: turn FunctionRecords into workflow-duplicate pairs.
 *
 * Pipeline:
 *   records → buildCallDagIndex → per-record callDagFingerprint
 *           → filter triviality (small DAGs are noise)
 *           → exact-hash bucket + LSH on edgeSet for fuzzy matches
 *           → score = 0.6 * exactMatch + 0.4 * jaccard(edgeSet)
 *           → drop same-file same-name, sort by score, take top-K
 *
 * Single-signal check: the ≥2-of-3 filter from cluster-duplicates does
 * NOT apply here — we use the score threshold as the noise gate instead.
 * The triviality filter is doing the same job that ≥2-of-3 does for the
 * per-function check.
 */
import {
    buildCallDagIndex,
    callDagFingerprint,
    type CallDagFingerprint,
    type CallDagIndex,
} from './call-dag-fingerprint'
import {bucketsToPairs} from '../per-function/buckets-to-pairs'
import type {FunctionRecord} from '../extract-functions'
import {jaccard} from '../lsh/jaccard'
import {decodePairKey, lshBuckets, type SignedItem} from '../lsh/lsh'
import {minhash} from '../lsh/minhash'

export const EXACT_MATCH_WEIGHT: number = 0.6
export const EDGE_SET_WEIGHT: number = 0.4

/** Skip DAGs with fewer than this many internal-callee children at the root. */
const MIN_ROOT_INTERNAL_CHILDREN: number = 3
/** Skip DAGs whose total node count is too small to carry workflow signal. */
const MIN_DAG_NODE_COUNT: number = 6
/** Skip DAGs whose edge set is too small for the fuzzy signal to be meaningful. */
const MIN_EDGE_SET_SIZE: number = 5

const DAG_MINHASH_PERMUTATIONS: number = 128
const DAG_LSH_BANDS: number = 32
const DAG_LSH_ROWS: number = 4
const DAG_MINHASH_SEED: number = 3

export type WorkflowPair = {
    readonly aId: string
    readonly bId: string
    readonly a: WorkflowEndpoint
    readonly b: WorkflowEndpoint
    readonly exactMatch: boolean
    readonly edgeSetJaccard: number
    readonly score: number
}

export type WorkflowEndpoint = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly dagDepth: number
    readonly dagNodeCount: number
    readonly dagEdgeCount: number
}

export type ClusterCallDagsOptions = {
    readonly topK?: number
    readonly minScore?: number
    readonly dagDepth?: number
}

export type ClusterCallDagsResult = {
    readonly pairs: readonly WorkflowPair[]
    readonly stats: ClusterCallDagsStats
}

export type ClusterCallDagsStats = {
    readonly totalFunctions: number
    readonly nonTrivialFunctions: number
    readonly exactBucketsWithDuplicates: number
    readonly candidatePairs: number
    readonly scoredPairs: number
    readonly unresolvedInternalCalleeTotal: number
    readonly resolutionCollisionTotal: number
}

type DaggedRecord = {
    readonly record: FunctionRecord
    readonly fingerprint: CallDagFingerprint
}

function isTrivial(fp: CallDagFingerprint): boolean {
    if (fp.rootInternalChildCount < MIN_ROOT_INTERNAL_CHILDREN) return true
    if (fp.nodeCount < MIN_DAG_NODE_COUNT) return true
    if (fp.edgeSet.size < MIN_EDGE_SET_SIZE) return true
    return false
}

function endpointOf(dagged: DaggedRecord): WorkflowEndpoint {
    return {
        packageName: dagged.record.packageName,
        file: dagged.record.file,
        line: dagged.record.line,
        name: dagged.record.name,
        dagDepth: dagged.fingerprint.depth,
        dagNodeCount: dagged.fingerprint.nodeCount,
        dagEdgeCount: dagged.fingerprint.edgeSet.size,
    }
}

function shouldDrop(a: FunctionRecord, b: FunctionRecord): boolean {
    return a.file === b.file && a.name === b.name
}

function exactBuckets(items: readonly DaggedRecord[]) {
    const buckets = new Map<number, string[]>()
    for (const item of items) {
        const ids = buckets.get(item.fingerprint.canonicalHash)
        if (ids) ids.push(item.record.id)
        else buckets.set(item.fingerprint.canonicalHash, [item.record.id])
    }
    return bucketsToPairs(buckets)
}

function fuzzyBuckets(items: readonly DaggedRecord[]): Set<string> {
    const signed: SignedItem[] = items.map(item => ({
        id: item.record.id,
        signature: minhash(item.fingerprint.edgeSet, DAG_MINHASH_PERMUTATIONS, DAG_MINHASH_SEED),
    }))
    return lshBuckets(signed, {bandCount: DAG_LSH_BANDS, rowsPerBand: DAG_LSH_ROWS})
}

export function clusterCallDags(
    records: readonly FunctionRecord[],
    options: ClusterCallDagsOptions = {},
): ClusterCallDagsResult {
    const topK = options.topK ?? 50
    const minScore = options.minScore ?? 0
    const dagDepth = options.dagDepth

    const index: CallDagIndex = buildCallDagIndex(records)
    const dagged: DaggedRecord[] = records.map(record => ({
        record,
        fingerprint: callDagFingerprint(record, index, dagDepth !== undefined ? {depth: dagDepth} : undefined),
    }))

    const unresolvedInternalCalleeTotal = dagged.reduce(
        (sum, item) => sum + item.fingerprint.unresolvedInternalCallees, 0,
    )
    const resolutionCollisionTotal = dagged.reduce(
        (sum, item) => sum + item.fingerprint.resolutionCollisions, 0,
    )

    const nonTrivial = dagged.filter(item => !isTrivial(item.fingerprint))
    const byId = new Map(nonTrivial.map(item => [item.record.id, item]))

    const exactResult = exactBuckets(nonTrivial)
    const fuzzyPairs = fuzzyBuckets(nonTrivial)

    const candidatePairs = new Set<string>()
    for (const key of exactResult.pairs) candidatePairs.add(key)
    for (const key of fuzzyPairs) candidatePairs.add(key)

    const scored: WorkflowPair[] = []
    for (const key of candidatePairs) {
        const [aId, bId] = decodePairKey(key)
        const aItem = byId.get(aId)
        const bItem = byId.get(bId)
        if (!aItem || !bItem) continue
        if (shouldDrop(aItem.record, bItem.record)) continue

        const exactMatch = exactResult.pairs.has(key)
        const edgeJ = jaccard(aItem.fingerprint.edgeSet, bItem.fingerprint.edgeSet)
        const score = (exactMatch ? EXACT_MATCH_WEIGHT : 0) + EDGE_SET_WEIGHT * edgeJ
        if (score < minScore) continue

        scored.push({
            aId,
            bId,
            a: endpointOf(aItem),
            b: endpointOf(bItem),
            exactMatch,
            edgeSetJaccard: edgeJ,
            score,
        })
    }

    scored.sort((a, b) => b.score - a.score || a.aId.localeCompare(b.aId) || a.bId.localeCompare(b.bId))
    const trimmed = scored.slice(0, topK)

    return {
        pairs: trimmed,
        stats: {
            totalFunctions: records.length,
            nonTrivialFunctions: nonTrivial.length,
            exactBucketsWithDuplicates: exactResult.bucketsWithDuplicates,
            candidatePairs: candidatePairs.size,
            scoredPairs: scored.length,
            unresolvedInternalCalleeTotal,
            resolutionCollisionTotal,
        },
    }
}
