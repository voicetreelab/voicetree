import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, it } from 'vitest'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../..')

const SOURCE_ROOTS: readonly string[] = [
    join(REPO_ROOT, 'packages/libraries'),
    join(REPO_ROOT, 'packages/systems'),
    join(REPO_ROOT, 'webapp/src'),
]

// ── file scanning ──────────────────────────────────────────────────

function isProductionSource(p: string): boolean {
    return (p.endsWith('.ts') || p.endsWith('.tsx'))
        && !p.endsWith('.test.ts') && !p.endsWith('.test.tsx')
        && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts') && !p.endsWith('.config.ts')
        && !p.includes('__tests__') && !p.includes('integration-tests')
        && !p.includes('node_modules') && !p.includes('/dist/') && !p.includes('/build/')
}

async function listSourceFiles(root: string): Promise<string[]> {
    const results: string[] = []
    async function walk(dir: string): Promise<void> {
        let entries
        try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
        await Promise.all(entries.map(async e => {
            const p: string = join(dir, e.name)
            if (e.isDirectory()) await walk(p)
            else if (e.isFile() && isProductionSource(p)) results.push(p)
        }))
    }
    await walk(root)
    return results.sort()
}

// ── impure callee tables ───────────────────────────────────────────

const IMPURE_OBJ_METHODS: ReadonlyMap<string, { methods: ReadonlySet<string> | '*'; category: string }> = new Map([
    ['console', { methods: new Set(['log', 'warn', 'error', 'info', 'debug', 'trace']), category: 'console' }],
    ['fs',      { methods: '*', category: 'fs-io' }],
    ['Math',    { methods: new Set(['random']), category: 'nondeterministic' }],
    ['Date',    { methods: new Set(['now']), category: 'nondeterministic' }],
    ['http',    { methods: new Set(['request', 'get', 'createServer']), category: 'network' }],
    ['https',   { methods: new Set(['request', 'get', 'createServer']), category: 'network' }],
    ['process', { methods: new Set(['exit']), category: 'process-io' }],
])

const IMPURE_CHAIN: ReadonlyArray<{ chain: readonly string[]; category: string }> = [
    { chain: ['process', 'stdout', 'write'], category: 'process-io' },
    { chain: ['process', 'stderr', 'write'], category: 'process-io' },
]

const IMPURE_IDENTIFIERS: ReadonlyMap<string, string> = new Map([
    ['fetch', 'network'],
    ['setTimeout', 'timer'], ['setInterval', 'timer'], ['setImmediate', 'timer'],
    ['spawn', 'subprocess'], ['exec', 'subprocess'], ['execSync', 'subprocess'],
    ['execFile', 'subprocess'], ['execFileSync', 'subprocess'], ['fork', 'subprocess'],
    ['readFile', 'fs-io'], ['writeFile', 'fs-io'], ['readFileSync', 'fs-io'], ['writeFileSync', 'fs-io'],
    ['mkdir', 'fs-io'], ['mkdirSync', 'fs-io'], ['unlink', 'fs-io'], ['unlinkSync', 'fs-io'],
    ['rmdir', 'fs-io'], ['copyFile', 'fs-io'], ['chmod', 'fs-io'],
    ['useState', 'react-hook'], ['useEffect', 'react-hook'], ['useRef', 'react-hook'],
    ['useMemo', 'react-hook'], ['useCallback', 'react-hook'], ['useLayoutEffect', 'react-hook'],
])

// ── module-level alias detection ──────────────────────────────────

const IMPURE_GLOBALS: ReadonlySet<string> = new Set([
    ...IMPURE_OBJ_METHODS.keys(),
])

function collectAliases(sf: ts.SourceFile): ReadonlyMap<string, string> {
    const aliases: Map<string, string> = new Map()
    for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt)) continue
        for (const decl of stmt.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
            if (ts.isIdentifier(decl.initializer) && IMPURE_GLOBALS.has(decl.initializer.text)) {
                aliases.set(decl.name.text, decl.initializer.text)
            }
        }
    }
    return aliases
}

// ── AST-based side-effect detection ────────────────────────────────

