import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')

type PackageInfo = {
    readonly name: string
    readonly dirName: string
    readonly srcRoot: string
}

type ImportEdge = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly importPath: string
    readonly file: string
    readonly line: number
    readonly isTypeOnly: boolean
}

// Budget: max distinct import paths allowed per directed pair.
// Missing pairs default to 0 — any new cross-package coupling breaks CI.
// Ratchet down over time as you decouple.
const COUPLING_BUDGET: Readonly<Record<string, number>> = {
    'agent-runtime -> graph-db-server': 9,
    'graph-db-client -> graph-db-server': 1,
    'voicetree-mcp -> agent-runtime': 1,
    'voicetree-mcp -> graph-db-server': 5,
}

async function discoverPackages(): Promise<PackageInfo[]> {
    const entries = await readdir(SYSTEMS_ROOT, {withFileTypes: true})
    const results = await Promise.all(entries.map(async entry => {
        if (!entry.isDirectory()) return null
        const pkgJsonPath = join(SYSTEMS_ROOT, entry.name, 'package.json')
        try {
            const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
            return {
                name: pkgJson.name as string,
                dirName: entry.name,
                srcRoot: join(SYSTEMS_ROOT, entry.name, 'src'),
            }
        } catch {
            return null
        }
    }))
    return results.filter((p): p is PackageInfo => p !== null)
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
        if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.spec.ts') && !path.includes('/__tests__/')) {
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

    for (const statement of sourceFile.statements) {
        let specifier: string | undefined
        let isTypeOnly = false

        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            specifier = statement.moduleSpecifier.text
            isTypeOnly = statement.importClause?.isTypeOnly ?? false
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            specifier = statement.moduleSpecifier.text
            isTypeOnly = statement.isTypeOnly
        }

        if (!specifier) continue

        for (const [npmName, dirName] of siblingNames) {
            if (dirName === fromPackage) continue
            if (specifier === npmName || specifier.startsWith(npmName + '/')) {
                const {line} = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
                edges.push({fromPackage, toPackage: dirName, importPath: specifier, file: relative(REPO_ROOT, filePath), line: line + 1, isTypeOnly})
                break
            }
        }
    }

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

function distinctPaths(edges: readonly ImportEdge[]): string[] {
    return [...new Set(edges.map(e => e.importPath))].sort()
}

function formatReport(byPair: ReadonlyMap<string, ImportEdge[]>): string {
    const lines: string[] = [
        '',
        '┌─────────────────────────────────────────────┬───────┬────────┬────────┐',
        '│ Pair                                        │ Paths │ Budget │ Status │',
        '├─────────────────────────────────────────────┼───────┼────────┼────────┤',
    ]

    for (const [pair, edges] of [...byPair].sort(([a], [b]) => a.localeCompare(b))) {
        const paths = distinctPaths(edges)
        const budget = COUPLING_BUDGET[pair] ?? 0
        const status = paths.length <= budget ? 'OK' : 'OVER'
        lines.push(`│ ${pair.padEnd(43)} │ ${String(paths.length).padStart(5)} │ ${String(budget).padStart(6)} │ ${status.padStart(6)} │`)
    }

    lines.push('└─────────────────────────────────────────────┴───────┴────────┴────────┘')
    lines.push('')

    for (const [pair, edges] of [...byPair].sort(([a], [b]) => a.localeCompare(b))) {
        const paths = distinctPaths(edges)
        lines.push(`${pair}:`)
        for (const p of paths) {
            const typeOnly = edges.filter(e => e.importPath === p).every(e => e.isTypeOnly)
            lines.push(`  ${typeOnly ? '(type) ' : '       '}${p}`)
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
        for (const [pair, pairEdges] of byPair) {
            const count = distinctPaths(pairEdges).length
            const budget = COUPLING_BUDGET[pair] ?? 0
            if (count > budget) {
                violations.push(`${pair}: ${count} distinct import paths, budget is ${budget}`)
            }
        }

        expect(violations, violations.join('\n')).toEqual([])
    })

    it('no circular dependency chains between packages', async () => {
        const packages = await discoverPackages()
        const edges = await scanAllEdges(packages)

        const adjacency = new Map<string, Set<string>>()
        for (const edge of edges) {
            const deps = adjacency.get(edge.fromPackage)
            if (deps) deps.add(edge.toPackage)
            else adjacency.set(edge.fromPackage, new Set([edge.toPackage]))
        }

        const cycles: string[] = []
        for (const pkg of packages) {
            const visited = new Set<string>()
            const stack = [pkg.dirName]
            while (stack.length > 0) {
                const current = stack.pop()!
                if (current === pkg.dirName && visited.size > 0) {
                    cycles.push(`cycle involving ${pkg.dirName}`)
                    break
                }
                if (visited.has(current)) continue
                visited.add(current)
                const deps = adjacency.get(current)
                if (deps) stack.push(...deps)
            }
        }

        expect(cycles, cycles.join('\n')).toEqual([])
    })
})
