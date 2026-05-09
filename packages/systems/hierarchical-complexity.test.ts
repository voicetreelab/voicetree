import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')

type PackageInfo = {
    readonly name: string
    readonly dirName: string
    readonly srcRoot: string
}

type SourceFile = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly relToSrc: string
    readonly packageName: string
}

type Edge = {
    readonly from: SourceFile
    readonly to: SourceFile
}

type ImportGraph = {
    readonly files: readonly SourceFile[]
    readonly edges: readonly Edge[]
}

type CommunityReport = {
    readonly id: string
    readonly fileCount: number
    readonly boundaryFileCount: number
    readonly boundaryWidth: number
    readonly fanOut: number
    readonly fanIn: number
    readonly outEdges: number
    readonly inEdges: number
    readonly couplingIntensity: number
}

type SiblingGroupReport = {
    readonly parentId: string
    readonly depth: number
    readonly communityCount: number
    readonly fileCount: number
    readonly communities: readonly CommunityReport[]
    readonly crossEdgeCount: number
    readonly treeWidth: number
    readonly normalizedEntropy: number
    readonly dsm: { readonly names: readonly string[]; readonly matrix: readonly (readonly number[])[] }
}

// --- Discovery (duplicated from existing tests) ---

async function discoverPackages(): Promise<PackageInfo[]> {
    const entries = await readdir(SYSTEMS_ROOT, {withFileTypes: true})
    const results = await Promise.all(entries.map(async entry => {
        if (!entry.isDirectory()) return null
        const pkgJsonPath = join(SYSTEMS_ROOT, entry.name, 'package.json')
        try {
            const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
            return {name: pkgJson.name as string, dirName: entry.name, srcRoot: join(SYSTEMS_ROOT, entry.name, 'src')}
        } catch { return null }
    }))
    return results.filter((p): p is PackageInfo => p !== null).sort((a, b) => a.dirName.localeCompare(b.dirName))
}

async function pathExists(p: string): Promise<boolean> {
    try { await stat(p); return true } catch { return false }
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.spec.ts') && !path.includes('/__tests__/'))
            return [path]
        return []
    }))
    return nested.flat().sort()
}

async function scanSourceFiles(packages: readonly PackageInfo[]): Promise<SourceFile[]> {
    const nested = await Promise.all(packages.map(async pkg => {
        const files = await listProductionSources(pkg.srcRoot)
        return files.map(file => ({
            absolutePath: resolve(file),
            relativePath: relative(REPO_ROOT, file),
            relToSrc: relative(pkg.srcRoot, file),
            packageName: pkg.dirName,
        }))
    }))
    return nested.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

// --- Import Resolution ---

function importSpecifiers(filePath: string, text: string): string[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const specifiers: string[] = []
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier))
            specifiers.push(statement.moduleSpecifier.text)
        else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier))
            specifiers.push(statement.moduleSpecifier.text)
    }
    return specifiers
}

function resolveFileCandidate(basePath: string, knownPaths: ReadonlySet<string>): string | null {
    const candidates = basePath.endsWith('.ts') ? [basePath] : [basePath, `${basePath}.ts`, join(basePath, 'index.ts')]
    return candidates.map(c => resolve(c)).find(c => knownPaths.has(c)) ?? null
}

function resolvePackageImport(
    specifier: string,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
    knownPaths: ReadonlySet<string>,
): string | null {
    for (const [npmName, pkg] of packagesByNpmName) {
        if (specifier !== npmName && !specifier.startsWith(npmName + '/')) continue
        const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
        return resolveFileCandidate(join(pkg.srcRoot, subPath), knownPaths)
    }
    return null
}

async function buildImportGraph(packages: readonly PackageInfo[]): Promise<ImportGraph> {
    const files = await scanSourceFiles(packages)
    const filesByPath = new Map(files.map(f => [f.absolutePath, f]))
    const knownPaths = new Set(filesByPath.keys())
    const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))
    const dedupedEdges = new Set<string>()

    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        for (const specifier of importSpecifiers(file.absolutePath, text)) {
            let toPath: string | null = null
            if (specifier.startsWith('.')) {
                toPath = resolveFileCandidate(join(dirname(file.absolutePath), specifier), knownPaths)
            } else {
                toPath = resolvePackageImport(specifier, packagesByNpmName, knownPaths)
            }
            if (!toPath || toPath === file.absolutePath) continue
            dedupedEdges.add(`${file.absolutePath}\0${toPath}`)
        }
    }

    const edges = [...dedupedEdges].sort().map(key => {
        const [fromPath, toPath] = key.split('\0')
        return {from: filesByPath.get(fromPath)!, to: filesByPath.get(toPath)!}
    })

    return {files, edges}
}