function resolvePropertyChain(node: ts.Expression): string[] | null {
    const parts: string[] = []
    let cur: ts.Expression = node
    while (true) {
        if (ts.isPropertyAccessExpression(cur)) {
            parts.unshift(cur.name.text)
            cur = cur.expression
        } else if (ts.isElementAccessExpression(cur) && ts.isStringLiteral(cur.argumentExpression)) {
            parts.unshift(cur.argumentExpression.text)
            cur = cur.expression
        } else if (ts.isIdentifier(cur)) {
            parts.unshift(cur.text)
            return parts
        } else {
            return null
        }
    }
}

function detectSideEffectsAST(body: ts.Node, aliases: ReadonlyMap<string, string>): { effects: Set<string>; calledNames: Set<string> } {
    const effects: Set<string> = new Set()
    const calledNames: Set<string> = new Set()

    function visit(node: ts.Node): void {
        if (ts.isCallExpression(node)) {
            const callee: ts.Expression = node.expression

            if (ts.isIdentifier(callee)) {
                calledNames.add(callee.text)
                const cat: string | undefined = IMPURE_IDENTIFIERS.get(callee.text)
                if (cat) effects.add(cat)
            }

            const chain: string[] | null = resolvePropertyChain(callee)
            if (chain && chain.length >= 2) {
                const resolvedObj = aliases.get(chain[0]) ?? chain[0]
                const resolvedChain = [resolvedObj, ...chain.slice(1)]
                calledNames.add(resolvedChain.join('.'))
                const obj: string = resolvedObj
                const method: string = resolvedChain[resolvedChain.length - 1]

                if (method === 'emit') {
                    effects.add('event-emit')
                }

                const entry = IMPURE_OBJ_METHODS.get(obj)
                if (entry && (entry.methods === '*' || entry.methods.has(method))) {
                    effects.add(entry.category)
                }

                for (const rule of IMPURE_CHAIN) {
                    if (resolvedChain.length >= rule.chain.length
                        && rule.chain.every((seg, i) => resolvedChain[i] === seg)) {
                        effects.add(rule.category)
                    }
                }
            }
        }

        if (ts.isNewExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'Date'
            && (!node.arguments || node.arguments.length === 0)) {
            effects.add('nondeterministic')
        }

        ts.forEachChild(node, visit)
    }

    ts.forEachChild(body, visit)
    return { effects, calledNames }
}

// ── function extraction ────────────────────────────────────────────

type FnEntry = {
    readonly name: string
    readonly file: string
    readonly line: number
    readonly loc: number
    readonly isExported: boolean
    sideEffects: string[]
    readonly calledNames: ReadonlySet<string>
}

function countLoc(node: ts.Node, sf: ts.SourceFile): number {
    const text: string = node.getText(sf)
    return text.split('\n').filter(l => l.trim().length > 0).length
}

function hasMod(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return mods?.some(m => m.kind === kind) ?? false
}

function extractFunctions(filePath: string, sf: ts.SourceFile): FnEntry[] {
    const fns: FnEntry[] = []
    const rel: string = relative(REPO_ROOT, filePath)
    const aliases: ReadonlyMap<string, string> = collectAliases(sf)

    function isExp(node: ts.Node): boolean {
        if (hasMod(node, ts.SyntaxKind.ExportKeyword)) return true
        if (node.parent && ts.isVariableDeclarationList(node.parent)
            && node.parent.parent && ts.isVariableStatement(node.parent.parent)) {
            return hasMod(node.parent.parent, ts.SyntaxKind.ExportKeyword)
        }
        return false
    }

    function push(name: string, body: ts.Node | undefined, node: ts.Node, exported: boolean): void {
        if (!body) return
        const loc: number = countLoc(body, sf)
        if (loc === 0) return
        const { effects, calledNames } = detectSideEffectsAST(body, aliases)
        fns.push({
            name, file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            loc, isExported: exported,
            sideEffects: [...effects].sort(),
            calledNames,
        })
    }

    function visit(node: ts.Node): void {
        if (ts.isFunctionDeclaration(node) && node.name) {
            push(node.name.text, node.body, node, isExp(node))
        }
        if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
            const init = node.initializer
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
                push(node.name.text, init.body, node, isExp(node))
            }
        }
        if (ts.isMethodDeclaration(node) && node.name) {
            push(node.name.getText(sf), node.body, node, false)
        }
        ts.forEachChild(node, visit)
    }

    ts.forEachChild(sf, child => visit(child))
    return fns
}

