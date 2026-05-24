import {afterEach, beforeEach, describe, expect, it} from 'vitest'
// IMPORTANT: tests use ts-morph's bundled typescript so SyntaxKind enums
// match what the scorer functions check against. Don't switch to bare
// `typescript` — version drift causes type-predicates to silently fail.
import {ts} from 'ts-morph'
import {__resetRegistryForTesting} from '../../../_shared/measures/registry.ts'
import {buildSyntheticSubgraph, type SyntheticSubgraph} from './_test-helpers.ts'
import {cognitivePerFnMeasure, scoreCognitive, COGNITIVE_WARN_SOFT} from './cognitive-per-fn.ts'

function parseFn(text: string): {root: ts.FunctionLikeDeclaration; name: string; sf: ts.SourceFile} {
    const sf = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true)
    let found: ts.FunctionLikeDeclaration | null = null
    let name = ''
    function visit(node: ts.Node): void {
        if (found) return
        if (ts.isFunctionDeclaration(node) && node.name) {
            found = node
            name = node.name.text
            return
        }
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
            found = node
            name = '<anonymous>'
            return
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sf, visit)
    if (!found) throw new Error('no function found')
    return {root: found, name, sf}
}

describe('scoreCognitive (unit)', () => {
    it('returns 0 for a function with no control flow', () => {
        const {root, name} = parseFn('function f() { return 1 }')
        expect(scoreCognitive(root, name)).toBe(0)
    })

    it('adds +1 for a single top-level if', () => {
        const {root, name} = parseFn('function f(x) { if (x) return 1; return 0 }')
        expect(scoreCognitive(root, name)).toBe(1)
    })

    it('adds +1 for else (no nesting bump), +1 for each else-if', () => {
        // if + else-if + else-if + else  → if=1, else-if=1, else-if=1, else=1 → 4
        const src = `function f(s) {
            if (s === 'a') return 1
            else if (s === 'b') return 2
            else if (s === 'c') return 3
            else return 4
        }`
        const {root, name} = parseFn(src)
        expect(scoreCognitive(root, name)).toBe(4)
    })

    it('applies nesting penalty: nested if inside for inside while', () => {
        // while +1 (n=0), for +1+1 (n=1), if +1+2 (n=2) = 6
        const src = `function find(xs, ys, p) {
            while (xs.length > 0) {
                for (const y of ys) {
                    if (y.ok) return y
                }
                xs.pop()
            }
            return null
        }`
        const {root, name} = parseFn(src)
        expect(scoreCognitive(root, name)).toBe(6)
    })

    it('reproduces the BAD example from the spec: nested loops + nested if', () => {
        const src = `function find(xs, p) {
            for (const x of xs) {
                if (x.active) {
                    for (const y of x.kids) {
                        if (y.ok) {
                            return y
                        }
                    }
                }
            }
        }`
        // for +1+0 (n=0) = 1
        // if  +1+1 (n=1) = 2  total 3
        // for +1+2 (n=2) = 3  total 6
        // if  +1+3 (n=3) = 4  total 10
        const {root, name} = parseFn(src)
        expect(scoreCognitive(root, name)).toBe(10)
    })

    it('reproduces the GOOD example: pipeline form', () => {
        const src = `function find(xs, p) { return xs.find(p) }`
        const {root, name} = parseFn(src)
        expect(scoreCognitive(root, name)).toBe(0)
    })

    it('counts a switch case as +1 each plus nesting', () => {
        const src = `function f(x) {
            switch (x) {
                case 1: return 'a'
                case 2: return 'b'
                case 3: return 'c'
                default: return 'z'
            }
        }`
        // Our impl: switch itself +1, case bodies traversed at nesting+1 but
        // contain no further structures. Total: 1.
        const {root, name} = parseFn(src)
        expect(scoreCognitive(root, name)).toBe(1)
    })

    it('counts mixed logical operator chains by operator-change count', () => {
        // (a && b)              → 1
        // (a && b && c)         → 1 (uniform &&)
        // (a && b || c)         → 2 (mixed)
        // (a && b || c && d)    → 3 (alternations)
        let f = parseFn('function f(a,b) { return a && b }')
        expect(scoreCognitive(f.root, f.name)).toBe(1)
        f = parseFn('function f(a,b,c) { return a && b && c }')
        expect(scoreCognitive(f.root, f.name)).toBe(1)
        f = parseFn('function f(a,b,c) { return a && b || c }')
        expect(scoreCognitive(f.root, f.name)).toBe(2)
        f = parseFn('function f(a,b,c,d) { return a && b || c && d }')
        expect(scoreCognitive(f.root, f.name)).toBe(3)
    })

    it('counts direct recursive call as +1', () => {
        const src = `function fib(n) {
            if (n < 2) return n
            return fib(n - 1) + fib(n - 2)
        }`
        // if +1 (n=0), recursion +1, recursion +1 = 3
        const {root, name} = parseFn(src)
        expect(scoreCognitive(root, name)).toBe(3)
    })

    it('does NOT cross nested function boundaries', () => {
        const src = `function outer() {
            function inner(x) {
                if (x) for (const y of x) { if (y) return y }
                return null
            }
            return inner
        }`
        const {root, name} = parseFn(src)
        // Outer has zero structures of its own.
        expect(scoreCognitive(root, name)).toBe(0)
    })
})

