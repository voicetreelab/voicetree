/**
 * Convert hash-keyed buckets of ids into the set of unordered (id, id) pairs
 * that share a bucket, plus the count of buckets with >= 2 members.
 *
 * Used by both the per-function structural signal (Type-2 exact-hash
 * clustering) and the workflow exact-DAG clustering — they have identical
 * "hash, bucket, emit pairs from any bucket with ≥2 ids" shape.
 */
import {pairKey} from '../lsh/lsh'

export type BucketsResult = {
    readonly pairs: Set<string>
    readonly bucketsWithDuplicates: number
}

export function bucketsToPairs<HashKey>(buckets: ReadonlyMap<HashKey, readonly string[]>): BucketsResult {
    const pairs = new Set<string>()
    let bucketsWithDuplicates = 0
    for (const ids of buckets.values()) {
        if (ids.length < 2) continue
        bucketsWithDuplicates += 1
        const unique = [...new Set(ids)].sort()
        for (let i = 0; i < unique.length; i += 1) {
            for (let j = i + 1; j < unique.length; j += 1) {
                pairs.add(pairKey(unique[i], unique[j]))
            }
        }
    }
    return {pairs, bucketsWithDuplicates}
}
