import {describe, expect, it} from 'vitest'
import {extractFunctionsFromSource, type FunctionRecord} from '../duplication-extract/extract-functions.ts'
import {
    functionLoc,
    rankSeverity,
    severityHistogram,
    type RankablePair,
} from './severity-ranking.ts'

function makeRecords(relativePath: string, packageName: string, source: string): FunctionRecord[] {
    return extractFunctionsFromSource(
        {absolutePath: `/virtual/${relativePath}`, relativePath, packageName},
        source,
    )
}

function recordsById(records: readonly FunctionRecord[]): Map<string, FunctionRecord> {
    return new Map(records.map(record => [record.id, record]))
}

const TWO_LINE_BODY = `
    export function smallA(value, base) {
        if (value < 0) return base
        const next = value + base
        const doubled = next * 2
        return doubled
    }
`

const TEN_LINE_BODY = `
    export function bigA(values, base) {
        const total = values.reduce((acc, value) => acc + value, 0)
        if (total < 0) return base
        let accumulator = base
        for (const value of values) {
            accumulator = accumulator + value
            if (accumulator > 100) {
                accumulator = 100
            }
        }
        return accumulator
    }
`

const TEN_LINE_BODY_RENAMED = `
    export function bigB(items, seed) {
        const total = items.reduce((acc, item) => acc + item, 0)
        if (total < 0) return seed
        let accumulator = seed
        for (const item of items) {
            accumulator = accumulator + item
            if (accumulator > 100) {
                accumulator = 100
            }
        }
        return accumulator
    }
`

describe('functionLoc', () => {
    it('returns the line count of the whole declaration span', () => {
        const [record] = makeRecords('a.ts', 'pkg-a', TEN_LINE_BODY)
        // 12 source lines from `export function bigA` through the closing
        // brace (template-string indentation included). Count what extractor
        // sees rather than hardcoding so this test stays robust to spacing.
        const expected = TEN_LINE_BODY.split('\n').filter(line => line.trim().length > 0).length
        expect(functionLoc(record)).toBe(expected)
    })
})

