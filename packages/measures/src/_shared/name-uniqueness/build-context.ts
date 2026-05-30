// One deep function that wires the I/O-bound construction of the
// NameUniquenessInput's shared fields — index, allowlist, importGraph —
// from the live repo. Scope is supplied by the caller separately because
// each runner edge (post-edit / pre-commit) computes scope from its own
// trigger surface (just-edited file vs staged diff).
//
// Caching: the name-index is the heavy step (~400ms cold over ~5k files).
// When `cacheKey` is supplied (typically `git rev-parse HEAD`) the
// pre-extracted declarations are persisted to `.voicetree/cache/
// name-index-<cacheKey>.json` and reused. Stale caches (different key
// in the filename) are lazily deleted on the next build of a new key.
//
// One public export — see find-violations.ts for the boundary-width
// rationale. The returned shape's nested type fields stay structural so
// callers don't need additional type imports.

import {readFile, readdir, mkdir, unlink, writeFile} from 'node:fs/promises'
import {extname, isAbsolute, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {discoverPackages, DEFAULT_REPO_ROOT} from '../discovery/discover-packages.ts'
import {buildImportGraph} from '../graph/import-graph.ts'
import {walkDirectories} from '../walk-directories.ts'
import {extractDeclarations} from './extract-declarations.ts'

const THIS_FILE_DIR = resolve(fileURLToPath(import.meta.url), '..')
const ALLOWLIST_PATH = resolve(THIS_FILE_DIR, '..', '..', '..', 'budgets', 'name-uniqueness-allowlist.json')

const SOURCE_EXTS: ReadonlySet<string> = new Set(['.ts', '.tsx'])
const IGNORED_DIR_NAMES: ReadonlySet<string> = new Set([
    'node_modules', 'dist', 'dist-electron', 'dist-test', 'out',
    'build', 'coverage', '.git', '__tests__', '__mocks__', '__generated__',
    'generated',
    // TODO: drop once migrate-worktrees-to-sibling.sh has run and .worktrees/ is empty.
    '.worktrees',
])

type DeclarationKind =
    | 'file' | 'export-function' | 'export-const' | 'export-class'
    | 'export-interface' | 'export-type' | 'export-enum' | 'export-named'

type DeclaredName = {
    readonly name: string
    readonly filePath: string
    readonly kind: DeclarationKind
}

type Context = {
    readonly index: {
        readonly declarations: readonly DeclaredName[]
        readonly byFilePath: ReadonlyMap<string, readonly DeclaredName[]>
    }
    readonly allowlist: {
        readonly metricVersion: number
        readonly universal: ReadonlySet<string>
        readonly projectConventions: ReadonlySet<string>
    }
    readonly importGraph: {
        readonly knownFiles: ReadonlySet<string>
        readonly canReach: (a: string, b: string, maxHops: number) => boolean
    }
}

export async function buildNameUniquenessContext(opts: {
    readonly repoRoot?: string
    readonly cacheKey?: string | null
} = {}): Promise<Context> {
    const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
    const cacheKey = opts.cacheKey ?? null
    const [declarations, allowlist, importGraph] = await Promise.all([
        loadOrBuildDeclarations(repoRoot, cacheKey),
        loadAllowlist(),
        buildReachability(repoRoot),
    ])
    return {
        index: {declarations, byFilePath: groupByFilePath(declarations)},
        allowlist,
        importGraph,
    }
}

async function loadAllowlist(): Promise<Context['allowlist']> {
    const raw = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8')) as {
        readonly metricVersion: number
        readonly universal: readonly string[]
        readonly projectConventions: readonly string[]
    }
    return {
        metricVersion: raw.metricVersion,
        universal: new Set(raw.universal.map(t => t.toLowerCase())),
        projectConventions: new Set(raw.projectConventions.map(t => t.toLowerCase())),
    }
}

function cacheDirFor(repoRoot: string): string {
    return join(repoRoot, '.voicetree', 'cache')
}

function cachePathFor(repoRoot: string, cacheKey: string): string {
    return join(cacheDirFor(repoRoot), `name-index-${cacheKey}.json`)
}

/**
 * The on-disk cache stores repo-relative paths so it is portable across
 * checkout roots. Declarations live in memory as ABSOLUTE paths (the
 * reachability graph keys on absolute paths), but the cache may be built
 * on one root (e.g. a dev's `/Users/...` tree) and consumed on another
 * (e.g. the mutagen-synced devbox `/root/vtrepo-synced/...`). If absolute
 * paths were persisted, the same file would carry two different identities
 * across roots — so `findNameUniquenessViolations` would see a file
 * "collide" with its own cached copy and block the commit. Relativising
 * the cache makes a file's identity root-independent.
 */
export function relativizeDeclarationPaths(
    repoRoot: string,
    declarations: readonly DeclaredName[],
): readonly DeclaredName[] {
    return declarations.map(d => ({...d, filePath: relative(repoRoot, d.filePath)}))
}

