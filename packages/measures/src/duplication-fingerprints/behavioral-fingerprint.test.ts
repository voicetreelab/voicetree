import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {behavioralFingerprint} from './behavioral-fingerprint'

function firstFunctionLikeIn(source: string): ts.FunctionLikeDeclaration {
    const sf = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true)
    let found: ts.FunctionLikeDeclaration | undefined
    function visit(node: ts.Node): void {
        if (found) return
        if (ts.isFunctionDeclaration(node)
            || ts.isFunctionExpression(node)
            || ts.isArrowFunction(node)
            || ts.isMethodDeclaration(node)) {
            found = node
            return
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sf, visit)
    if (!found) throw new Error('no function-like declaration found')
    return found
}

describe('behavioralFingerprint', () => {
    it('captures called symbols as a multiset reduced to log2 buckets', () => {
        const fn = firstFunctionLikeIn(`
            async function loader(path) {
                const a = await readFile(path)
                const b = await readFile(path)
                const c = await readFile(path)
                const parsed = JSON.parse(a)
                return parsed
            }
        `)

        const fp = behavioralFingerprint(fn)

        expect(fp.calledSymbols.get('readFile')).toBe(3)
        expect(fp.calledSymbols.get('parse')).toBe(1)
        // log2(3) = 1, log2(1) = 0
        expect(fp.features.has('cs:readFile@1')).toBe(true)
        expect(fp.features.has('cs:parse@0')).toBe(true)
    })

    it('records cfg shape via branches, loops, and max depth', () => {
        const fn = firstFunctionLikeIn(`
            function classify(values) {
                let positives = 0
                for (const value of values) {
                    if (value > 0) {
                        positives = positives + 1
                    }
                }
                return positives
            }
        `)

        const fp = behavioralFingerprint(fn)

        expect(fp.cfgShape.branches).toBe(1)
        expect(fp.cfgShape.loops).toBe(1)
        expect(fp.cfgShape.depth).toBeGreaterThan(0)
    })

    it('produces matching signatures for arity-equal async value-returning functions', () => {
        const a = firstFunctionLikeIn(`
            async function loadFoo(path) {
                return await readFile(path)
            }
        `)
        const b = firstFunctionLikeIn(`
            async function loadBar(filepath) {
                return await openFile(filepath)
            }
        `)
        const fpA = behavioralFingerprint(a)
        const fpB = behavioralFingerprint(b)

        expect(fpA.signature).toBe(fpB.signature)
        expect(fpA.signature).toContain('arity-1')
        expect(fpA.signature).toContain('async-1')
        expect(fpA.signature).toContain('returns-value')
    })

    it('distinguishes void from value returns', () => {
        const sink = firstFunctionLikeIn(`
            function sink(msg) {
                console.log(msg)
            }
        `)
        const fp = behavioralFingerprint(sink)
        expect(fp.signature).toContain('returns-void')
    })

    it('does not descend into nested function declarations for cfg and calls', () => {
        const fn = firstFunctionLikeIn(`
            function outer(items) {
                function inner(x) {
                    if (x < 0) return 0
                    if (x > 100) return 100
                    return x
                }
                return inner
            }
        `)
        const fp = behavioralFingerprint(fn)
        // The inner function has 2 ifs; outer must not count them.
        expect(fp.cfgShape.branches).toBe(0)
        // Outer never calls inner — inner is just returned. So 0 calls.
        expect(fp.calledSymbols.size).toBe(0)
    })
})