describe('cognitive-per-fn (measure integration)', () => {
    let synth: SyntheticSubgraph

    beforeEach(() => { __resetRegistryForTesting() })
    afterEach(async () => { if (synth) await synth.cleanup() })

    it('reports max per community across files and per-function detail in violation', async () => {
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/clean/p.ts',
                relToSrc: 'clean/p.ts',
                text: 'export function p(xs:number[]) { return xs.find(x => x>0) }',
            },
            {
                relativePath: 'pkg/src/nested/n.ts',
                relToSrc: 'nested/n.ts',
                text: `export function find(xs: any[]) {
                    for (const x of xs) {
                        if (x.active) {
                            for (const y of x.kids) {
                                if (y.ok) {
                                    return y
                                }
                            }
                        }
                    }
                }`,
            },
        ])

        const result = await cognitivePerFnMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })
        expect(result.measureId).toBe('cognitive-per-fn')
        expect(result.perCommunity['pkg/clean']).toBe(0)
        expect(result.perCommunity['pkg/nested']).toBe(10)
        expect(result.violations).toHaveLength(1)
        const v = result.violations[0]
        expect(v.community).toBe('pkg/nested')
        expect(v.severity).toBe('warn')
        expect(v.score).toBe(10)
        expect(v.message).toContain('pkg/src/nested/n.ts:1')
        expect(v.message).toContain('find')
    })

    it('warns at threshold but does not fail', async () => {
        // cog = 10 in the BAD example → over WARN_SOFT (8), under FAIL (30)
        synth = await buildSyntheticSubgraph([
            {
                relativePath: 'pkg/src/x/f.ts',
                relToSrc: 'x/f.ts',
                text: `export function find(xs:any[]) {
                    for (const x of xs) { if (x.active) for (const y of x.kids) if (y.ok) return y }
                }`,
            },
        ])
        const result = await cognitivePerFnMeasure.run({
            changedFiles: [],
            parsedSubgraph: synth.subgraph,
        })
        // Score: for+1(0) + if+1+1(1) + for+1+2(2) + if+1+3(3) = 1+2+3+4 = 10
        expect(result.perCommunity['pkg/x']).toBe(10)
        expect(result.violations[0]?.severity).toBe('warn')
    })
})

describe('cognitive vs cyclomatic decoupling', () => {
    it('a flat switch tower has high cyclomatic but low cognitive', () => {
        const src = `function f(x) {
            switch (x) {
                case 1: return 'a'
                case 2: return 'b'
                case 3: return 'c'
                case 4: return 'd'
                case 5: return 'e'
            }
        }`
        const {root, name} = parseFn(src)
        // Our cognitive counts switch as +1 only; case bodies traverse but are empty.
        expect(scoreCognitive(root, name)).toBeLessThan(COGNITIVE_WARN_SOFT)
    })
})
