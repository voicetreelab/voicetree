/**
 * SPIKE — NOT production code. Throwaway prototype for
 * brain/mem/openspec/changes/subgraph-scoped-health-checks.
 *
 * Goal: given a list of changed files, return an ImportGraph-shaped object
 * that contains
 *   (a) every file in the touched community(ies) at depth=1, and
 *   (b) N-hop importer/importee neighbors by PATH ONLY (no AST of out-of-community files —
 *       we still need to *know* edges exist for the priority-score input, but the AST cost
 *       is what we're trying to avoid),
 * plus the file->community map.
 *
 * Honest scoping for the spike:
 *  - We reuse the full-graph builder for files+edges (since the per-file IO is the bottleneck),
 *    then trim to the subgraph. This is NOT the speedup target for a real implementation —
 *    a real subgraph extractor would only readFile() touched-community files, then resolve
 *    *outbound* imports by path. We add a "lean" path that does exactly that, so we can
 *    time the actually-realistic version.
 *  - Subgraph definition: union of communities-at-depth-1 of the changed files, plus all
 *    files transitively reachable as importers (1 hop) and importees (1 hop) by name.
 *    For the per-community SCORE of touched communities, only the touched community's
 *    files + the cross-community edges to siblings under the same parent matter, which is
 *    what the structural-orange measure actually consumes (intra-parent edges).
 */
