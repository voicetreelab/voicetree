import {readdir, readFile, stat} from 'node:fs/promises'
import {join, relative} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const REPO_ROOT: string = DEFAULT_REPO_ROOT

type ImportEdge = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly importPath: string
    readonly symbol: string
    readonly file: string
    readonly line: number
    readonly isTypeOnly: boolean
    readonly isDynamic: boolean
}

// Budget: max distinct VALUE symbols allowed per directed pair.
// Type-only imports are free (zero runtime coupling).
// Missing pairs default to 0 — any new cross-package coupling breaks CI.
// Initial values captured 2026-05-14 after widening discovery to the whole repo
// (webapp + packages/libraries/* + packages/systems/*). Ratchet down over time.
//
// 2026-05-15 [BF-270]: DOVL+UFV epic structural baseline bump. Three pairs grew
// from new daemon vault lifecycle + folder-state/view wire shapes added across
// JOINT-001 / UFV-2 / BF-245:
//   graph-db-client -> graph-db-protocol: 17 -> 25 (+8)
//   graph-db-server -> graph-state:        7 -> 10 (+3)
//   graph-db-server -> graph-db-protocol:  1 -> 4  (+3)
// 2026-05-21: Tier 2 editor-typing-order fix in writeMarkdownFile.ts needs
// getAppendedSuffix + isAppendOnly + fromNodeToContentWithWikilinks from
// graph-model to compute pending external-append preservation server-side:
//   graph-db-server -> graph-model:       38 -> 41 (+3)
// 2026-05-24: Extract @vt/observability (Pattern P2 deep-function package) so
// tracing.init / tracing.span / tracing.syncSpan are one cohesive capability
// owned by a single library, not three loose symbols re-exported from
// graph-db-client (which also had a copy-pasted twin in graph-db-server).
// Webapp now goes to observability for tracing, not graph-db-client:
//   webapp -> graph-db-client:           11 -> 9 (-2 tracing symbols removed;
//     `subscribeOwnerDiagnostics` remains — see BF-347 note below)
//   webapp -> observability:              0 -> 1 (+tracing facade)
// (graph-db-server -> observability has no row because the only consumer is
// bin/vt-graphd.ts, which lives outside the test's src-only scan scope.)
//
// 2026-05-24 BF-347 owner-diagnostic→span bridge: observability owns the
// data-shape transformation (`bridgeOwnerDiagnostics(subscribe, tracerName)`)
// but does NOT import `subscribeOwnerDiagnostics` from graph-db-client —
// that would close a `graph-db-client → graph-db-server → observability →
// graph-db-client` package cycle. The webapp shell injects the subscribe
// function, keeping observability a dependency-leaf for runtime tracing.
// Even a type-only import would make observability a 2-of-2 boundary
// package under pressure-axes, so the event shape is duplicated structurally
// inside the bridge.
const COUPLING_BUDGET: Readonly<Record<string, number>> = {
    'agent-runtime -> app-config': 1,
    'agent-runtime -> graph-db-server': 12,
    'agent-runtime -> graph-model': 13,
    'app-config -> graph-model': 4,
    'graph-db-client -> graph-db-protocol': 25,
    'graph-db-client -> graph-db-server': 17,
    'graph-db-server -> app-config': 13,
    'graph-db-server -> graph-db-protocol': 4,
    'graph-db-server -> graph-model': 41,
    'graph-db-server -> graph-state': 10,
    'graph-db-server -> graph-tools': 1,
    'graph-state -> graph-model': 8,
    'graph-tools -> graph-model': 2,
    'graph-tools -> graph-state': 12,
    'voicetree-mcp -> agent-runtime': 14,
    'voicetree-mcp -> app-config': 1,
    'voicetree-mcp -> graph-db-server': 8,
    'voicetree-mcp -> graph-model': 9,
    'voicetree-mcp -> graph-state': 1,
    'voicetree-mcp -> graph-tools': 7,
    'webapp -> agent-runtime': 15,
    'webapp -> app-config': 22,
    'webapp -> graph-db-client': 9,
    'webapp -> graph-db-server': 11,
    'webapp -> graph-model': 86,
    'webapp -> graph-state': 19,
    'webapp -> graph-tools': 14,
    'webapp -> observability': 1,
    'webapp -> voicetree-mcp': 13,
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await stat(p)
        return true
    } catch {
        return false
    }
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (entry.isFile()
            && path.endsWith('.ts')
            && !path.endsWith('/__audit_seed__.ts')
            && !path.endsWith('.test.ts')
            && !path.endsWith('.spec.ts')
            && !path.includes('/__tests__/')) {
            return [path]
        }
        return []
    }))
    return nested.flat()
}

