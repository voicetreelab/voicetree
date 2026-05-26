import {describe, expect, it} from 'vitest'
import {decodePairKey, lshBuckets, pairKey} from './lsh'
import {minhash} from './minhash'

describe('lshBuckets', () => {
    it('buckets identical signatures into a candidate pair', () => {
        const sig = [1, 2, 3, 4, 5, 6, 7, 8]
        const pairs = lshBuckets(
            [
                {id: 'a', signature: sig},
                {id: 'b', signature: sig},
            ],
            {bandCount: 2, rowsPerBand: 4},
        )

        expect(pairs.size).toBe(1)
        const [only] = [...pairs]
        const [first, second] = decodePairKey(only)
        expect([first, second].sort()).toEqual(['a', 'b'])
    })

    it('does not produce pairs for fully disjoint signatures', () => {
        const pairs = lshBuckets(
            [
                {id: 'a', signature: [1, 1, 1, 1, 1, 1, 1, 1]},
                {id: 'b', signature: [9, 9, 9, 9, 9, 9, 9, 9]},
            ],
            {bandCount: 2, rowsPerBand: 4},
        )
        expect(pairs.size).toBe(0)
    })

    it('pairs items that share any single band', () => {
        const a = [1, 2, 3, 4, 5, 6, 7, 8]
        const b = [9, 9, 9, 9, 5, 6, 7, 8] // matches band index 1
        const pairs = lshBuckets(
            [
                {id: 'a', signature: a},
                {id: 'b', signature: b},
            ],
            {bandCount: 2, rowsPerBand: 4},
        )
        expect(pairs.size).toBe(1)
    })

    it('produces (n choose 2) pairs when many items collide', () => {
        const sig = [1, 1, 1, 1]
        const pairs = lshBuckets(
            ['a', 'b', 'c', 'd'].map(id => ({id, signature: sig})),
            {bandCount: 1, rowsPerBand: 4},
        )
        // 4 choose 2 = 6
        expect(pairs.size).toBe(6)
    })

    it('emits each unordered pair at most once across multiple band hits', () => {
        const sig = [1, 1, 1, 1, 1, 1, 1, 1]
        const pairs = lshBuckets(
            [
                {id: 'a', signature: sig},
                {id: 'b', signature: sig},
            ],
            {bandCount: 2, rowsPerBand: 4},
        )
        expect(pairs.size).toBe(1)
    })

    it('round-trips with pairKey and decodePairKey for realistic ids', () => {
        const id1 = 'packages/x/src/foo.ts:42:doThing'
        const id2 = 'packages/y/src/bar.ts:7:doOtherThing'
        const key = pairKey(id1, id2)
        const [a, b] = decodePairKey(key)
        expect([a, b].sort()).toEqual([id1, id2].sort())
    })
})

describe('lshBuckets + minhash integration', () => {
    it('discovers high-overlap feature sets as candidate pairs', () => {
        // Two sets sharing 4 of 5 features.
        const a = new Set(['x', 'y', 'z', 'w', 'v'])
        const b = new Set(['x', 'y', 'z', 'w', 'other'])
        const c = new Set(['totally', 'different', 'features', 'here', 'yes'])

        const items = [
            {id: 'a', signature: minhash(a, 128)},
            {id: 'b', signature: minhash(b, 128)},
            {id: 'c', signature: minhash(c, 128)},
        ]
        const pairs = lshBuckets(items, {bandCount: 32, rowsPerBand: 4})

        const decoded = [...pairs].map(decodePairKey).map(([x, y]) => [x, y].sort().join(','))
        expect(decoded).toContain('a,b')
        expect(decoded).not.toContain('a,c')
        expect(decoded).not.toContain('b,c')
    })
})