// --- Hierarchical Community Assignment ---

function communityAtDepth(pkg: string, relToSrc: string, depth: number): string {
    if (depth === 0) return pkg
    const dir = dirname(relToSrc)
    const parts = dir === '.' ? [] : dir.split('/')
    const segments = parts.slice(0, depth)
    if (segments.length < depth) return [pkg, ...segments, '__root__'].join('/')
    return [pkg, ...segments].join('/')
}

function siblingGroupParent(communityId: string, depth: number): string {
    if (depth <= 1) {
        const slash = communityId.indexOf('/')
        return slash === -1 ? communityId : communityId.slice(0, slash)
    }
    const parts = communityId.split('/')
    return parts.slice(0, depth).join('/')
}

function formSiblingGroups(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    depth: number,
): SiblingGroupReport[] {
    const fileCommunities = new Map<string, string>()
    for (const file of files) {
        fileCommunities.set(file.absolutePath, communityAtDepth(file.packageName, file.relToSrc, depth))
    }

    const communitiesByParent = new Map<string, Map<string, SourceFile[]>>()
    for (const file of files) {
        const community = fileCommunities.get(file.absolutePath)!
        const parent = siblingGroupParent(community, depth)
        if (!communitiesByParent.has(parent)) communitiesByParent.set(parent, new Map())
        const parentMap = communitiesByParent.get(parent)!
        if (!parentMap.has(community)) parentMap.set(community, [])
        parentMap.get(community)!.push(file)
    }

    const reports: SiblingGroupReport[] = []

    for (const [parentId, communityMap] of [...communitiesByParent].sort(([a], [b]) => a.localeCompare(b))) {
        if (communityMap.size < 2) continue

        const crossEdges = edges.filter(e => {
            const fromC = fileCommunities.get(e.from.absolutePath)!
            const toC = fileCommunities.get(e.to.absolutePath)!
            if (fromC === toC) return false
            const fromP = siblingGroupParent(fromC, depth)
            const toP = siblingGroupParent(toC, depth)
            return fromP === parentId && toP === parentId
        })

        const communityNames = [...communityMap.keys()].sort()
        const shortNames = communityNames.map(c => c.split('/').pop()!)

        const boundaryFiles = new Set<string>()
        for (const e of crossEdges) {
            boundaryFiles.add(e.from.absolutePath)
            boundaryFiles.add(e.to.absolutePath)
        }

        const outEdgesByComm = new Map<string, number>()
        const inEdgesByComm = new Map<string, number>()
        const fanOutTargets = new Map<string, Set<string>>()
        const fanInSources = new Map<string, Set<string>>()
        for (const name of communityNames) {
            outEdgesByComm.set(name, 0)
            inEdgesByComm.set(name, 0)
            fanOutTargets.set(name, new Set())
            fanInSources.set(name, new Set())
        }
        for (const e of crossEdges) {
            const fromC = fileCommunities.get(e.from.absolutePath)!
            const toC = fileCommunities.get(e.to.absolutePath)!
            outEdgesByComm.set(fromC, (outEdgesByComm.get(fromC) ?? 0) + 1)
            inEdgesByComm.set(toC, (inEdgesByComm.get(toC) ?? 0) + 1)
            fanOutTargets.get(fromC)!.add(toC)
            fanInSources.get(toC)!.add(fromC)
        }

        const communityReports: CommunityReport[] = communityNames.map(name => {
            const cFiles = communityMap.get(name)!
            const bCount = cFiles.filter(f => boundaryFiles.has(f.absolutePath)).length
            const outE = outEdgesByComm.get(name) ?? 0
            const inE = inEdgesByComm.get(name) ?? 0
            return {
                id: name,
                fileCount: cFiles.length,
                boundaryFileCount: bCount,
                boundaryWidth: cFiles.length === 0 ? 0 : bCount / cFiles.length,
                fanOut: fanOutTargets.get(name)?.size ?? 0,
                fanIn: fanInSources.get(name)?.size ?? 0,
                outEdges: outE,
                inEdges: inE,
                couplingIntensity: cFiles.length === 0 ? 0 : (outE + inE) / cFiles.length,
            }
        })

        const treeWidth = computeTreeWidth(crossEdges, boundaryFiles)
        const entropy = computeNormalizedEntropy(crossEdges, communityNames, fileCommunities)
        const dsm = computeDsm(crossEdges, communityNames, shortNames, fileCommunities)

        const totalFiles = [...communityMap.values()].reduce((sum, f) => sum + f.length, 0)

        reports.push({
            parentId,
            depth,
            communityCount: communityMap.size,
            fileCount: totalFiles,
            communities: communityReports,
            crossEdgeCount: crossEdges.length,
            treeWidth,
            normalizedEntropy: entropy,
            dsm,
        })
    }

    return reports
}