// ── transitive impurity propagation ────────────────────────────────

function parseImports(sf: ts.SourceFile, impureByFile: ReadonlyMap<string, ReadonlySet<string>>, absPath: string): Set<string> {
    const tainted: Set<string> = new Set()
    const dir: string = dirname(absPath)

    for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt)) continue
        const spec: string = (stmt.moduleSpecifier as ts.StringLiteral).text
        if (!spec.startsWith('.')) continue

        let resolved: string = resolve(dir, spec)
        for (const ext of ['.ts', '.tsx', '/index.ts']) {
            if (impureByFile.has(resolved + ext)) { resolved = resolved + ext; break }
        }
        if (impureByFile.has(resolved)) {
            const impNames = impureByFile.get(resolved)!
            const bindings = stmt.importClause?.namedBindings
            if (bindings && ts.isNamedImports(bindings)) {
                for (const el of bindings.elements) {
                    const orig: string = (el.propertyName ?? el.name).text
                    if (impNames.has(orig)) tainted.add(el.name.text)
                }
            }
        }
    }
    return tainted
}

function propagateImpurity(allFns: FnEntry[]): void {
    const byFile: Map<string, FnEntry[]> = new Map()
    for (const fn of allFns) {
        const list = byFile.get(fn.file)
        if (list) list.push(fn); else byFile.set(fn.file, [fn])
    }

    // intra-file fixpoint
    for (const fileFns of byFile.values()) {
        let changed = true
        while (changed) {
            changed = false
            const impNames: Set<string> = new Set(fileFns.filter(f => f.sideEffects.length > 0).map(f => f.name))
            for (const fn of fileFns) {
                if (fn.sideEffects.length > 0) continue
                for (const called of fn.calledNames) {
                    if (impNames.has(called)) {
                        fn.sideEffects = ['transitive']
                        changed = true
                        break
                    }
                }
            }
        }
    }

    // cross-file via relative imports
    const impExpByFile: Map<string, Set<string>> = new Map()
    for (const fn of allFns) {
        if (fn.sideEffects.length > 0 && fn.isExported) {
            const abs = resolve(REPO_ROOT, fn.file)
            let s = impExpByFile.get(abs)
            if (!s) { s = new Set(); impExpByFile.set(abs, s) }
            s.add(fn.name)
        }
    }

    const sfCache: Map<string, ts.SourceFile> = new Map()
    for (const [relFile, fileFns] of byFile) {
        if (fileFns.every(f => f.sideEffects.length > 0)) continue
        const abs = resolve(REPO_ROOT, relFile)
        let sf = sfCache.get(abs)
        if (!sf) {
            const text = ts.sys.readFile(abs) ?? ''
            sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
            sfCache.set(abs, sf)
        }
        const tainted = parseImports(sf, impExpByFile, abs)
        if (tainted.size === 0) continue
        for (const fn of fileFns) {
            if (fn.sideEffects.length > 0) continue
            for (const called of fn.calledNames) {
                if (tainted.has(called)) { fn.sideEffects = ['transitive-import']; break }
            }
        }
    }
}

// ── analysis + diagnostic reporting ────────────────────────────────

type ArchLayer = 'pure' | 'shell/edge' | 'libraries' | 'systems' | 'UI' | 'other'

function classifyLayer(f: string): ArchLayer {
    if (f.includes('/pure/')) return 'pure'
    if (f.includes('shell/edge/')) return 'shell/edge'
    if (f.includes('shell/UI/')) return 'UI'
    if (f.startsWith('packages/libraries/')) return 'libraries'
    if (f.startsWith('packages/systems/')) return 'systems'
    return 'other'
}

type FunctionHealthStats = {
    allLocs: number[]
    pureLocs: number[]
    impureLocs: number[]
    fnCount: number
    pureCount: number
    impureCount: number
    over50Count: number
}

function emptyHealthStats(): FunctionHealthStats {
    return {
        allLocs: [],
        pureLocs: [],
        impureLocs: [],
        fnCount: 0,
        pureCount: 0,
        impureCount: 0,
        over50Count: 0,
    }
}

