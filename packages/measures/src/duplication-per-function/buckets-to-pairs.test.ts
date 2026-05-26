import {describe, expect, it} from 'vitest'
import {bucketsToPairs} from './buckets-to-pairs'
import {decodePairKey} from '../duplication-lsh/lsh'

describe('bucketsToPairs', () => {
    it('produces unordered pairs for buckets with >=2 ids', () => {
        const buckets = new Map<number, string[]>([
            [1, ['a', 'b']],
            [2, ['c', 'd', 'e']],
        ])
        const {pairs, bucketsWithDuplicates} = bucketsToPairs(buckets)
        expect(bucketsWithDuplicates).toBe(2)
        // 1 pair from bucket 1 + 3 pairs from bucket 2 = 4
        expect(pairs.size).toBe(4)
    })

    it('ignores singleton buckets', () => {
        const buckets = new Map<number, string[]>([
            [1, ['a']],
            [2, ['b']],
            [3, ['c', 'd']],
        ])
        const {pairs, bucketsWithDuplicates} = bucketsToPairs(buckets)
        expect(bucketsWithDuplicates).toBe(1)
        expect(pairs.size).toBe(1)
        const [[only0, only1]] = [...pairs].map(decodePairKey)
        expect([only0, only1].sort()).toEqual(['c', 'd'])
    })

    it('dedupes repeated ids inside a single bucket', () => {
        const buckets = new Map<number, string[]>([
            [1, ['a', 'a', 'b']],
        ])
        const {pairs} = bucketsToPairs(buckets)
        expect(pairs.size).toBe(1)
    })

    it('returns empty for an empty input', () => {
        const {pairs, bucketsWithDuplicates} = bucketsToPairs(new Map())
        expect(pairs.size).toBe(0)
        expect(bucketsWithDuplicates).toBe(0)
    })
})
