import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import {
    IMPURE_IDENTIFIERS,
    listSourceFiles,
    detectSideEffectsAST,
} from '../../_shared/purity-analysis'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import { readFile } from 'node:fs/promises'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

// ---------------------------------------------------------------------------
// Known impure object.method pairs (mirrors IMPURE_OBJ_METHODS in purity-analysis)
// ---------------------------------------------------------------------------
const IMPURE_OBJ_METHOD_PAIRS: ReadonlyMap<string, ReadonlySet<string> | '*'> = new Map<string, ReadonlySet<string> | '*'>([
    ['console', new Set(['log', 'warn', 'error', 'info', 'debug', 'trace'])],
    ['fs', '*'],
    ['Math', new Set(['random'])],
    ['Date', new Set(['now'])],
    ['http', new Set(['request', 'get', 'createServer'])],
    ['https', new Set(['request', 'get', 'createServer'])],
    ['process', new Set(['exit'])],
])

// ---------------------------------------------------------------------------
// detectDefaultValueImpurities
// ---------------------------------------------------------------------------
function resolveChain(node: ts.Expression): string[] | null {
    const parts: string[] = []
    let cur: ts.Expression = node
    while (true) {
        if (ts.isPropertyAccessExpression(cur)) {
            parts.unshift(cur.name.text)
            cur = cur.expression
        } else if (ts.isIdentifier(cur)) {
            parts.unshift(cur.text)
            return parts
        } else {
            return null
        }
    }
}

function walkForImpureRefs(node: ts.Node, found: Set<string>): void {
    // Property access: e.g. Date.now, console.log, process.exit
    if (ts.isPropertyAccessExpression(node)) {
        const chain = resolveChain(node)
        if (chain && chain.length >= 2) {
            const obj = chain[0]
            const method = chain[1]
            const entry = IMPURE_OBJ_METHOD_PAIRS.get(obj)
            if (entry && (entry === '*' || entry.has(method))) {
                found.add(chain.join('.'))
            }
        }
    }

    // Bare identifier: e.g. readFile, fetch, setTimeout
    if (ts.isIdentifier(node)) {
        // Skip if this identifier is the right-hand side of a property access (already handled above)
        if (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
            // handled by property-access branch
        } else if (IMPURE_IDENTIFIERS.has(node.text)) {
            found.add(node.text)
        }
    }

    ts.forEachChild(node, child => walkForImpureRefs(child, found))
}

export function detectDefaultValueImpurities(
    fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): Set<string> {
    const found = new Set<string>()
    for (const param of fnNode.parameters) {
        if (!param.initializer) continue
        walkForImpureRefs(param.initializer, found)
    }
    return found
}

// ---------------------------------------------------------------------------
// scanForDefaultValueGaming
// ---------------------------------------------------------------------------
type GamingFinding = {
    functionName: string
    line: number
    impureDefaults: string[]
}

function getFunctionNode(
    node: ts.Node,
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
    if (ts.isFunctionDeclaration(node)) return node
    if (ts.isArrowFunction(node)) return node
    if (ts.isFunctionExpression(node)) return node
    return null
}

function getFunctionName(node: ts.Node, sf: ts.SourceFile): string {
    if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent) {
        if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
            return node.parent.name.text
        }
    }
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    return `<anonymous@L${line + 1}>`
}

export async function scanForDefaultValueGaming(filePath: string): Promise<GamingFinding[]> {
    const text = await readFile(filePath, 'utf8')
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const findings: GamingFinding[] = []
    const aliases: ReadonlyMap<string, string> = new Map()

    function visit(node: ts.Node): void {
        const fnNode = getFunctionNode(node)
        if (fnNode) {
            const impureDefaults = detectDefaultValueImpurities(fnNode)
            if (impureDefaults.size > 0) {
                // Check if the body itself looks pure
                const body = fnNode.body
                if (body) {
                    const { effects } = detectSideEffectsAST(body, aliases)
                    if (effects.size === 0) {
                        const name = getFunctionName(fnNode, sf)
                        const { line } = sf.getLineAndCharacterOfPosition(fnNode.getStart(sf))
                        findings.push({
                            functionName: name,
                            line: line + 1,
                            impureDefaults: [...impureDefaults].sort(),
                        })
                    }
                }
            }
        }
        ts.forEachChild(node, visit)
    }

    ts.forEachChild(sf, visit)
    return findings
}

// ---------------------------------------------------------------------------
// Helper: parse inline source and extract the first function node
// ---------------------------------------------------------------------------
function parseFn(src: string): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression {
    const sf = ts.createSourceFile('test.ts', src, ts.ScriptTarget.Latest, true)
    let result: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null = null
    function visit(node: ts.Node): void {
        if (result) return
        const fn = getFunctionNode(node)
        if (fn) { result = fn; return }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sf, visit)
    if (!result) throw new Error('No function found in source')
    return result
}

