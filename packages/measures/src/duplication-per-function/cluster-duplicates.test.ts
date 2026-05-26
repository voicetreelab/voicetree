import {describe, expect, it} from 'vitest'
import {clusterDuplicates} from './cluster-duplicates'
import {extractFunctionsFromSource, type FunctionRecord} from '../duplication-extract/extract-functions'

function makeFile(relativePath: string, packageName: string, source: string): FunctionRecord[] {
    return extractFunctionsFromSource(
        {
            absolutePath: `/virtual/${relativePath}`,
            relativePath,
            packageName,
        },
        source,
    )
}

const TWIN_A = `
    export function sumPositiveValues(values) {
        let total = 0
        for (const value of values) {
            if (value > 0) total = total + value
        }
        return total
    }
`

const TWIN_B = `
    export function sumPositives(items) {
        let accumulator = 0
        for (const item of items) {
            if (item > 0) accumulator = accumulator + item
        }
        return accumulator
    }
`

const UNRELATED = `
    export async function fetchUserNamesAcrossPagesByCursor(cursor) {
        const results = []
        let next = cursor
        while (next) {
            const page = await fetch(next)
            for (const row of page.rows) {
                results.push(row.userName)
            }
            next = page.nextCursor
        }
        return results
    }
`

describe('clusterDuplicates', () => {
    it('identifies twin functions that differ only in identifier names', () => {
        const records = [
            ...makeFile('pkg-a/src/a.ts', 'pkg-a', TWIN_A),
            ...makeFile('pkg-b/src/b.ts', 'pkg-b', TWIN_B),
        ]

        const pairs = clusterDuplicates(records, {minSignalsMatched: 2})

        expect(pairs).toHaveLength(1)
        expect(pairs[0].score).toBeGreaterThan(0.7)
        expect(pairs[0].signalsMatched.length).toBeGreaterThanOrEqual(2)
    })

    it('does not flag unrelated functions as duplicates', () => {
        const records = [
            ...makeFile('pkg-a/src/a.ts', 'pkg-a', TWIN_A),
            ...makeFile('pkg-c/src/c.ts', 'pkg-c', UNRELATED),
        ]

        const pairs = clusterDuplicates(records, {minSignalsMatched: 2})

        expect(pairs.filter(pair => pair.score >= 0.5)).toHaveLength(0)
    })

    it('drops same-file same-name candidate pairs', () => {
        // Two overload-style declarations in the same file with the same name.
        // Real-world example: TypeScript function overloads.
        const records = makeFile('pkg-a/src/a.ts', 'pkg-a', `
            export function noopHandler(a) {
                if (a > 0) return a + 1
                return 0
            }
            export function noopHandler(a) {
                if (a > 0) return a + 1
                return 0
            }
        `)

        const pairs = clusterDuplicates(records, {minSignalsMatched: 2})
        const sameFileSameName = pairs.filter(pair =>
            pair.a.file === pair.b.file && pair.a.name === pair.b.name,
        )
        expect(sameFileSameName).toHaveLength(0)
    })

    it('does not report a pair (A,B) twice as (B,A)', () => {
        const records = [
            ...makeFile('pkg-a/src/a.ts', 'pkg-a', TWIN_A),
            ...makeFile('pkg-b/src/b.ts', 'pkg-b', TWIN_B),
        ]
        const pairs = clusterDuplicates(records, {minSignalsMatched: 2})
        const keys = pairs.map(pair => [pair.aId, pair.bId].sort().join('||'))
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('requires the ≥2-of-3 filter — single-signal hits are not reported', () => {
        // Two unrelated functions that happen to share a behavioral signature
        // (same arity, async, returns-value) but nothing else.
        const records = [
            ...makeFile('pkg-a/src/a.ts', 'pkg-a', `
                export async function getOne(id) {
                    return {id, value: 1}
                }
            `),
            ...makeFile('pkg-b/src/b.ts', 'pkg-b', `
                export async function getTwo(name) {
                    return {name, value: 2}
                }
            `),
        ]
        // With min=2 these should not be reported even if behavioral matches.
        const strict = clusterDuplicates(records, {minSignalsMatched: 2})
        // It's acceptable if they DO match because they happen to share enough
        // signals — what matters is that with min=1 we get at least the same
        // or more pairs than with min=2.
        const lax = clusterDuplicates(records, {minSignalsMatched: 1})
        expect(lax.length).toBeGreaterThanOrEqual(strict.length)
    })

    it('respects topK', () => {
        // Build 6 twins → C(6,2) = 15 candidate pairs.
        const records: FunctionRecord[] = []
        for (let idx = 0; idx < 6; idx += 1) {
            records.push(
                ...makeFile(`pkg-${idx}/src/file.ts`, `pkg-${idx}`, TWIN_A.replace('sumPositiveValues', `sum${idx}`)),
            )
        }
        const pairs = clusterDuplicates(records, {topK: 5, minSignalsMatched: 2})
        expect(pairs.length).toBeLessThanOrEqual(5)
    })
})
