import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {__resetRegistryForTesting} from '../../../_shared/measures/registry.ts'
import {buildSyntheticSubgraph, type SyntheticSubgraph} from './_test-helpers.ts'
import {cyclomaticPerFnMeasure, scoreCyclomatic, CYCLOMATIC_WARN_SOFT} from './cyclomatic-per-fn.ts'
// IMPORTANT: tests use ts-morph's bundled typescript so SyntaxKind enums
// match what the scorer functions check against. Don't switch to bare
// `typescript` — version drift causes type-predicates to silently fail.
import {ts} from 'ts-morph'

function parseFn(text: string): ts.FunctionLikeDeclaration {
    const sf = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true)
    let found: ts.FunctionLikeDeclaration | null = null
    function visit(node: ts.Node): void {
        if (found) return
        if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
            || ts.isMethodDeclaration(node)) {
            found = node
            return
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sf, visit)
    if (!found) throw new Error('no function found in test source')
    return found
}

describe('scoreCyclomatic (unit)', () => {
    it('returns 1 for a function with no decision points', () => {
        expect(scoreCyclomatic(parseFn('function f() { return 1 }'))).toBe(1)
    })

    it('counts a single if as +1', () => {
        expect(scoreCyclomatic(parseFn('function f(x) { if (x) return 1; return 0 }'))).toBe(2)
    })

    it('counts if/else-if/else as +3 (one per condition; final else is free)', () => {
        // if (1 decision) + else if -> nested IfStatement (1 decision) = 2 more
        const score = scoreCyclomatic(parseFn(`function f(s) {
            if (s === 'a') return 1
            else if (s === 'b') return 2
            else if (s === 'c') return 3
            else return 4
        }`))
        expect(score).toBe(4) // base 1 + 3 ifs
    })

    it('counts each case label as +1', () => {
        const score = scoreCyclomatic(parseFn(`function f(x) {
            switch (x) {
                case 1: return 'a'
                case 2: return 'b'
                case 3: return 'c'
                default: return 'z'
            }
        }`))
        // base 1 + 3 case clauses (default does NOT count)
        expect(score).toBe(4)
    })

    it('counts each loop type as +1', () => {
        expect(scoreCyclomatic(parseFn('function f(xs) { for (let i=0;i<xs.length;i++) {} }'))).toBe(2)
        expect(scoreCyclomatic(parseFn('function f(xs) { for (const x of xs) {} }'))).toBe(2)
        expect(scoreCyclomatic(parseFn('function f(o) { for (const k in o) {} }'))).toBe(2)
        expect(scoreCyclomatic(parseFn('function f(x) { while (x>0) x-- }'))).toBe(2)
        expect(scoreCyclomatic(parseFn('function f(x) { do { x-- } while (x>0) }'))).toBe(2)
    })

    it('counts catch as +1', () => {
        expect(scoreCyclomatic(parseFn(
            'function f() { try { foo() } catch (e) { bar() } }',
        ))).toBe(2)
    })

    it('counts ternary as +1', () => {
        expect(scoreCyclomatic(parseFn('function f(x) { return x ? 1 : 2 }'))).toBe(2)
    })

    it('counts each logical operator occurrence (&&/||/??) as +1', () => {
        // (a && b) || (c && d) → three operators, base 1 + 3 = 4
        expect(scoreCyclomatic(parseFn('function f(a,b,c,d) { return (a && b) || (c && d) }'))).toBe(4)
        expect(scoreCyclomatic(parseFn('function f(x,y) { return x ?? y }'))).toBe(2)
    })

    it('does NOT cross nested function boundaries', () => {
        // Inner function has its own ifs; outer should score 1 (just base).
        expect(scoreCyclomatic(parseFn(`function outer() {
            function inner(x) { if (x) return 1; if (x>5) return 2 }
            return inner
        }`))).toBe(1)
    })

    it('reproduces the BAD example from the spec: 12-branch switch tower', () => {
        const src = `function classify(s) {
            if (s === 'a') return 1
            else if (s === 'b') return 2
            else if (s === 'c') return 3
            else if (s === 'd') return 4
            else if (s === 'e') return 5
            else if (s === 'f') return 6
            else if (s === 'g') return 7
            else if (s === 'h') return 8
            else if (s === 'i') return 9
            else if (s === 'j') return 10
            else if (s === 'k') return 11
            else return 12
        }`
        // base 1 + 11 ifs = 12
        expect(scoreCyclomatic(parseFn(src))).toBe(12)
    })

    it('reproduces the GOOD example from the spec: ADT lookup table', () => {
        const src = `function classify(s) { return MAP[s] ?? 0 }`
        // base 1 + 1 ?? = 2
        expect(scoreCyclomatic(parseFn(src))).toBe(2)
    })
})

