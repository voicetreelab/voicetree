import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {structuralFingerprint, structuralShapeString} from './structural-fingerprint'

function parseFirstFunctionBody(source: string): ts.Node {
    const sf = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true)
    let body: ts.Node | undefined
    function visit(node: ts.Node): void {
        if (body) return
        if (ts.isFunctionDeclaration(node) && node.body) {
            body = node.body
            return
        }
        if (ts.isArrowFunction(node) && node.body) {
            body = node.body
            return
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sf, visit)
    if (!body) throw new Error('no function body found in fixture')
    return body
}

describe('structuralFingerprint', () => {
    it('produces the same root hash for functions that differ only in identifiers and literals', () => {
        const a = parseFirstFunctionBody(`
            function f(input) {
                const seen = new Set()
                for (const value of input) {
                    if (value > 0) seen.add(value)
                }
                return seen.size
            }
        `)
        const b = parseFirstFunctionBody(`
            function g(items) {
                const accumulator = new Set()
                for (const elem of items) {
                    if (elem > 100) accumulator.add(elem)
                }
                return accumulator.size
            }
        `)

        const fpA = structuralFingerprint(a)
        const fpB = structuralFingerprint(b)

        expect(fpA.rootHash).toBe(fpB.rootHash)
        expect(structuralShapeString(a)).toBe(structuralShapeString(b))
    })

    it('produces different root hashes for functions with different shapes', () => {
        const branchy = parseFirstFunctionBody(`
            function f(value) {
                if (value > 0) return 'pos'
                if (value < 0) return 'neg'
                return 'zero'
            }
        `)
        const loop = parseFirstFunctionBody(`
            function g(values) {
                let total = 0
                for (const v of values) total += v
                return total
            }
        `)

        const fpA = structuralFingerprint(branchy)
        const fpB = structuralFingerprint(loop)

        expect(fpA.rootHash).not.toBe(fpB.rootHash)
    })

    it('collects every subtree shape into the feature set', () => {
        const body = parseFirstFunctionBody(`
            function f() {
                return 1 + 2
            }
        `)
        const fp = structuralFingerprint(body)

        // ReturnStatement and BinaryExpression must appear as subtree shapes
        // somewhere in the set so that Jaccard scoring has something to overlap on.
        const shapes = [...fp.subtreeShapes]
        expect(shapes.some(shape => shape.startsWith('ReturnStatement'))).toBe(true)
        expect(shapes.some(shape => shape.startsWith('BinaryExpression'))).toBe(true)
        expect(fp.subtreeShapes.has('LIT')).toBe(true)
    })
})