export function absolutizeDeclarationPaths(
    repoRoot: string,
    declarations: readonly DeclaredName[],
): readonly DeclaredName[] {
    return declarations.map(d => ({...d, filePath: resolve(repoRoot, d.filePath)}))
}

async function loadCachedDeclarations(cachePath: string, repoRoot: string): Promise<readonly DeclaredName[] | null> {
    try {
        const raw = JSON.parse(await readFile(cachePath, 'utf8')) as {
            readonly declarations: readonly DeclaredName[]
        }
        // Legacy/poisoned caches stored ABSOLUTE paths and are not portable
        // across roots — treat as a miss so they are rebuilt root-relative.
        if (raw.declarations.some(d => isAbsolute(d.filePath))) return null
        return absolutizeDeclarationPaths(repoRoot, raw.declarations)
    } catch {
        return null
    }
}

async function writeCacheAndGc(repoRoot: string, cacheKey: string, declarations: readonly DeclaredName[]): Promise<void> {
    const dir = cacheDirFor(repoRoot)
    await mkdir(dir, {recursive: true})
    const target = cachePathFor(repoRoot, cacheKey)
    const portable = relativizeDeclarationPaths(repoRoot, declarations)
    await writeFile(target, JSON.stringify({cacheKey, declarations: portable}), 'utf8')
    const stale = (await readdir(dir).catch(() => [] as string[]))
        .filter(name => name.startsWith('name-index-') && name.endsWith('.json') && name !== `name-index-${cacheKey}.json`)
    await Promise.all(stale.map(name => unlink(join(dir, name)).catch(() => undefined)))
}

async function loadOrBuildDeclarations(repoRoot: string, cacheKey: string | null): Promise<readonly DeclaredName[]> {
    if (cacheKey !== null) {
        const cached = await loadCachedDeclarations(cachePathFor(repoRoot, cacheKey), repoRoot)
        if (cached !== null) return cached
    }
    const declarations = await scanRepoDeclarations(repoRoot)
    if (cacheKey !== null) await writeCacheAndGc(repoRoot, cacheKey, declarations).catch(() => undefined)
    return declarations
}

async function scanRepoDeclarations(repoRoot: string): Promise<readonly DeclaredName[]> {
    const packages = await discoverPackages(repoRoot)
    const all: DeclaredName[] = []
    for (const pkg of packages) {
        const files = await listSourceFiles(pkg.srcRoot)
        const perFile = await Promise.all(files.map(async filePath => {
            const content = await readFile(filePath, 'utf8').catch(() => '')
            return extractDeclarations(filePath, content)
        }))
        for (const decls of perFile) for (const d of decls) all.push(d)
    }
    return all
}

async function listSourceFiles(srcRoot: string): Promise<readonly string[]> {
    const walked = await walkDirectories(srcRoot, {
        includeEntry: entry => !(entry.kind === 'directory' && IGNORED_DIR_NAMES.has(entry.name)),
    })
    const files: string[] = []
    for (const dir of walked) {
        for (const entry of dir.entries) {
            if (entry.kind !== 'file') continue
            if (!SOURCE_EXTS.has(extname(entry.name))) continue
            if (entry.name.endsWith('.d.ts')) continue
            files.push(entry.absolutePath)
        }
    }
    return files
}

function groupByFilePath(declarations: readonly DeclaredName[]): ReadonlyMap<string, readonly DeclaredName[]> {
    const out = new Map<string, DeclaredName[]>()
    for (const d of declarations) {
        const list = out.get(d.filePath) ?? []
        list.push(d)
        out.set(d.filePath, list)
    }
    return out
}

async function buildReachability(repoRoot: string): Promise<Context['importGraph']> {
    const packages = await discoverPackages(repoRoot)
    const graph = await buildImportGraph(packages, repoRoot)
    const known = new Set<string>(graph.files.map(f => f.absolutePath))
    const adjacency = new Map<string, Set<string>>()
    for (const f of known) adjacency.set(f, new Set<string>())
    for (const edge of graph.edges) {
        adjacency.get(edge.from.absolutePath)!.add(edge.to.absolutePath)
        adjacency.get(edge.to.absolutePath)!.add(edge.from.absolutePath)
    }
    const canReach = (a: string, b: string, maxHops: number): boolean => {
        if (a === b) return true
        if (!known.has(a) || !known.has(b)) return false
        let frontier: Set<string> = new Set([a])
        const visited = new Set<string>([a])
        for (let hop = 0; hop < maxHops; hop++) {
            const next = new Set<string>()
            for (const node of frontier) {
                for (const neighbour of adjacency.get(node) ?? []) {
                    if (visited.has(neighbour)) continue
                    if (neighbour === b) return true
                    visited.add(neighbour)
                    next.add(neighbour)
                }
            }
            if (next.size === 0) return false
            frontier = next
        }
        return false
    }
    return {knownFiles: known, canReach}
}
