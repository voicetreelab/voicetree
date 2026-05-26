/**
 * Orchestrates the duplicate-cluster pipeline:
 *   functions → 3 fingerprints → LSH per signal → pairs hit ≥2 of 3 signals
 *   → weighted exact-Jaccard score → top-K
 *
 * Pure function: takes the records produced by extractFunctions(),
 * returns a sorted list of DuplicatePair. No I/O.
 *
 * The ≥2-of-3 filter is the central noise control — do not skip it.
 * Single-signal hits produce huge numbers of false positives (every
 * `for-of` over an array is a structural match; every async-1-returns-value
 * is a behavioral match).
 */
import type {FunctionRecord} from '../duplication-extract/extract-functions'
import {behavioralFingerprint, BEH_BAND_COUNT, BEH_ROWS_PER_BAND, type BehavioralFingerprint} from '../duplication-fingerprints/behavioral-fingerprint'
import {bucketsToPairs} from './buckets-to-pairs'
import {jaccard} from '../duplication-lsh/jaccard'
import {lexicalFingerprint, LEX_BAND_COUNT, LEX_ROWS_PER_BAND, type LexicalFingerprint} from '../duplication-fingerprints/lexical-fingerprint'
import {decodePairKey, lshBuckets, type SignedItem} from '../duplication-lsh/lsh'
import {structuralFingerprint, type StructuralFingerprint} from '../duplication-fingerprints/structural-fingerprint'

export const STRUCTURAL_WEIGHT: number = 0.3
export const LEXICAL_WEIGHT: number = 0.3
export const BEHAVIORAL_WEIGHT: number = 0.4

export type SignalName = 'structural' | 'lexical' | 'behavioral'

export type DuplicatePair = {
    readonly aId: string
    readonly bId: string
    readonly a: PairEndpoint
    readonly b: PairEndpoint
    readonly structuralJaccard: number
    readonly lexicalJaccard: number
    readonly behavioralJaccard: number
    readonly score: number
    readonly signalsMatched: readonly SignalName[]
}

export type PairEndpoint = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
}

type Fingerprinted = {
    readonly record: FunctionRecord
    readonly structural: StructuralFingerprint
    readonly lexical: LexicalFingerprint
    readonly behavioral: BehavioralFingerprint
}

export type ClusterOptions = {
    readonly topK?: number
    /** Minimum signal hits required to keep a candidate pair. Default 2. */
    readonly minSignalsMatched?: number
    /** Minimum score to include in the returned list. Default 0 (return all). */
    readonly minScore?: number
}

function fingerprint(records: readonly FunctionRecord[]): Fingerprinted[] {
    return records.map(record => ({
        record,
        structural: structuralFingerprint(record.node.body!),
        lexical: lexicalFingerprint(record.tokenStream),
        behavioral: behavioralFingerprint(record.node),
    }))
}

function structuralPairs(items: readonly Fingerprinted[]): Set<string> {
    // Structural fingerprints already collapse to a single hash; treat hash
    // equality as bucket equality. LSH "degenerates" here on purpose — we
    // are deliberately strict on the Type-2 signal.
    const buckets = new Map<number, string[]>()
    for (const item of items) {
        const hash = item.structural.rootHash
        const ids = buckets.get(hash)
        if (ids) ids.push(item.record.id)
        else buckets.set(hash, [item.record.id])
    }
    return bucketsToPairs(buckets).pairs
}

function lexicalPairs(items: readonly Fingerprinted[]): Set<string> {
    const signed: SignedItem[] = items.map(item => ({id: item.record.id, signature: item.lexical.signature}))
    return lshBuckets(signed, {bandCount: LEX_BAND_COUNT, rowsPerBand: LEX_ROWS_PER_BAND})
}

function behavioralPairs(items: readonly Fingerprinted[]): Set<string> {
    const signed: SignedItem[] = items.map(item => ({id: item.record.id, signature: item.behavioral.minhashSignature}))
    return lshBuckets(signed, {bandCount: BEH_BAND_COUNT, rowsPerBand: BEH_ROWS_PER_BAND})
}

function endpointOf(record: FunctionRecord): PairEndpoint {
    return {
        packageName: record.packageName,
        file: record.file,
        line: record.line,
        name: record.name,
    }
}

function shouldDrop(a: FunctionRecord, b: FunctionRecord): boolean {
    // Overloads / same-file same-name pairs are noise — they are usually the
    // same conceptual function declared twice in the same module.
    return a.file === b.file && a.name === b.name
}

export function clusterDuplicates(
    records: readonly FunctionRecord[],
    options: ClusterOptions = {},
): DuplicatePair[] {
    const topK = options.topK ?? 50
    const minSignals = options.minSignalsMatched ?? 2
    const minScore = options.minScore ?? 0

    const items = fingerprint(records)
    const byId = new Map(items.map(item => [item.record.id, item]))

    const structPairs = structuralPairs(items)
    const lexPairs = lexicalPairs(items)
    const behPairs = behavioralPairs(items)

    const allCandidates = new Set<string>()
    for (const key of structPairs) allCandidates.add(key)
    for (const key of lexPairs) allCandidates.add(key)
    for (const key of behPairs) allCandidates.add(key)

    const scored: DuplicatePair[] = []
    for (const key of allCandidates) {
        const [aId, bId] = decodePairKey(key)
        const aItem = byId.get(aId)
        const bItem = byId.get(bId)
        if (!aItem || !bItem) continue
        if (shouldDrop(aItem.record, bItem.record)) continue

        const signals: SignalName[] = []
        if (structPairs.has(key)) signals.push('structural')
        if (lexPairs.has(key)) signals.push('lexical')
        if (behPairs.has(key)) signals.push('behavioral')
        if (signals.length < minSignals) continue

        const structJ = jaccard(aItem.structural.subtreeShapes, bItem.structural.subtreeShapes)
        const lexJ = jaccard(aItem.lexical.shingles, bItem.lexical.shingles)
        const behJ = jaccard(aItem.behavioral.features, bItem.behavioral.features)
        const score = STRUCTURAL_WEIGHT * structJ + LEXICAL_WEIGHT * lexJ + BEHAVIORAL_WEIGHT * behJ
        if (score < minScore) continue

        scored.push({
            aId,
            bId,
            a: endpointOf(aItem.record),
            b: endpointOf(bItem.record),
            structuralJaccard: structJ,
            lexicalJaccard: lexJ,
            behavioralJaccard: behJ,
            score,
            signalsMatched: signals,
        })
    }

    scored.sort((a, b) => b.score - a.score || a.aId.localeCompare(b.aId) || a.bId.localeCompare(b.bId))
    return scored.slice(0, topK)
}