function extractImportEdges(
    filePath: string,
    text: string,
    fromPackage: string,
    siblingNames: ReadonlyMap<string, string>,
): ImportEdge[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const edges: ImportEdge[] = []
    const relFile = relative(REPO_ROOT, filePath)

    const resolveTarget = (specifier: string): string | undefined => {
        for (const [npmName, dirName] of siblingNames) {
            if (dirName === fromPackage) continue
            if (specifier === npmName || specifier.startsWith(npmName + '/'))
                return dirName
        }
        return undefined
    }

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            const specifier = statement.moduleSpecifier.text
            const toPackage = resolveTarget(specifier)
            if (!toPackage) continue
            const {line} = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
            const base = {fromPackage, toPackage, importPath: specifier, file: relFile, line: line + 1, isDynamic: false}
            const clauseTypeOnly = statement.importClause?.isTypeOnly ?? false

            if (!statement.importClause) {
                edges.push({...base, symbol: '(side-effect)', isTypeOnly: false})
                continue
            }

            if (statement.importClause.name) {
                edges.push({...base, symbol: 'default', isTypeOnly: clauseTypeOnly})
            }

            const bindings = statement.importClause.namedBindings
            if (bindings) {
                if (ts.isNamespaceImport(bindings)) {
                    edges.push({...base, symbol: '*', isTypeOnly: clauseTypeOnly})
                } else if (ts.isNamedImports(bindings)) {
                    for (const el of bindings.elements) {
                        edges.push({
                            ...base,
                            symbol: (el.propertyName ?? el.name).text,
                            isTypeOnly: clauseTypeOnly || el.isTypeOnly,
                        })
                    }
                }
            }
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            const specifier = statement.moduleSpecifier.text
            const toPackage = resolveTarget(specifier)
            if (!toPackage) continue
            const {line} = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
            const base = {fromPackage, toPackage, importPath: specifier, file: relFile, line: line + 1, isDynamic: false}
            const declTypeOnly = statement.isTypeOnly

            if (statement.exportClause) {
                if (ts.isNamedExports(statement.exportClause)) {
                    for (const el of statement.exportClause.elements) {
                        edges.push({
                            ...base,
                            symbol: (el.propertyName ?? el.name).text,
                            isTypeOnly: declTypeOnly || el.isTypeOnly,
                        })
                    }
                } else if (ts.isNamespaceExport(statement.exportClause)) {
                    edges.push({...base, symbol: '*', isTypeOnly: declTypeOnly})
                }
            } else {
                edges.push({...base, symbol: '*', isTypeOnly: declTypeOnly})
            }
        }
    }

    const walkForDynamic = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
            const specifier = node.arguments[0].text
            const toPackage = resolveTarget(specifier)
            if (toPackage) {
                const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
                edges.push({
                    fromPackage, toPackage, importPath: specifier,
                    symbol: '*', file: relFile, line: line + 1,
                    isTypeOnly: false, isDynamic: true,
                })
            }
        }
        ts.forEachChild(node, walkForDynamic)
    }
    ts.forEachChild(sourceFile, walkForDynamic)

    return edges
}

async function scanAllEdges(packages: readonly PackageInfo[]): Promise<ImportEdge[]> {
    const siblingNames: ReadonlyMap<string, string> = new Map(packages.map(p => [p.name, p.dirName]))
    const allEdges: ImportEdge[] = []

    for (const pkg of packages) {
        const files = await listProductionSources(pkg.srcRoot)
        const fileEdges = await Promise.all(files.map(async file => {
            const text = await readFile(file, 'utf8')
            return extractImportEdges(file, text, pkg.dirName, siblingNames)
        }))
        allEdges.push(...fileEdges.flat())
    }

    return allEdges
}