async function analyze(): Promise<{ fns: FnEntry[]; byLayer: Record<ArchLayer, FunctionHealthStats> }> {
    const files = (await Promise.all(SOURCE_ROOTS.map(listSourceFiles))).flat()
    const allFns: FnEntry[] = []
    await Promise.all(files.map(async fp => {
        const text = await readFile(fp, 'utf8')
        const sf = ts.createSourceFile(fp, text, ts.ScriptTarget.Latest, true)
        allFns.push(...extractFunctions(fp, sf))
    }))
    propagateImpurity(allFns)

    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const byLayer: Record<string, FunctionHealthStats> = {}
    for (const l of layers) byLayer[l] = emptyHealthStats()

    for (const fn of allFns) {
        const s = byLayer[classifyLayer(fn.file)]
        s.fnCount++
        s.allLocs.push(fn.loc)
        if (fn.loc > 50) s.over50Count++
        if (fn.sideEffects.length === 0) {
            s.pureCount++
            s.pureLocs.push(fn.loc)
        } else {
            s.impureCount++
            s.impureLocs.push(fn.loc)
        }
    }
    return { fns: allFns, byLayer: byLayer as Record<ArchLayer, FunctionHealthStats> }
}

function median(ns: readonly number[]): number | null {
    if (ns.length === 0) return null
    const sorted = [...ns].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function percentile(ns: readonly number[], p: number): number | null {
    if (ns.length === 0) return null
    const sorted = [...ns].sort((a, b) => a - b)
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function fmt(n: number | null): string {
    if (n === null) return 'N/A'
    return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function fmtRatio(pureMedian: number | null, impureMedian: number | null): string {
    if (pureMedian === null || impureMedian === null) return 'N/A'
    if (impureMedian === 0) return 'N/A'
    return (pureMedian / impureMedian).toFixed(2)
}

function bar(count: number, max: number): string {
    if (count === 0 || max === 0) return ''
    return '#'.repeat(Math.max(1, Math.round((count / max) * 24)))
}

function truncate(s: string, width: number): string {
    if (s.length <= width) return s
    if (width <= 3) return s.slice(0, width)
    return '...' + s.slice(s.length - width + 3)
}

function formatFnRow(fn: FnEntry): string {
    const location = `${fn.file}:${fn.line}`
    const purity = fn.sideEffects.length === 0 ? 'pure' : 'impure'
    const effects = fn.sideEffects.length === 0 ? '-' : fn.sideEffects.join(',')
    return `${truncate(location, 64).padEnd(64)} | ${truncate(fn.name, 34).padEnd(34)} | ${String(fn.loc).padStart(4)} | ${purity.padEnd(6)} | ${effects}`
}

function reportFunctionHistogram(fns: readonly FnEntry[]): string {
    const buckets = [
        { label: '1-5', min: 1, max: 5 },
        { label: '6-10', min: 6, max: 10 },
        { label: '11-20', min: 11, max: 20 },
        { label: '21-40', min: 21, max: 40 },
        { label: '41-80', min: 41, max: 80 },
        { label: '81-160', min: 81, max: 160 },
        { label: '160+', min: 161, max: Number.POSITIVE_INFINITY },
    ]
    const rows = buckets.map(bucket => {
        const inBucket = fns.filter(fn => fn.loc >= bucket.min && fn.loc <= bucket.max)
        const pure = inBucket.filter(fn => fn.sideEffects.length === 0).length
        const impure = inBucket.length - pure
        return { label: bucket.label, pure, impure }
    })
    const maxCount = Math.max(0, ...rows.flatMap(row => [row.pure, row.impure]))
    const lines = [
        '1. Function LOC distribution histogram',
        'Bucket  | Pure                         | Impure',
        '--------+------------------------------+------------------------------',
    ]
    for (const row of rows) {
        lines.push(`${row.label.padEnd(7)} | ${String(row.pure).padStart(4)} ${bar(row.pure, maxCount).padEnd(24)} | ${String(row.impure).padStart(4)} ${bar(row.impure, maxCount)}`)
    }
    return lines.join('\n')
}

function reportFunctionTable(title: string, fns: readonly FnEntry[]): string {
    const lines = [
        title,
        `${'file:line'.padEnd(64)} | ${'name'.padEnd(34)} |  LOC | purity | side-effect categories`,
        `${'-'.repeat(64)}-+-${'-'.repeat(34)}-+------+--------+-----------------------`,
    ]
    for (const fn of fns) lines.push(formatFnRow(fn))
    if (fns.length === 0) lines.push('(none)')
    return lines.join('\n')
}

function reportLayerHealth(byLayer: Record<ArchLayer, FunctionHealthStats>): string {
    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const lines = [
        '4. Per-layer health summary',
        'Layer       | Functions pure/impure | Median pure | Median impure | Ratio | P75 | P90 | >50 LOC',
        '------------+------------------------+-------------+---------------+-------+-----+-----+--------',
    ]
    for (const layer of layers) {
        const s = byLayer[layer]
        if (s.fnCount === 0) continue
        const pureMedian = median(s.pureLocs)
        const impureMedian = median(s.impureLocs)
        lines.push(`${layer.padEnd(11)} | ${String(s.pureCount).padStart(5)} / ${String(s.impureCount).padEnd(12)} | ${fmt(pureMedian).padStart(11)} | ${fmt(impureMedian).padStart(13)} | ${fmtRatio(pureMedian, impureMedian).padStart(5)} | ${fmt(percentile(s.allLocs, 75)).padStart(3)} | ${fmt(percentile(s.allLocs, 90)).padStart(3)} | ${String(s.over50Count).padStart(7)}`)
    }
    return lines.join('\n')
}

function reportHotspotFiles(fns: readonly FnEntry[]): string {
    const byFile: Map<string, FnEntry[]> = new Map()
    for (const fn of fns) {
        const existing = byFile.get(fn.file)
        if (existing) existing.push(fn); else byFile.set(fn.file, [fn])
    }

    const hotspots = [...byFile.entries()].flatMap(([file, fileFns]) => {
        const pureMedian = median(fileFns.filter(fn => fn.sideEffects.length === 0).map(fn => fn.loc))
        const impureMedian = median(fileFns.filter(fn => fn.sideEffects.length > 0).map(fn => fn.loc))
        if (impureMedian === null) return []
        if (pureMedian !== null && impureMedian <= pureMedian * 2) return []
        const ratio = pureMedian === null || pureMedian === 0 ? Number.POSITIVE_INFINITY : impureMedian / pureMedian
        return [{
            file,
            pureMedian,
            impureMedian,
            ratio,
            impureCount: fileFns.filter(fn => fn.sideEffects.length > 0).length,
            fnCount: fileFns.length,
        }]
    }).sort((a, b) => b.ratio - a.ratio || (b.impureMedian ?? 0) - (a.impureMedian ?? 0)).slice(0, 10)

    const lines = [
        '5. Complexity hotspot files',
        'File                                                             | Median pure | Median impure | Ratio | Impure / total',
        '-----------------------------------------------------------------+-------------+---------------+-------+---------------',
    ]
    for (const h of hotspots) {
        const ratio = h.ratio === Number.POSITIVE_INFINITY ? 'INF' : h.ratio.toFixed(2)
        lines.push(`${truncate(h.file, 64).padEnd(64)} | ${fmt(h.pureMedian).padStart(11)} | ${fmt(h.impureMedian).padStart(13)} | ${ratio.padStart(5)} | ${String(h.impureCount).padStart(6)} / ${String(h.fnCount).padEnd(5)}`)
    }
    return lines.join('\n')
}

function reportFunctionHealth(fns: readonly FnEntry[], byLayer: Record<ArchLayer, FunctionHealthStats>): string {
    const longest = [...fns].sort((a, b) => b.loc - a.loc).slice(0, 20)
    const longestImpure = fns.filter(fn => fn.sideEffects.length > 0).sort((a, b) => b.loc - a.loc).slice(0, 20)
    return [
        '',
        'Function-level health diagnostics',
        '(LOC = non-empty lines inside function bodies, AST-based side-effect detection)',
        '',
        reportFunctionHistogram(fns),
        '',
        reportFunctionTable('2. Top 20 longest functions overall', longest),
        '',
        reportFunctionTable('3. Top 20 longest impure functions', longestImpure),
        '',
        reportLayerHealth(byLayer),
        '',
        reportHotspotFiles(fns),
        '',
    ].join('\n')
}

// ── tests ──────────────────────────────────────────────────────────

describe('function-level health diagnostics', () => {
    it('prints function size and impurity health diagnostics', async () => {
        const { fns, byLayer } = await analyze()
        console.info(reportFunctionHealth(fns, byLayer))
    })
})
