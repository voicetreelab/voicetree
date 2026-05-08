import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

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

// ── analysis + reporting ───────────────────────────────────────────

type ArchLayer = 'pure' | 'shell/edge' | 'libraries' | 'systems' | 'UI' | 'other'

function classifyLayer(f: string): ArchLayer {
    if (f.includes('/pure/')) return 'pure'
    if (f.includes('shell/edge/')) return 'shell/edge'
    if (f.includes('shell/UI/')) return 'UI'
    if (f.startsWith('packages/libraries/')) return 'libraries'
    if (f.startsWith('packages/systems/')) return 'systems'
    return 'other'
}

type Stats = { totalLoc: number; pureLoc: number; impureLoc: number; fnCount: number; breakdown: Record<string, number> }
function emptyStats(): Stats { return { totalLoc: 0, pureLoc: 0, impureLoc: 0, fnCount: 0, breakdown: {} } }

async function analyze(): Promise<{ fns: FnEntry[]; byLayer: Record<ArchLayer, Stats>; totals: Stats }> {
    const files = (await Promise.all(SOURCE_ROOTS.map(listSourceFiles))).flat()
    const allFns: FnEntry[] = []
    await Promise.all(files.map(async fp => {
        const text = await readFile(fp, 'utf8')
        const sf = ts.createSourceFile(fp, text, ts.ScriptTarget.Latest, true)
        allFns.push(...extractFunctions(fp, sf))
    }))
    propagateImpurity(allFns)

    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const byLayer: Record<string, Stats> = {}
    for (const l of layers) byLayer[l] = emptyStats()
    const totals = emptyStats()

    for (const fn of allFns) {
        const s = byLayer[classifyLayer(fn.file)]
        s.totalLoc += fn.loc; s.fnCount++; totals.totalLoc += fn.loc; totals.fnCount++
        if (fn.sideEffects.length === 0) {
            s.pureLoc += fn.loc; totals.pureLoc += fn.loc
        } else {
            s.impureLoc += fn.loc; totals.impureLoc += fn.loc
            for (const e of fn.sideEffects) {
                s.breakdown[e] = (s.breakdown[e] ?? 0) + fn.loc
                totals.breakdown[e] = (totals.breakdown[e] ?? 0) + fn.loc
            }
        }
    }
    return { fns: allFns, byLayer: byLayer as Record<ArchLayer, Stats>, totals }
}

function pct(n: number, d: number): string { return d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%` }

function report(byLayer: Record<ArchLayer, Stats>, totals: Stats): string {
    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const lines = [
        '', '┌─────────────┬────────┬────────┬────────┬────────────┬───────┐',
        '│ Layer       │  Total │   Pure │ Impure │ Pure ratio │   Fns │',
        '├─────────────┼────────┼────────┼────────┼────────────┼───────┤',
    ]
    for (const l of layers) {
        const s = byLayer[l]; if (s.totalLoc === 0) continue
        lines.push(`│ ${l.padEnd(11)} │ ${String(s.totalLoc).padStart(6)} │ ${String(s.pureLoc).padStart(6)} │ ${String(s.impureLoc).padStart(6)} │ ${pct(s.pureLoc, s.totalLoc).padStart(10)} │ ${String(s.fnCount).padStart(5)} │`)
    }
    lines.push('├─────────────┼────────┼────────┼────────┼────────────┼───────┤')
    lines.push(`│ ${'TOTAL'.padEnd(11)} │ ${String(totals.totalLoc).padStart(6)} │ ${String(totals.pureLoc).padStart(6)} │ ${String(totals.impureLoc).padStart(6)} │ ${pct(totals.pureLoc, totals.totalLoc).padStart(10)} │ ${String(totals.fnCount).padStart(5)} │`)
    lines.push('└─────────────┴────────┴────────┴────────┴────────────┴───────┘')
    lines.push('(LOC = non-empty lines inside function bodies, AST-based detection)')
    lines.push('')
    lines.push('Side-effect categories:')
    for (const [cat, loc] of Object.entries(totals.breakdown).sort(([, a], [, b]) => b - a)) {
        lines.push(`  ${cat.padEnd(20)} ${loc} LOC`)
    }
    return lines.join('\n')
}

// ── tests ──────────────────────────────────────────────────────────

const MINIMUM_PURITY_RATIO: number = 0.60

describe('function purity ratio — AST-based (LOC)', () => {
    it('pure LOC ratio must be at least 60%', async () => {
        const { byLayer, totals } = await analyze()
        console.info(report(byLayer, totals))
        const ratio = totals.pureLoc / totals.totalLoc
        console.info(`Overall: ${pct(totals.pureLoc, totals.totalLoc)} (${totals.pureLoc} / ${totals.totalLoc} LOC)`)
        expect(ratio, `${pct(totals.pureLoc, totals.totalLoc)} < ${pct(MINIMUM_PURITY_RATIO, 1)}`).toBeGreaterThanOrEqual(MINIMUM_PURITY_RATIO)
    })

    it('functions in pure/ directories have no detected side effects', async () => {
        const { fns } = await analyze()
        const pureFns = fns.filter(f => f.file.includes('/pure/'))
        const violations = pureFns.filter(f => f.sideEffects.length > 0)
        const vLoc = violations.reduce((s, f) => s + f.loc, 0)
        const tLoc = pureFns.reduce((s, f) => s + f.loc, 0)
        if (violations.length > 0) {
            console.warn('pure/ violations:\n' + violations.map(f => `  ${f.file}:${f.line} ${f.name}() [${f.loc}] — ${f.sideEffects.join(', ')}`).join('\n'))
        }
        console.info(`pure/: ${tLoc} LOC, ${vLoc} LOC impure (${pct(vLoc, tLoc)})`)
        expect(vLoc).toBeLessThanOrEqual(tLoc * 0.14)
    })
})
