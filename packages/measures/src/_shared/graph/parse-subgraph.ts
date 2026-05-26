/**
 * Lean subgraph extractor for the subgraph-scoped health-checks gate.
 *
 * Given a set of changed files, returns an {@link ParsedSubgraph} that
 * contains every file in the touched community(ies) plus N hops of import
 * neighbors. The spike proved that the per-community structural-orange
 * score derived from this subgraph matches the full-graph score exactly
 * for any touched community — see `packages/measures/scratch/run-spike.ts`.
 *
 * Cost model:
 *   - Enumerate all source files in the repo (directory listings only —
 *     readDirectories, no file content read).
 *   - readFile() only for files in touched communities — these are the
 *     ones whose outbound imports must be resolved to construct the
 *     community's `outEdges` / `fanOut`.
 *   - Optionally scan all repo files to find inbound importers; OFF by
 *     default because structural-orange does not need them (its score is
 *     measured strictly on outgoing intra-parent edges). Turn it on for
 *     any measure that consumes fanIn or symmetric coupling.
 *
 * Optional ts-morph `Project`:
 *   - Lazy. Built on demand by {@link ParsedSubgraph.getProject}. The
 *     project loads only the files in the returned subgraph (not the
 *     whole repo), so even ts-morph-requiring measures stay subgraph-bounded.
 *   - Repeated calls return the same project (cached per ParsedSubgraph
 *     instance).
 *
 * Pure of side effects beyond filesystem reads (which are themselves
 * constrained to the subgraph). Safe to invoke from anywhere.
 */
