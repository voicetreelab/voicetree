import {afterEach, beforeEach, describe, expect, it} from 'vitest'
// IMPORTANT: tests use ts-morph's bundled typescript so SyntaxKind enums
// match what the scorer functions check against. Don't switch to bare
// `typescript` — version drift causes type-predicates to silently fail.
import {ts} from 'ts-morph'
import {__resetRegistryForTesting} from '../../../_shared/measures/registry.ts'
import {buildSyntheticSubgraph, type SyntheticSubgraph} from './_test-helpers.ts'
import {exportedSymbols, exportsPerFileMeasure, EXPORTS_WARN_SOFT} from './exports-per-file.ts'

function parse(text: string): ts.SourceFile {
    return ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true)
}

describe('exportedSymbols (unit)', () => {
    it('returns [] for a file with no exports', () => {
        expect(exportedSymbols(parse('const x = 1'))).toEqual([])
    })

    it('counts a single exported const', () => {
        expect(exportedSymbols(parse('export const x = 1'))).toEqual(['x'])
    })

    it('counts each name in a destructured export', () => {
        expect(exportedSymbols(parse('export const {a, b, c} = obj')).slice().sort()).toEqual(['a', 'b', 'c'])
    })

    it('counts function/class/type/interface/enum declarations once each', () => {
        const src = `
            export function fn() {}
            export class C {}
            export type T = number
            export interface I {}
            export enum E { A }
        `
        expect(exportedSymbols(parse(src)).slice().sort()).toEqual(['C', 'E', 'I', 'T', 'fn'])
    })

    it('counts `export default ...` as a single `default` symbol', () => {
        expect(exportedSymbols(parse('export default 42'))).toEqual(['default'])
        expect(exportedSymbols(parse('export default function foo() {}'))).toEqual(['default'])
    })

    it('counts named re-exports', () => {
        const src = `export {a, b, c} from './other'`
        expect(exportedSymbols(parse(src)).slice().sort()).toEqual(['a', 'b', 'c'])
    })

    it('counts `export * from "..."` as a single synthetic `*:mod` symbol', () => {
        expect(exportedSymbols(parse(`export * from './x'`))).toEqual(['*:./x'])
    })

    it('counts type-only exports (they are still channels)', () => {
        const src = `
            export type A = number
            export type B = string
        `
        expect(exportedSymbols(parse(src)).slice().sort()).toEqual(['A', 'B'])
    })

    it('counts namespace export `export * as X from "..."`', () => {
        const src = `export * as Ns from './x'`
        expect(exportedSymbols(parse(src))).toEqual(['Ns'])
    })

    it('deduplicates symbols re-declared in the same file', () => {
        // export {x}; export {x} from 'mod'
        const src = `
            const x = 1
            export {x}
            export {x as x2} from './other'
        `
        // x (local) + x2 (re-exported alias name) = 2 distinct names
        expect(exportedSymbols(parse(src)).slice().sort()).toEqual(['x', 'x2'])
    })

    it('reproduces the BAD example: barrel with 30+ symbols', () => {
        const names = Array.from({length: 35}, (_, i) => `s${i}`)
        const src = `export {${names.join(', ')}} from './big'`
        expect(exportedSymbols(parse(src))).toHaveLength(35)
    })

    it('reproduces the GOOD example: single deep-function export', () => {
        const src = `export const createGraphStore = (env: any) => ({ add: () => {}, get: () => {}, query: () => {} })`
        expect(exportedSymbols(parse(src))).toEqual(['createGraphStore'])
    })
})

describe('exports-per-file (measure integration)', () => {
    let synth: SyntheticSubgraph

    beforeEach(() => { __resetRegistryForTesting() })
    afterEach(async () => { if (synth) await synth.cleanup() })

    it('reports max-per-community and per-file detail in violation', async () => {
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/lean/store.ts',
                relToSrc: 'lean/store.ts',
                text: 'export const createStore = () => ({})',
            },
            {
                relativePath: 'pkg/src/barrel/index.ts',
                relToSrc: 'barrel/index.ts',
                text: 'export {a,b,c,d,e,f,g,h,i,j,k,l} from "./impl"',
            },
        ])

        const result = await exportsPerFileMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })

        expect(result.measureId).toBe('exports-per-file')
        expect(result.perCommunity['pkg/lean']).toBe(1)
        expect(result.perCommunity['pkg/barrel']).toBe(12)
        expect(result.violations).toHaveLength(1)
        const v = result.violations[0]
        expect(v.community).toBe('pkg/barrel')
        expect(v.severity).toBe('warn')
        expect(v.score).toBe(12)
        expect(v.message).toContain('pkg/src/barrel/index.ts')
    })

    it('emits no violation when every file is under the soft threshold', async () => {
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/clean/a.ts',
                relToSrc: 'clean/a.ts',
                text: 'export const createA = () => 1',
            },
            {
                relativePath: 'pkg/src/clean/b.ts',
                relToSrc: 'clean/b.ts',
                text: 'export function makeB() { return 2 }',
            },
        ])
        const result = await exportsPerFileMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })
        expect(result.perCommunity['pkg/clean']).toBeLessThanOrEqual(EXPORTS_WARN_SOFT)
        expect(result.violations).toEqual([])
    })

    it('takes max across files in a community, not sum', async () => {
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/x/a.ts',
                relToSrc: 'x/a.ts',
                text: 'export const a = 1; export const b = 2; export const c = 3',
            },
            {
                relativePath: 'pkg/src/x/b.ts',
                relToSrc: 'x/b.ts',
                text: 'export const d = 1; export const e = 2',
            },
        ])
        const result = await exportsPerFileMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })
        // max(3, 2) = 3, NOT sum 5
        expect(result.perCommunity['pkg/x']).toBe(3)
    })
})