describe('rankSeverity', () => {
    const small = makeRecords('pkgA/src/small.ts', 'pkg-a', TWO_LINE_BODY)[0]
    const bigA = makeRecords('pkgA/src/bigA.ts', 'pkg-a', TEN_LINE_BODY)[0]
    const bigB = makeRecords('pkgB/src/bigB.ts', 'pkg-b', TEN_LINE_BODY_RENAMED)[0]

    const records = recordsById([small, bigA, bigB])

    const sameFileDistance = () => 0
    const oneHopDistance = () => 1
    const unreachableDistance = () => 8

    it('multiplies mass × similarity × log2(2 + distance)', () => {
        const pair: RankablePair = {
            aId: bigA.id,
            bId: bigB.id,
            similarity: 0.9,
            source: 'function',
        }
        const [ranked] = rankSeverity([pair], records, oneHopDistance)
        const expected = Math.min(functionLoc(bigA), functionLoc(bigB)) * 0.9 * Math.log2(3)
        expect(ranked.severity).toBeCloseTo(expected, 6)
        expect(ranked.importDistance).toBe(1)
        expect(ranked.minLoc).toBe(Math.min(functionLoc(bigA), functionLoc(bigB)))
    })

    it('ranks a large cross-module dup higher than a small same-file sibling at the same similarity', () => {
        const crossModule: RankablePair = {
            aId: bigA.id,
            bId: bigB.id,
            similarity: 0.9,
            source: 'function',
        }
        const sameFileSmall: RankablePair = {
            aId: small.id,
            bId: bigA.id,
            similarity: 0.9,
            source: 'function',
        }
        const distance = (from: string, to: string): number => from === to ? 0 : 8
        const ranked = rankSeverity([crossModule, sameFileSmall], records, distance)
        expect(ranked[0].aId).toBe(bigA.id)
        expect(ranked[0].bId).toBe(bigB.id)
    })

    it('weights an unreachable cross-module pair higher than a same-file one of the same mass', () => {
        const pair: RankablePair = {
            aId: bigA.id,
            bId: bigB.id,
            similarity: 1.0,
            source: 'function',
        }
        const [sameFile] = rankSeverity([pair], records, sameFileDistance)
        const [unreachable] = rankSeverity([pair], records, unreachableDistance)
        expect(unreachable.severity).toBeGreaterThan(sameFile.severity)
        // log2(2+0)=1, log2(2+8)=log2(10) ≈ 3.32
        const expectedRatio = Math.log2(10) / Math.log2(2)
        expect(unreachable.severity / sameFile.severity).toBeCloseTo(expectedRatio, 3)
    })

    it('sorts by severity descending', () => {
        const pairs: RankablePair[] = [
            {aId: small.id, bId: bigA.id, similarity: 0.5, source: 'function'},
            {aId: bigA.id, bId: bigB.id, similarity: 0.9, source: 'function'},
        ]
        const ranked = rankSeverity(pairs, records, oneHopDistance)
        expect(ranked.map(pair => pair.aId)).toEqual([bigA.id, small.id])
    })

    it('drops pairs whose endpoints are not in the records index', () => {
        const pairs: RankablePair[] = [
            {aId: bigA.id, bId: 'missing:1:fn', similarity: 0.9, source: 'function'},
        ]
        expect(rankSeverity(pairs, records, oneHopDistance)).toHaveLength(0)
    })

    it('attaches LOC to both endpoints in the output', () => {
        const pair: RankablePair = {
            aId: bigA.id,
            bId: bigB.id,
            similarity: 0.9,
            source: 'function',
        }
        const [ranked] = rankSeverity([pair], records, oneHopDistance)
        expect(ranked.aEndpoint.loc).toBe(functionLoc(bigA))
        expect(ranked.bEndpoint.loc).toBe(functionLoc(bigB))
    })

    it('preserves the source tag and any extra payload', () => {
        const pair: RankablePair = {
            aId: bigA.id,
            bId: bigB.id,
            similarity: 0.9,
            source: 'workflow',
            extra: {edgeJ: 0.93, exactMatch: false},
        }
        const [ranked] = rankSeverity([pair], records, oneHopDistance)
        expect(ranked.source).toBe('workflow')
        expect(ranked.extra).toEqual({edgeJ: 0.93, exactMatch: false})
    })

    it('produces severity = 0 when similarity = 0', () => {
        const pair: RankablePair = {
            aId: bigA.id,
            bId: bigB.id,
            similarity: 0,
            source: 'function',
        }
        const [ranked] = rankSeverity([pair], records, unreachableDistance)
        expect(ranked.severity).toBe(0)
    })
})

describe('severityHistogram', () => {
    const small = makeRecords('a/src/small.ts', 'pkg-a', TWO_LINE_BODY)[0]
    const bigA = makeRecords('a/src/bigA.ts', 'pkg-a', TEN_LINE_BODY)[0]
    const bigB = makeRecords('b/src/bigB.ts', 'pkg-b', TEN_LINE_BODY_RENAMED)[0]
    const records = recordsById([small, bigA, bigB])

    it('returns an empty list for an empty input', () => {
        expect(severityHistogram([], 5)).toEqual([])
    })

    it('buckets ranked pairs at the requested width', () => {
        const ranked = rankSeverity(
            [
                {aId: bigA.id, bId: bigB.id, similarity: 1.0, source: 'function'},
                {aId: small.id, bId: bigA.id, similarity: 0.5, source: 'function'},
            ],
            records,
            () => 1,
        )
        const histogram = severityHistogram(ranked, 5)
        const total = histogram.reduce((sum, bucket) => sum + bucket.count, 0)
        expect(total).toBe(ranked.length)
        for (const bucket of histogram) {
            expect(bucket.upper - bucket.lower).toBeCloseTo(5, 9)
        }
    })

    it('rejects non-positive bucket widths', () => {
        const ranked = rankSeverity(
            [{aId: bigA.id, bId: bigB.id, similarity: 1.0, source: 'function'}],
            records,
            () => 1,
        )
        expect(() => severityHistogram(ranked, 0)).toThrow()
        expect(() => severityHistogram(ranked, -1)).toThrow()
    })
})