import {readFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {Project} from 'ts-morph'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../discovery/discover-packages.ts'
import {communityAtDepth} from '../community/community-at-depth.ts'
import {
    extractImportSpecifiers,
    resolveFileCandidate,
    scanSourceFiles,
    type Edge,
    type SourceFile,
} from './import-graph.ts'

/**
 * Configuration for {@link parseSubgraph}. All fields are optional —
 * defaults are tuned for the structural-orange gate.
 */
type ParseSubgraphOptions = {
    /**
     * How many import-graph hops to expand beyond the touched community.
     * `hops=1` includes direct importees of touched-community files
     * (and importers too, if {@link includeInbound} is set).
     *
     * Default: 1.
     *
     * Hops > 1 progressively dilute the gate's locality guarantee
     * (more files to read, slower scan) — only raise it if a specific
     * measure documents a need.
     */
    readonly hops?: number
    /**
     * If true, also enumerate inbound importers of touched-community
     * files. This requires scanning every file in the repo for imports
     * (not just touched-community files), so it eliminates most of the
     * lean-path speedup.
     *
     * Default: false.
     *
     * Trap: the spike found structural-orange does not need inbound
     * edges because its priority score is `outEdges × max(1, fanOut)`,
     * measured from the touched community outward. But measures that
     * consume `fanIn`, symmetric coupling, or modularity Q computed
     * over the touched community's full neighborhood DO need inbound.
     * Turn on explicitly per measure.
     */
    readonly includeInbound?: boolean
    /**
     * Community-assignment depth. Default 1 (first-level subdirectory
     * under each package src/), matching the canonical orange-gate
     * reporting depth.
     */
    readonly depth?: number
    /**
     * Repository root. Defaults to {@link DEFAULT_REPO_ROOT} (resolved
     * from this file's location). Overridable for tests.
     */
    readonly repoRoot?: string
    /**
     * Custom file-content loader. Default reads from disk via `fs.readFile`.
     *
     * The runner overrides this so the gate scores **the state that the
     * pending commit would produce**, not whatever happens to be in the
     * worktree. For staged paths it returns the staged blob (`git show :path`);
     * for unstaged paths it falls back to disk content. This prevents
     * peer-agent WIP from contaminating the score of the current commit.
     *
     * Whatever this function returns is what every downstream consumer
     * (import-edge extraction AND the ts-morph `Project` built by
     * `getProject()`) sees — they share a single content cache so the AST
     * and the edge graph cannot disagree about file contents.
     */
    readonly loadContent?: (absolutePath: string) => Promise<string>
}

/**
 * The subgraph slice returned by {@link parseSubgraph}.
 *
 * `files` includes every file in any touched community PLUS the N-hop
 * neighborhood. `communityMap` maps every file in `files` to its
 * community id at the configured depth. `edges` is the subgraph-internal
 * import edge list (both endpoints are in `files`).
 *
 * `touchedCommunities` is the set the gate cares about — these are the
 * communities whose per-community score is recomputed and compared to
 * baseline. Files reached via hops belong to other communities and are
 * included only so their edges back to the touched set can be counted.
 *
 * `getProject()` lazily constructs a ts-morph `Project` over `files` —
 * only call it from measures that genuinely need full-AST analysis;
 * the typescript createSourceFile path (used internally for import
 * extraction) is an order of magnitude cheaper.
 */
export type ParsedSubgraph = {
    readonly files: readonly SourceFile[]
    readonly communityMap: ReadonlyMap<string, string>
    readonly edges: readonly Edge[]
    readonly touchedCommunities: readonly string[]
    readonly depth: number
    /**
     * Lazily build (and cache) a ts-morph Project loaded with exactly
     * the files in this subgraph. Use only for measures that need
     * full AST analysis (semantic coupling, transitive purity, etc.).
     */
    getProject(): Project
    /**
     * The text content the parser used for `absPath`, or `null` if the
     * file isn't in this subgraph. Measures that need to read file text
     * directly (e.g. boundary-width's lightweight export scan) MUST go
     * through this so they share the same view of "what does this file
     * contain" as the runner's staged-blob loader — otherwise they'd
     * silently regress to working-tree content and the worktree-vs-index
     * isolation breaks.
     */
    getContent(absPath: string): string | null
}

/**
 * Result type used internally during construction; we expose
 * {@link ParsedSubgraph} as readonly.
 */
type MutableSubgraph = {
    files: SourceFile[]
    communityMap: Map<string, string>
    edges: Edge[]
    touchedCommunities: string[]
    depth: number
    /**
     * Cached file contents (absPath → text) keyed for every file in
     * `files`. `freezeSubgraph` consumes this so the ts-morph Project is
     * built from the SAME content that produced the edge graph — staged
     * blob if the runner overrode `loadContent`, disk content otherwise.
     */
    contentCache: ReadonlyMap<string, string>
}

/**
 * Extract a subgraph rooted at `changedFiles`.
 *
 * @param changedFiles Absolute or repo-relative paths. Files outside any
 *                     discovered package (e.g. scripts/, brain/) are
 *                     silently ignored — the result is empty if none of
 *                     the inputs belongs to a community.
 * @param opts         See {@link ParseSubgraphOptions}.
 */
export async function parseSubgraph(
    changedFiles: readonly string[],
    opts: ParseSubgraphOptions = {},
): Promise<ParsedSubgraph> {
    const hops = opts.hops ?? 1
    const includeInbound = opts.includeInbound ?? false
    const depth = opts.depth ?? 1
    const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
    const loadContent = opts.loadContent ?? defaultDiskLoader

    const packages = await discoverPackages(repoRoot)
    const allFiles = await scanSourceFiles(packages, repoRoot)
    const filesByPath = new Map<string, SourceFile>(allFiles.map(f => [f.absolutePath, f]))
    const knownPaths: ReadonlySet<string> = new Set(filesByPath.keys())
    const packagesByNpmName = new Map<string, PackageInfo>(packages.map(pkg => [pkg.name, pkg]))

    // Single content cache shared by every read in this parseSubgraph call.
    // Edge extraction and ts-morph both consume from it, so the AST cannot
    // disagree with the edge graph about a file's contents.
    const contentCache = new Map<string, string>()
    const readCached = async (absPath: string): Promise<string> => {
        const hit = contentCache.get(absPath)
        if (hit !== undefined) return hit
        const text = await loadContent(absPath)
        contentCache.set(absPath, text)
        return text
    }

    const changedAbs: string[] = changedFiles.map(p => resolve(repoRoot, p))

    const fileCommunities = new Map<string, string>()
    for (const f of allFiles) {
        fileCommunities.set(f.absolutePath, communityAtDepth(f.packageName, f.relToSrc, depth))
    }

    const touched = new Set<string>()
    for (const abs of changedAbs) {
        const c = fileCommunities.get(abs)
        if (c) touched.add(c)
    }
    if (touched.size === 0) return emptySubgraph(depth)

    const filesToRead = new Set<string>()
    for (const f of allFiles) {
        if (touched.has(fileCommunities.get(f.absolutePath)!)) filesToRead.add(f.absolutePath)
    }

    const outboundEdges = await readOutboundEdges(filesToRead, filesByPath, knownPaths, packagesByNpmName, readCached)
    const inboundEdges = includeInbound
        ? await readInboundEdges(filesToRead, allFiles, filesByPath, knownPaths, packagesByNpmName, readCached)
        : []

    const allEdgeKeys = new Set<string>()
    for (const e of outboundEdges) allEdgeKeys.add(`${e.from}\0${e.to}`)
    for (const e of inboundEdges) allEdgeKeys.add(`${e.from}\0${e.to}`)

    const includedFiles = new Set<string>(filesToRead)
    for (const key of allEdgeKeys) {
        const [from, to] = key.split('\0')
        includedFiles.add(from)
        includedFiles.add(to)
    }

    // Expand by additional hops (1 hop is already covered by the inbound/outbound passes above).
    let frontier = new Set(includedFiles)
    for (let h = 1; h < hops; h++) {
        const nextFrontier = new Set<string>()
        for (const fromPath of frontier) {
            const file = filesByPath.get(fromPath)
            if (!file) continue
            if (filesToRead.has(fromPath)) continue // already processed
            const text = await readCached(file.absolutePath)
            for (const specifier of extractImportSpecifiers(file.absolutePath, text)) {
                const toPath = resolveSpecifier(file, specifier, knownPaths, packagesByNpmName)
                if (!toPath || toPath === file.absolutePath) continue
                allEdgeKeys.add(`${file.absolutePath}\0${toPath}`)
                if (!includedFiles.has(toPath)) {
                    includedFiles.add(toPath)
                    nextFrontier.add(toPath)
                }
            }
        }
        frontier = nextFrontier
        if (frontier.size === 0) break
    }

    const subgraphFiles = [...includedFiles].sort().map(p => filesByPath.get(p)!).filter(Boolean)
    const subgraphEdges: Edge[] = [...allEdgeKeys].sort().map(key => {
        const [fromPath, toPath] = key.split('\0')
        const from = filesByPath.get(fromPath)
        const to = filesByPath.get(toPath)
        if (!from || !to) return null
        return {from, to}
    }).filter((e): e is Edge => e !== null)

    const subgraphCommunityMap = new Map<string, string>()
    for (const f of subgraphFiles) subgraphCommunityMap.set(f.absolutePath, fileCommunities.get(f.absolutePath)!)

    // Pre-load any subgraph file we haven't read yet. ts-morph's getProject()
    // will be built from this cache; without the pre-load it would otherwise
    // call addSourceFileAtPath and silently read from disk, defeating the
    // staged-blob override.
    for (const f of subgraphFiles) {
        if (!contentCache.has(f.absolutePath)) await readCached(f.absolutePath)
    }

    const mutable: MutableSubgraph = {
        files: subgraphFiles,
        communityMap: subgraphCommunityMap,
        edges: subgraphEdges,
        touchedCommunities: [...touched].sort(),
        depth,
        contentCache,
    }
    return freezeSubgraph(mutable)
}

function defaultDiskLoader(absolutePath: string): Promise<string> {
    return readFile(absolutePath, 'utf8')
}

function emptySubgraph(depth: number): ParsedSubgraph {
    return freezeSubgraph({
        files: [],
        communityMap: new Map(),
        edges: [],
        touchedCommunities: [],
        depth,
        contentCache: new Map(),
    })
}

/**
 * Build (and cache, per ParsedSubgraph instance) a ts-morph Project
 * loaded with exactly the files in this subgraph.
 *
 * Files are added via `createSourceFile(absPath, text)` from `contentCache`
 * so the AST matches whatever the parser was told to use — in particular,
 * the runner's staged-blob override flows through to AST analysis.
 *
 * Fallback to disk for any file missing from the cache (e.g. a custom test
 * helper that bypassed parseSubgraph's pre-load) so getProject never
 * silently drops a file from the AST.
 */
function freezeSubgraph(mutable: MutableSubgraph): ParsedSubgraph {
    let cachedProject: Project | null = null
    const getProject = (): Project => {
        if (cachedProject) return cachedProject
        const project = new Project({useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true})
        for (const f of mutable.files) {
            const text = mutable.contentCache.get(f.absolutePath)
            if (text !== undefined) project.createSourceFile(f.absolutePath, text, {overwrite: true})
            else project.addSourceFileAtPath(f.absolutePath)
        }
        cachedProject = project
        return project
    }
    const getContent = (absPath: string): string | null => mutable.contentCache.get(absPath) ?? null
    return {
        files: mutable.files,
        communityMap: mutable.communityMap,
        edges: mutable.edges,
        touchedCommunities: mutable.touchedCommunities,
        depth: mutable.depth,
        getProject,
        getContent,
    }
}

type RawEdge = { readonly from: string; readonly to: string }

async function readOutboundEdges(
    filesToRead: ReadonlySet<string>,
    filesByPath: ReadonlyMap<string, SourceFile>,
    knownPaths: ReadonlySet<string>,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
    readCached: (absPath: string) => Promise<string>,
): Promise<RawEdge[]> {
    const edges: RawEdge[] = []
    for (const fromPath of filesToRead) {
        const file = filesByPath.get(fromPath)
        if (!file) continue
        const text = await readCached(file.absolutePath)
        for (const specifier of extractImportSpecifiers(file.absolutePath, text)) {
            const toPath = resolveSpecifier(file, specifier, knownPaths, packagesByNpmName)
            if (!toPath || toPath === file.absolutePath) continue
            edges.push({from: file.absolutePath, to: toPath})
        }
    }
    return edges
}

async function readInboundEdges(
    touchedSet: ReadonlySet<string>,
    allFiles: readonly SourceFile[],
    filesByPath: ReadonlyMap<string, SourceFile>,
    knownPaths: ReadonlySet<string>,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
    readCached: (absPath: string) => Promise<string>,
): Promise<RawEdge[]> {
    // Inbound discovery requires reading every potentially-importing file.
    // This is the path that erodes the lean-path speedup; only enabled when
    // a measure explicitly opts in via `includeInbound`.
    const edges: RawEdge[] = []
    for (const file of allFiles) {
        if (touchedSet.has(file.absolutePath)) continue
        const text = await readCached(file.absolutePath)
        for (const specifier of extractImportSpecifiers(file.absolutePath, text)) {
            const toPath = resolveSpecifier(file, specifier, knownPaths, packagesByNpmName)
            if (!toPath || toPath === file.absolutePath) continue
            if (touchedSet.has(toPath)) edges.push({from: file.absolutePath, to: toPath})
        }
    }
    return edges
}

function resolveSpecifier(
    file: SourceFile,
    specifier: string,
    knownPaths: ReadonlySet<string>,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
): string | null {
    if (specifier.startsWith('.')) {
        return resolveFileCandidate(join(dirname(file.absolutePath), specifier), knownPaths)
    }
    for (const [npmName, pkg] of packagesByNpmName) {
        if (specifier !== npmName && !specifier.startsWith(npmName + '/')) continue
        const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
        return resolveFileCandidate(join(pkg.srcRoot, subPath), knownPaths)
    }
    return null
}