// --- Measures ---

function computeTreeWidth(crossEdges: readonly Edge[], boundaryFiles: ReadonlySet<string>): number {
    if (boundaryFiles.size === 0) return 0
    const adjacency = new Map<string, Set<string>>()
    for (const f of boundaryFiles) adjacency.set(f, new Set())
    for (const e of crossEdges) {
        adjacency.get(e.from.absolutePath)?.add(e.to.absolutePath)
        adjacency.get(e.to.absolutePath)?.add(e.from.absolutePath)
    }

    const unnumbered = new Set(adjacency.keys())
    const numbered = new Set<string>()
    let maxBag = 0

    while (unnumbered.size > 0) {
        let best = ''
        let bestCount = -1
        for (const f of unnumbered) {
            const count = [...(adjacency.get(f) ?? [])].filter(n => numbered.has(n)).length
            if (count > bestCount || (count === bestCount && f < best)) {
                best = f
                bestCount = count
            }
        }
        maxBag = Math.max(maxBag, bestCount + 1)
        numbered.add(best)
        unnumbered.delete(best)
    }

    return Math.max(0, maxBag - 1)
}

function computeNormalizedEntropy(
    crossEdges: readonly Edge[],
    communityNames: readonly string[],
    fileCommunities: ReadonlyMap<string, string>,
): number {
    if (communityNames.length < 2) return 0
    const degrees = new Map<string, number>()
    for (const name of communityNames) degrees.set(name, 0)

    for (const e of crossEdges) {
        const fromC = fileCommunities.get(e.from.absolutePath)!
        const toC = fileCommunities.get(e.to.absolutePath)!
        degrees.set(fromC, (degrees.get(fromC) ?? 0) + 1)
        degrees.set(toC, (degrees.get(toC) ?? 0) + 1)
    }

    const totalDegree = [...degrees.values()].reduce((a, b) => a + b, 0)
    if (totalDegree === 0) return 0

    let entropy = 0
    for (const d of degrees.values()) {
        if (d === 0) continue
        const p = d / totalDegree
        entropy -= p * Math.log2(p)
    }

    return entropy / Math.log2(communityNames.length)
}

function computeDsm(
    crossEdges: readonly Edge[],
    communityNames: readonly string[],
    shortNames: readonly string[],
    fileCommunities: ReadonlyMap<string, string>,
): { names: readonly string[]; matrix: readonly (readonly number[])[] } {
    const idx = new Map(communityNames.map((n, i) => [n, i]))
    const n = communityNames.length
    const matrix: number[][] = Array.from({length: n}, () => Array(n).fill(0))

    for (const e of crossEdges) {
        const fromIdx = idx.get(fileCommunities.get(e.from.absolutePath)!)!
        const toIdx = idx.get(fileCommunities.get(e.to.absolutePath)!)!
        matrix[fromIdx][toIdx]++
    }

    return {names: shortNames, matrix}
}

// --- Report Formatting ---