function groupByPair(edges: readonly ImportEdge[]): Map<string, ImportEdge[]> {
    const grouped = new Map<string, ImportEdge[]>()
    for (const edge of edges) {
        const key = `${edge.fromPackage} -> ${edge.toPackage}`
        const list = grouped.get(key)
        if (list) list.push(edge)
        else grouped.set(key, [edge])
    }
    return grouped
}

function distinctValueSymbols(edges: readonly ImportEdge[]): string[] {
    return [...new Set(edges.filter(e => !e.isTypeOnly).map(e => e.symbol))].sort()
}

function distinctTypeSymbols(edges: readonly ImportEdge[]): string[] {
    return [...new Set(edges.filter(e => e.isTypeOnly).map(e => e.symbol))].sort()
}

function formatReport(byPair: ReadonlyMap<string, ImportEdge[]>): string {
    const lines: string[] = [
        '',
        '┌─────────────────────────────────────────────┬───────┬───────┬────────┬────────┐',
        '│ Pair                                        │ Value │ Types │ Budget │ Status │',
        '├─────────────────────────────────────────────┼───────┼───────┼────────┼────────┤',
    ]

    for (const [pair, edges] of [...byPair].sort(([a], [b]) => a.localeCompare(b))) {
        const valueSyms = distinctValueSymbols(edges)
        const typeSyms = distinctTypeSymbols(edges)
        const budget = COUPLING_BUDGET[pair] ?? 0
        const status = valueSyms.length <= budget ? 'OK' : 'OVER'
        lines.push(`│ ${pair.padEnd(43)} │ ${String(valueSyms.length).padStart(5)} │ ${String(typeSyms.length).padStart(5)} │ ${String(budget).padStart(6)} │ ${status.padStart(6)} │`)
    }

    lines.push('└─────────────────────────────────────────────┴───────┴───────┴────────┴────────┘')
    lines.push('')

    for (const [pair, edges] of [...byPair].sort(([a], [b]) => a.localeCompare(b))) {
        const allSymbols = [...new Set(edges.map(e => e.symbol))].sort()
        lines.push(`${pair}:`)
        for (const sym of allSymbols) {
            const symEdges = edges.filter(e => e.symbol === sym)
            const typeOnly = symEdges.every(e => e.isTypeOnly)
            const dynamic = symEdges.some(e => e.isDynamic)
            const flags = [typeOnly ? 'type' : '', dynamic ? 'dynamic' : ''].filter(Boolean).join(',')
            const prefix = flags ? `(${flags}) `.padEnd(7) : '       '
            lines.push(`  ${prefix}${sym}`)
        }
    }

    return lines.join('\n')
}

describe('cross-package coupling bounds', () => {
    it('sibling systems-package imports stay within budget', async () => {
        const packages = await discoverPackages()
        const edges = await scanAllEdges(packages)
        const byPair = groupByPair(edges)

        console.info(formatReport(byPair))

        const violations: string[] = []
        const pairSummaries: {pair: string; count: number; budget: number}[] = []
        for (const [pair, pairEdges] of byPair) {
            const count = distinctValueSymbols(pairEdges).length
            const budget = COUPLING_BUDGET[pair] ?? 0
            pairSummaries.push({pair, count, budget})
            if (count > budget) {
                violations.push(`${pair}: ${count} value symbols, budget is ${budget}`)
            }
        }

        await recordHealthMetric({
            metricId: 'cross-package-coupling',
            metricName: 'Cross-Package Coupling',
            description: 'Sibling systems-package import pairs exceeding their value-symbol budgets.',
            category: 'Coupling',
            current: violations.length,
            budget: 0,
            comparison: 'lte',
            unit: 'violations',
            details: {
                violations,
                pairSummaries,
            },
        })

        expect(violations, violations.join('\n')).toEqual([])
    })
})