import {dirname, join, relative, resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../src/_shared/discovery/discover-packages.js'
import {
    buildImportGraph,
    extractImportSpecifiers,
    listProductionSources,
    resolveFileCandidate,
    scanSourceFiles,
    type Edge,
    type ImportGraph,
    type SourceFile,
} from '../src/_shared/graph/import-graph.js'

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

export type Subgraph = {
    readonly files: readonly SourceFile[]
    readonly edges: readonly Edge[]
    readonly communityMap: ReadonlyMap<string, string>
    readonly touchedCommunities: readonly string[]
    readonly depth: number
}

/**
 * "Cheap" variant: build the full graph, then filter. Used to PROVE
 * correctness (per-community score matches), independent of any IO speedup.
 */
export async function parseSubgraphFromFullGraph(
    fullGraph: ImportGraph,
    changedAbsolutePaths: readonly string[],
    hops: number,
    depth: number = 1,
): Promise<Subgraph> {
    const changedSet = new Set(changedAbsolutePaths.map(p => resolve(p)))
    const fullFileCommunities = new Map<string, string>()
    for (const f of fullGraph.files) {
        fullFileCommunities.set(f.absolutePath, communityAtDepth(f.packageName, f.relToSrc, depth))
    }

    const touched = new Set<string>()
    for (const f of fullGraph.files) {
        if (changedSet.has(f.absolutePath)) touched.add(fullFileCommunities.get(f.absolutePath)!)
    }

    // Include all files in touched communities (this is what the per-community SCORE consumes).
    const includedFiles = new Set<string>()
    for (const f of fullGraph.files) {
        if (touched.has(fullFileCommunities.get(f.absolutePath)!)) includedFiles.add(f.absolutePath)
    }

    // Plus N-hop importer/importee neighbors (by absolutePath only).
    let frontier = new Set(includedFiles)
    for (let h = 0; h < hops; h++) {
        const next = new Set<string>()
        for (const e of fullGraph.edges) {
            if (frontier.has(e.from.absolutePath) && !includedFiles.has(e.to.absolutePath)) next.add(e.to.absolutePath)
            if (frontier.has(e.to.absolutePath) && !includedFiles.has(e.from.absolutePath)) next.add(e.from.absolutePath)
        }
        for (const p of next) includedFiles.add(p)
        frontier = next
    }

    const filesByPath = new Map(fullGraph.files.map(f => [f.absolutePath, f]))
    const files = [...includedFiles].sort().map(p => filesByPath.get(p)!)
    const edges = fullGraph.edges.filter(e => includedFiles.has(e.from.absolutePath) && includedFiles.has(e.to.absolutePath))

    const communityMap = new Map<string, string>()
    for (const f of files) communityMap.set(f.absolutePath, fullFileCommunities.get(f.absolutePath)!)

    return {files, edges, communityMap, touchedCommunities: [...touched].sort(), depth}
}

/**
 * "Lean" variant: scan only touched-community files for IMPORTS; resolve targets
 * by path (which still requires a listing of all candidate files in the repo,
 * but does NOT require reading their contents). This is what a real production
 * implementation would do, and is the one whose timing we care about for the
 * subgraph-commit-gate decision.
 */
export async function parseSubgraphLean(
    changedRelativePaths: readonly string[],
    hops: number,
    depth: number = 1,
    repoRoot: string = DEFAULT_REPO_ROOT,
): Promise<Subgraph> {
    const packages = await discoverPackages(repoRoot)
    // We must enumerate all files in the repo to resolve cross-package imports by path.
    // This is O(directory listings), not O(file reads).
    const allFiles = await scanSourceFiles(packages, repoRoot)
    const filesByPath = new Map(allFiles.map(f => [f.absolutePath, f]))
    const knownPaths = new Set(filesByPath.keys())
    const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))

    const changedAbs = changedRelativePaths.map(p => resolve(repoRoot, p))
    const fileCommunities = new Map<string, string>()
    for (const f of allFiles) {
        fileCommunities.set(f.absolutePath, communityAtDepth(f.packageName, f.relToSrc, depth))
    }

    const touched = new Set<string>()
    for (const abs of changedAbs) {
        const c = fileCommunities.get(abs)
        if (c) touched.add(c)
    }
    if (touched.size === 0) {
        throw new Error(`[spike] none of changed files mapped to a community. Inputs: ${changedAbs.join(', ')}`)
    }

    // Files we will actually READ (= touched communities only).
    const filesToRead = new Set<string>()
    for (const f of allFiles) {
        if (touched.has(fileCommunities.get(f.absolutePath)!)) filesToRead.add(f.absolutePath)
    }

    // Build edges only from filesToRead (their outbound imports).
    const dedupedEdges = new Set<string>()
    for (const fromPath of filesToRead) {
        const file = filesByPath.get(fromPath)!
        const text = await readFile(file.absolutePath, 'utf8')
        for (const specifier of extractImportSpecifiers(file.absolutePath, text)) {
            let toPath: string | null = null
            if (specifier.startsWith('.')) {
                toPath = resolveFileCandidate(join(dirname(file.absolutePath), specifier), knownPaths)
            } else {
                for (const [npmName, pkg] of packagesByNpmName) {
                    if (specifier !== npmName && !specifier.startsWith(npmName + '/')) continue
                    const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
                    toPath = resolveFileCandidate(join(pkg.srcRoot, subPath), knownPaths)
                    break
                }
            }
            if (!toPath || toPath === file.absolutePath) continue
            dedupedEdges.add(`${file.absolutePath}\0${toPath}`)
        }
    }

    // Inbound edges (importers) for touched community files — we need these so that
    // a community's per-community priority-score (outEdges × fanOut from THIS community)
    // can be computed. Note: structural-orange's score is OUTGOING coupling, so for the
    // touched community we ONLY need outbound edges, which we already have.
    //
    // We still need at least one hop of importers if a downstream measure needs them.
    // For structural-orange the answer is NO — outEdges is sufficient. Skipping importer
    // discovery keeps the lean path honest.
    //
    // But to keep parity with the spec's "N-hop importees by path" wording, we add the
    // direct importees we found to the file list.
    const includedFiles = new Set<string>(filesToRead)
    for (const key of dedupedEdges) {
        const [, toPath] = key.split('\0')
        includedFiles.add(toPath)
    }
    // hops > 1 would expand further; for the spike, hops=1 is enough.
    void hops

    const files = [...includedFiles].sort().map(p => filesByPath.get(p)!)
    const edges = [...dedupedEdges].sort().map(key => {
        const [fromPath, toPath] = key.split('\0')
        return {from: filesByPath.get(fromPath)!, to: filesByPath.get(toPath)!}
    })

    const communityMap = new Map<string, string>()
    for (const f of files) communityMap.set(f.absolutePath, fileCommunities.get(f.absolutePath)!)

    return {files, edges, communityMap, touchedCommunities: [...touched].sort(), depth}
}

export {communityAtDepth, siblingGroupParent}