function formatGroupReport(group: SiblingGroupReport): string {
    const lines: string[] = []
    lines.push(`\n  Sibling Group: ${group.parentId} (${group.communityCount} communities, ${group.fileCount} files, ${group.crossEdgeCount} cross-edges)`)

    lines.push('    Boundary Width:')
    for (const c of [...group.communities].sort((a, b) => b.boundaryWidth - a.boundaryWidth)) {
        const shortName = c.id.split('/').pop()!
        const bar = '█'.repeat(Math.round(c.boundaryWidth * 20))
        lines.push(`      ${shortName.padEnd(20)} ${String(c.boundaryFileCount).padStart(3)}/${String(c.fileCount).padEnd(3)} = ${c.boundaryWidth.toFixed(3)} ${bar}`)
    }

    lines.push(`    Tree-Width (MCS): ${group.treeWidth}`)
    lines.push(`    Normalized Entropy: ${group.normalizedEntropy.toFixed(3)}`)

    const maxNameLen = Math.max(...group.dsm.names.map(n => n.length), 3)
    const colWidth = Math.max(maxNameLen, 4)
    lines.push(`    DSM:`)
    const header = '      ' + ''.padEnd(colWidth + 1) + group.dsm.names.map(n => n.slice(0, colWidth).padStart(colWidth)).join(' ')
    lines.push(header)
    for (let i = 0; i < group.dsm.names.length; i++) {
        const row = group.dsm.matrix[i]
        const cells = row.map((v, j) => i === j ? '—'.padStart(colWidth) : String(v).padStart(colWidth))
        lines.push(`      ${group.dsm.names[i].slice(0, colWidth).padEnd(colWidth + 1)}${cells.join(' ')}`)
    }

    return lines.join('\n')
}

// --- Test ---

describe('hierarchical complexity', () => {
    it('reports complexity at all directory containment levels', async () => {
        const packages = await discoverPackages()
        const graph = await buildImportGraph(packages)

        const maxDepth = Math.max(...graph.files.map(f => {
            const dir = dirname(f.relToSrc)
            return dir === '.' ? 0 : dir.split('/').length
        }))

        const output: string[] = ['']

        for (let depth = 1; depth <= maxDepth; depth++) {
            const groups = formSiblingGroups(graph.files, graph.edges, depth)
            if (groups.length === 0) continue

            output.push(`\n${'='.repeat(60)}`)
            output.push(`DEPTH ${depth}: ${depth === 1 ? 'Subdirectory' : `Sub${'sub'.repeat(depth - 1)}directory`}-Level Complexity`)
            output.push('='.repeat(60))

            for (const group of groups) {
                output.push(formatGroupReport(group))
            }

            const worstBW = Math.max(...groups.map(g => Math.max(...g.communities.map(c => c.boundaryWidth))))
            const worstTW = Math.max(...groups.map(g => g.treeWidth))
            const meanEntropy = groups.reduce((s, g) => s + g.normalizedEntropy, 0) / groups.length

            output.push(`\n  --- Depth ${depth} Summary ---`)
            output.push(`  Worst boundary width: ${worstBW.toFixed(3)}`)
            output.push(`  Worst tree-width:     ${worstTW}`)
            output.push(`  Mean norm. entropy:   ${meanEntropy.toFixed(3)}`)
        }

        output.push(`\n${'='.repeat(80)}`)
        output.push('RANKING: All communities sorted by boundary width (encapsulation)')
        output.push('='.repeat(80))
        output.push('  BW = boundary_files / total_files')
        output.push('  1.0 = every file crosses boundaries (no encapsulation)')
        output.push('  0.0 = fully internal (perfect encapsulation)\n')

        const allCommunities: { community: CommunityReport; parentId: string; depth: number }[] = []
        for (let depth = 1; depth <= maxDepth; depth++) {
            const groups = formSiblingGroups(graph.files, graph.edges, depth)
            for (const group of groups) {
                for (const c of group.communities) {
                    allCommunities.push({community: c, parentId: group.parentId, depth: group.depth})
                }
            }
        }

        allCommunities.sort((a, b) => {
            const bwDiff = b.community.boundaryWidth - a.community.boundaryWidth
            if (Math.abs(bwDiff) > 0.001) return bwDiff
            return b.community.boundaryFileCount - a.community.boundaryFileCount
        })

        output.push('  ' + [
            '#'.padStart(3),
            'Community'.padEnd(42),
            'Files'.padStart(5),
            'Boundary'.padStart(8),
            'BW'.padStart(6),
            'Bar',
        ].join(' '))
        output.push('  ' + '─'.repeat(80))

        for (const [i, entry] of allCommunities.entries()) {
            const c = entry.community
            const shortId = c.id.replace(/^[^/]+\//, '')
            const bar = '█'.repeat(Math.round(c.boundaryWidth * 20))
            output.push('  ' + [
                String(i + 1).padStart(3),
                `${entry.parentId}/${shortId}`.padEnd(42),
                String(c.fileCount).padStart(5),
                `${c.boundaryFileCount}/${c.fileCount}`.padStart(8),
                c.boundaryWidth.toFixed(3).padStart(6),
                bar,
            ].join(' '))
        }

        console.info(output.join('\n'))
    })
})
