import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')

const NORMALIZED_ENTROPY_BUDGET = 0.953

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

type PackageDegree = {
    readonly packageName: string
    readonly inDegree: number
    readonly outDegree: number
    readonly degree: number
}

type GraphEntropy = {
    readonly rawEntropy: number
    readonly normalizedEntropy: number
    readonly edgeCount: number
    readonly packageDegrees: readonly PackageDegree[]
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
    return results.filter((p): p is PackageInfo => p !== null).sort((a, b) => a.dirName.localeCompare(b.dirName))
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
    return nested.flat().sort()
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

function distinctDirectedPairs(edges: readonly ImportEdge[]): readonly ImportEdge[] {
    const byPair = new Map<string, ImportEdge>()
    for (const edge of edges) {
        const key = `${edge.fromPackage} -> ${edge.toPackage}`
        if (!byPair.has(key)) byPair.set(key, edge)
    }
    return [...byPair.values()].sort((a, b) => `${a.fromPackage} -> ${a.toPackage}`.localeCompare(`${b.fromPackage} -> ${b.toPackage}`))
}

function computeGraphEntropy(packageNames: readonly string[], edges: readonly ImportEdge[]): GraphEntropy {
    const directedPairs = distinctDirectedPairs(edges)
    const inDegrees = new Map(packageNames.map(name => [name, 0]))
    const outDegrees = new Map(packageNames.map(name => [name, 0]))

    for (const edge of directedPairs) {
        outDegrees.set(edge.fromPackage, (outDegrees.get(edge.fromPackage) ?? 0) + 1)
        inDegrees.set(edge.toPackage, (inDegrees.get(edge.toPackage) ?? 0) + 1)
    }

    const packageDegrees = packageNames.map(packageName => {
        const inDegree = inDegrees.get(packageName) ?? 0
        const outDegree = outDegrees.get(packageName) ?? 0
        return {packageName, inDegree, outDegree, degree: inDegree + outDegree}
    })

    const edgeCount = directedPairs.length
    const denominator = 2 * edgeCount
    const rawEntropy = denominator === 0
        ? 0
        : packageDegrees.reduce((sum, pkg) => {
            if (pkg.degree === 0) return sum
            const probability = pkg.degree / denominator
            return sum - probability * Math.log2(probability)
        }, 0)
    const normalizedEntropy = packageNames.length <= 1 ? 0 : rawEntropy / Math.log2(packageNames.length)

    return {rawEntropy, normalizedEntropy, edgeCount, packageDegrees}
}

function formatDecimal(value: number): string {
    return value.toFixed(3)
}

function formatReport(entropy: GraphEntropy): string {
    const lines: string[] = [
        '',
        'Graph entropy of systems package import graph',
        `Edges: ${entropy.edgeCount}`,
        `Raw entropy: ${formatDecimal(entropy.rawEntropy)}`,
        `Normalized entropy: ${formatDecimal(entropy.normalizedEntropy)} / budget ${formatDecimal(NORMALIZED_ENTROPY_BUDGET)}`,
        '',
        '+-----------------+----+-----+--------+',
        '| Package         | In | Out | Degree |',
        '+-----------------+----+-----+--------+',
    ]

    for (const pkg of entropy.packageDegrees) {
        lines.push(`| ${pkg.packageName.padEnd(15)} | ${String(pkg.inDegree).padStart(2)} | ${String(pkg.outDegree).padStart(3)} | ${String(pkg.degree).padStart(6)} |`)
    }

    lines.push('+-----------------+----+-----+--------+')
    return lines.join('\n')
}

describe('graph entropy coupling metric', () => {
    it('systems package import graph stays below the flat-spaghetti entropy budget', async () => {
        const packages = await discoverPackages()
        const packageNames = packages.map(pkg => pkg.dirName)
        const edges = await scanAllEdges(packages)
        const entropy = computeGraphEntropy(packageNames, edges)
        const report = formatReport(entropy)

        console.info(report)

        expect(entropy.normalizedEntropy, report).toBeLessThanOrEqual(NORMALIZED_ENTROPY_BUDGET)
    })
})