describe('cyclomatic-per-fn (measure integration)', () => {
    let synth: SyntheticSubgraph

    beforeEach(() => {
        // Registry is process-global; the import side effect already added
        // this measure. Reset is a safety net for re-runs.
        __resetRegistryForTesting()
    })

    afterEach(async () => {
        if (synth) await synth.cleanup()
    })

    it('reports max per community across all files', async () => {
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/a/low.ts',
                relToSrc: 'a/low.ts',
                text: 'export function a() { return 1 }',
            },
            {
                relativePath: 'pkg/src/a/high.ts',
                relToSrc: 'a/high.ts',
                text: `export function many(s: string) {
                    if (s === '1') return 1
                    else if (s === '2') return 2
                    else if (s === '3') return 3
                    else if (s === '4') return 4
                    else if (s === '5') return 5
                    else if (s === '6') return 6
                    else if (s === '7') return 7
                    else if (s === '8') return 8
                    else if (s === '9') return 9
                    else if (s === '10') return 10
                    else return 11
                }`,
            },
            {
                relativePath: 'pkg/src/b/calm.ts',
                relToSrc: 'b/calm.ts',
                text: 'export function calm() { return 42 }',
            },
        ])

        const result = await cyclomaticPerFnMeasure.run({
            changedFiles: synth.subgraph.files.map(f => f.absolutePath),
            parsedSubgraph: synth.subgraph,
        })

        expect(result.measureId).toBe('cyclomatic-per-fn')
        // community 'pkg/a' has max(low=1, many=11) = 11
        expect(result.perCommunity['pkg/a']).toBe(11)
        // community 'pkg/b' has just calm=1
        expect(result.perCommunity['pkg/b']).toBe(1)
    })

    it('emits a warn violation when score > soft threshold and reports file:line:name', async () => {
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/x/hot.ts',
                relToSrc: 'x/hot.ts',
                text: `export function classify(s: string) {
                    if (s === 'a') return 1
                    else if (s === 'b') return 2
                    else if (s === 'c') return 3
                    else if (s === 'd') return 4
                    else if (s === 'e') return 5
                    else if (s === 'f') return 6
                    else if (s === 'g') return 7
                    else if (s === 'h') return 8
                    else if (s === 'i') return 9
                    else if (s === 'j') return 10
                    else if (s === 'k') return 11
                    else return 12
                }`,
            },
        ])

        const result = await cyclomaticPerFnMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })

        expect(result.perCommunity['pkg/x']).toBe(12)
        expect(result.violations).toHaveLength(1)
        const v = result.violations[0]
        expect(v.community).toBe('pkg/x')
        expect(v.severity).toBe('warn')
        expect(v.score).toBe(12)
        expect(v.message).toContain('pkg/src/x/hot.ts:1') // function declared on line 1
        expect(v.message).toContain('classify')
    })

    it('emits no violation when all functions are below soft threshold', async () => {
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/calm/m.ts',
                relToSrc: 'calm/m.ts',
                text: `export function pipe(xs: number[]) {
                    return xs.map(x => x * 2).filter(x => x > 0)
                }`,
            },
        ])
        const result = await cyclomaticPerFnMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })
        expect(result.violations).toEqual([])
        expect(result.perCommunity['pkg/calm']).toBeLessThanOrEqual(CYCLOMATIC_WARN_SOFT)
    })

    it('skips files in untouched communities (files reached via hop)', async () => {
        // Build a subgraph where only one community is touched, and a second
        // file lives in a different community (simulating a hop neighbour).
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/touched/t.ts',
                relToSrc: 'touched/t.ts',
                text: 'export function safe() { return 1 }',
            },
        ])
        // Patch in an extra file that isn't in touchedCommunities.
        const extraDir = synth.subgraph.files[0].absolutePath.replace(/\/touched\/.*$/, '/hopped')
        const project = synth.subgraph.getProject()
        await import('node:fs/promises').then(fs => fs.mkdir(extraDir, {recursive: true}))
        const extraAbs = `${extraDir}/h.ts`
        await import('node:fs/promises').then(fs => fs.writeFile(extraAbs, `export function nasty(s: string) {
            if (s==='a') return 1
            else if (s==='b') return 2
            else if (s==='c') return 3
            else if (s==='d') return 4
            else if (s==='e') return 5
            else if (s==='f') return 6
            else if (s==='g') return 7
            else if (s==='h') return 8
            else if (s==='i') return 9
            else if (s==='j') return 10
            else if (s==='k') return 11
            else return 12
        }`))
        project.addSourceFileAtPath(extraAbs)

        // Manually inject the hop-file into `files` but assign it to a
        // community we do NOT mark as touched.
        const subgraphAny: any = synth.subgraph
        subgraphAny.files = [
            ...synth.subgraph.files,
            {
                absolutePath: extraAbs,
                relativePath: 'pkg/src/hopped/h.ts',
                relToSrc: 'hopped/h.ts',
                packageName: 'pkg',
            },
        ]
        subgraphAny.communityMap = new Map([...synth.subgraph.communityMap, [extraAbs, 'pkg/hopped']])
        // touchedCommunities stays = ['pkg/touched'] only

        const result = await cyclomaticPerFnMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })

        // 'pkg/hopped' must NOT appear in perCommunity (only touched).
        expect(result.perCommunity).toEqual({'pkg/touched': 1})
        expect(result.violations).toEqual([])
    })
})