function scanInline(src: string): GamingFinding[] {
    const sf = ts.createSourceFile('test.ts', src, ts.ScriptTarget.Latest, true)
    const findings: GamingFinding[] = []
    const aliases: ReadonlyMap<string, string> = new Map()

    function visit(node: ts.Node): void {
        const fnNode = getFunctionNode(node)
        if (fnNode) {
            const impureDefaults = detectDefaultValueImpurities(fnNode)
            if (impureDefaults.size > 0) {
                const body = fnNode.body
                if (body) {
                    const { effects } = detectSideEffectsAST(body, aliases)
                    if (effects.size === 0) {
                        const name = getFunctionName(fnNode, sf)
                        const { line } = sf.getLineAndCharacterOfPosition(fnNode.getStart(sf))
                        findings.push({
                            functionName: name,
                            line: line + 1,
                            impureDefaults: [...impureDefaults].sort(),
                        })
                    }
                }
            }
        }
        ts.forEachChild(node, visit)
    }

    ts.forEachChild(sf, visit)
    return findings
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('detectDefaultValueImpurities', () => {
    it('detects Date.now in object-literal default', () => {
        const fn = parseFn(`function foo(deps = { now: Date.now }) { return deps.now() }`)
        const impure = detectDefaultValueImpurities(fn)
        expect(impure.has('Date.now')).toBe(true)
    })

    it('detects console.log as bare default', () => {
        const fn = parseFn(`function bar(log = console.log) { log('hi') }`)
        const impure = detectDefaultValueImpurities(fn)
        expect(impure.has('console.log')).toBe(true)
    })

    it('returns empty set for harmless numeric default', () => {
        const fn = parseFn(`function baz(x = 5) { return x + 1 }`)
        const impure = detectDefaultValueImpurities(fn)
        expect(impure.size).toBe(0)
    })

    it('detects readFile bare identifier in default', () => {
        const fn = parseFn(`function qux(deps = { read: readFile }) { return deps.read('x') }`)
        const impure = detectDefaultValueImpurities(fn)
        expect(impure.has('readFile')).toBe(true)
    })

    it('detects Math.random in default', () => {
        const fn = parseFn(`function rand(rng = Math.random) { return rng() }`)
        const impure = detectDefaultValueImpurities(fn)
        expect(impure.has('Math.random')).toBe(true)
    })

    it('detects multiple impure defaults in one function', () => {
        const fn = parseFn(`function multi(deps = { log: console.log, rand: Math.random, t: setTimeout }) { deps.log(deps.rand()) }`)
        const impure = detectDefaultValueImpurities(fn)
        expect(impure.has('console.log')).toBe(true)
        expect(impure.has('Math.random')).toBe(true)
        expect(impure.has('setTimeout')).toBe(true)
    })
})

describe('scanForDefaultValueGaming', () => {
    it('only flags functions whose body looks pure but defaults are impure', () => {
        const src = `
function gaming(deps = { now: Date.now }) { return deps.now() }
function honest() { return Date.now() }
function clean(x = 5) { return x + 1 }
`
        const findings = scanInline(src)
        expect(findings.length).toBe(1)
        expect(findings[0].functionName).toBe('gaming')
        expect(findings[0].impureDefaults).toContain('Date.now')
    })

    it('handles arrow function gaming pattern', () => {
        const src = `const stamp = (deps = { now: Date.now }) => deps.now()`
        const findings = scanInline(src)
        expect(findings.length).toBe(1)
        expect(findings[0].functionName).toBe('stamp')
    })

    it('does not flag when body is also impure', () => {
        const src = `function both(log = console.log) { console.log('direct') }`
        const findings = scanInline(src)
        expect(findings.length).toBe(0)
    })

    it('scans codebase source roots (informational)', async () => {
        const allFindings: GamingFinding[] = []
        const packages = await discoverPackages()
        const files = (await Promise.all(packages.map(pkg => listSourceFiles(pkg.srcRoot)))).flat()
        for (const file of files) {
            const findings = await scanForDefaultValueGaming(file)
            allFindings.push(...findings.map(f => ({ ...f, functionName: `${file}::${f.functionName}` })))
        }
        // Informational: print what we find, don't gate
        if (allFindings.length > 0) {
            console.log(`\n[default-value-gaming] Found ${allFindings.length} function(s) with impure defaults hiding pure bodies:`)
            for (const f of allFindings) {
                console.log(`  ${f.functionName} (line ${f.line}): ${f.impureDefaults.join(', ')}`)
            }
        } else {
            console.log('\n[default-value-gaming] No gaming patterns detected in codebase.')
        }
        // Always passes — this is a diagnostic scan
        await recordHealthMetric({
            metricId: 'default-value-detection',
            metricName: 'Default Value Impurity Detection',
            description: 'Functions whose bodies look pure while impure defaults hide side effects.',
            category: 'Purity',
            current: allFindings.length,
            budget: 0,
            comparison: 'lte',
            unit: 'findings',
            details: {findings: allFindings},
        })

        expect(true).toBe(true)
    }, 30_000)
})
