/**
 * SPIKE diagnostic — NOT production code.
 *
 * Walks every discovered package's src/, extracts declared names, and runs
 * four variants of a name-uniqueness clustering metric. Self-contained on
 * purpose: shipping the policy as a module would add a dozen exports to
 * the `measures/_shared` community and trip the existing boundary-width
 * gate. When this graduates from spike to tier-0 measure, the production
 * module will be designed as a deep function (per CLAUDE.md).
 *
 * Variants:
 *   baseline      — name tokens only, MIN_TOKEN_LENGTH = 3, no acronyms.
 *   v1-acronym    — keep all-caps acronyms (DB, UI, IO, CI) as significant.
 *                   Also handles multi-line re-exports correctly.
 *   v2-pathtokens — name tokens ∪ enclosing-dir path tokens.
 *   v3-graphdist  — exempt a cluster iff its members are reachable within K
 *                   hops in the production import graph.
 *   intersect     — declarations flagged by v1 AND v2 AND v3 simultaneously.
 *
 * Usage (from repo root):
 *   node --import tsx packages/measures/scratch/name-uniqueness-report.ts             # all variants, summary
 *   node --import tsx packages/measures/scratch/name-uniqueness-report.ts baseline    # just one
 *   node --import tsx packages/measures/scratch/name-uniqueness-report.ts intersect
 */
import {readFile} from 'node:fs/promises'
import {basename, dirname, extname, relative, sep} from 'node:path'

import {DEFAULT_REPO_ROOT, discoverPackages} from '../src/_shared/discovery/discover-packages.ts'
import {buildImportGraph} from '../src/_shared/graph/import-graph.ts'
import {walkDirectories} from '../src/_shared/walk-directories.ts'

// =============================================================================
// Inlined policy: tokenisation + significance + clustering
// =============================================================================

type DeclaredNameKind =
    | 'file'
    | 'export-function'
    | 'export-const'
    | 'export-class'
    | 'export-interface'
    | 'export-type'
    | 'export-enum'
    | 'export-named'

type DeclaredName = {
    readonly name: string
    readonly origin: string
    readonly kind: DeclaredNameKind
}

type NameCluster = {
    readonly tokenSetKey: string
    readonly significantTokens: readonly string[]
    readonly members: readonly DeclaredName[]
}

type SignificanceConfig = {
    readonly keepShortAcronyms?: boolean
}

type ClusterConfig = {
    readonly significance?: SignificanceConfig
    readonly extraTokensFor?: (decl: DeclaredName) => readonly string[]
}

const STOPWORDS: ReadonlySet<string> = new Set([
    'index', 'util', 'utils', 'helper', 'helpers', 'type', 'types',
    'lib', 'core', 'shared', 'common', 'data', 'value', 'values',
    'result', 'results', 'temp', 'new', 'old', 'file', 'files',
    'manager', 'handler', 'handlers', 'service', 'services',
    'controller', 'config', 'configs', 'options', 'option',
    'item', 'items', 'entry', 'entries', 'props', 'state',
    'context', 'instance', 'object', 'fn', 'func', 'function',
    'main', 'default', 'base', 'impl', 'mod', 'module', 'modules',
])

const SUFFIX_TOKENS: ReadonlySet<string> = new Set([
    'test', 'tests', 'spec', 'specs', 'stories', 'story',
    'fixtures', 'fixture', 'mock', 'mocks', 'd',
])

const MIN_TOKEN_LENGTH = 3

function splitNameTokens(rawName: string): readonly string[] {
    const camelSplit = rawName.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    return camelSplit.split(/[\s\-_./]+/).filter(token => token.length > 0)
}

function stripBasenameSuffixTokens(tokens: readonly string[]): readonly string[] {
    let end = tokens.length
    while (end > 0 && SUFFIX_TOKENS.has(tokens[end - 1].toLowerCase())) end--
    return tokens.slice(0, end)
}

function isAcronymToken(token: string): boolean {
    return token.length >= 2 && /^[A-Z]+$/.test(token)
}

function significantTokens(tokens: readonly string[], config: SignificanceConfig = {}): readonly string[] {
    const keepShortAcronyms = config.keepShortAcronyms ?? false
    return tokens
        .filter(token => {
            if (keepShortAcronyms && isAcronymToken(token)) return true
            if (token.length < MIN_TOKEN_LENGTH) return false
            const lower = token.toLowerCase()
            if (STOPWORDS.has(lower)) return false
            if (/^\d+$/.test(token)) return false
            return true
        })
        .map(token => token.toLowerCase())
}

function tokenSetKey(tokens: readonly string[]): string {
    return [...new Set(tokens)].sort().join('|')
}

function declarationSignificantTokens(decl: DeclaredName, config: ClusterConfig): readonly string[] {
    const rawTokens = splitNameTokens(decl.name)
    const stripped = decl.kind === 'file' ? stripBasenameSuffixTokens(rawTokens) : rawTokens
    const nameSig = significantTokens(stripped, config.significance)
    const extra = config.extraTokensFor ? config.extraTokensFor(decl) : []
    return [...new Set([...nameSig, ...extra])]
}

function clusterByTokenSet(declarations: readonly DeclaredName[], config: ClusterConfig = {}): readonly NameCluster[] {
    const buckets = new Map<string, {tokens: readonly string[]; members: DeclaredName[]}>()
    for (const decl of declarations) {
        const sig = declarationSignificantTokens(decl, config)
        if (sig.length === 0) continue
        const key = tokenSetKey(sig)
        const existing = buckets.get(key)
        if (existing) existing.members.push(decl)
        else buckets.set(key, {tokens: sig.slice().sort(), members: [decl]})
    }
    return [...buckets.entries()]
        .map(([key, bucket]) => ({tokenSetKey: key, significantTokens: bucket.tokens, members: bucket.members}))
        .filter(cluster => cluster.members.length > 1)
        .sort((a, b) =>
            b.members.length - a.members.length
            || a.significantTokens.length - b.significantTokens.length
            || a.tokenSetKey.localeCompare(b.tokenSetKey),
        )
}

function emptyTokenViolations(declarations: readonly DeclaredName[], config: ClusterConfig = {}): readonly DeclaredName[] {
    return declarations.filter(decl => declarationSignificantTokens(decl, config).length === 0)
}

// =============================================================================
// Inlined extractor: regex over TS source files
// =============================================================================

const EXPORT_PATTERNS: readonly {regex: RegExp; kind: DeclaredNameKind}[] = [
    {regex: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-function'},
    {regex: /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-class'},
    {regex: /^\s*export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-interface'},
    {regex: /^\s*export\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=<]/gm, kind: 'export-type'},
    {regex: /^\s*export\s+enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-enum'},
    {regex: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-const'},
    {regex: /^\s*export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-function'},
    {regex: /^\s*export\s+default\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-class'},
]

const NAMED_EXPORT_LIST_REGEX = /^\s*export\s*\{([^}]+)\}\s*(?:from\s*['"][^'"]+['"])?/gm

function fileBasenameDeclaration(filePath: string): DeclaredName {
    const base = basename(filePath).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
    return {name: base, origin: filePath, kind: 'file'}
}

function extractExports(filePath: string, content: string): readonly DeclaredName[] {
    const declared: DeclaredName[] = []
    for (const pattern of EXPORT_PATTERNS) {
        const re = new RegExp(pattern.regex.source, pattern.regex.flags)
        let match: RegExpExecArray | null
        while ((match = re.exec(content)) !== null) {
            declared.push({name: match[1], origin: filePath, kind: pattern.kind})
        }
    }
    const re = new RegExp(NAMED_EXPORT_LIST_REGEX.source, NAMED_EXPORT_LIST_REGEX.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(content)) !== null) {
        const closeIdx = match[0].lastIndexOf('}')
        if (closeIdx !== -1 && /from\s*['"]/.test(match[0].slice(closeIdx + 1))) continue
        for (const rawSpec of match[1].split(/[,\n]/)) {
            const spec = rawSpec.trim()
            if (spec.length === 0) continue
            const asMatch = /^(?:type\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(spec)
            if (asMatch) {
                declared.push({name: asMatch[1], origin: filePath, kind: 'export-named'})
                continue
            }
            const plainMatch = /^(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(spec)
            if (plainMatch) {
                declared.push({name: plainMatch[1], origin: filePath, kind: 'export-named'})
            }
        }
    }
    return declared
}

function extractAllDeclarations(filePath: string, content: string): readonly DeclaredName[] {
    const all = [fileBasenameDeclaration(filePath), ...extractExports(filePath, content)]
    const seen = new Set<string>()
    const result: DeclaredName[] = []
    for (const decl of all) {
        const key = `${decl.name}\0${decl.origin}\0${decl.kind}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push(decl)
    }
    return result
}

// =============================================================================
// Runner: walk packages, gather declarations, run each variant
// =============================================================================

const SOURCE_EXTS: ReadonlySet<string> = new Set(['.ts', '.tsx'])
const IGNORED_DIR_NAMES: ReadonlySet<string> = new Set([
    'node_modules', 'dist', 'dist-electron', 'dist-test', 'out',
    'build', 'coverage', '.git', '__tests__', '__mocks__', '__generated__',
    'generated',
])

const TOP_CLUSTERS_TO_PRINT = 15
const GRAPH_DISTANCE_K = 3

type VariantName = 'baseline' | 'v1-acronym' | 'v2-pathtokens' | 'v3-graphdist'

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

async function gatherAllDeclarations(): Promise<readonly DeclaredName[]> {
    const packages = await discoverPackages()
    const declarations: DeclaredName[] = []
    for (const pkg of packages) {
        const files = await listSourceFiles(pkg.srcRoot)
        await Promise.all(files.map(async filePath => {
            const content = await readFile(filePath, 'utf8').catch(() => '')
            for (const decl of extractAllDeclarations(filePath, content)) declarations.push(decl)
        }))
    }
    return declarations
}

function pathTokensForOrigin(origin: string): readonly string[] {
    const rel = relative(DEFAULT_REPO_ROOT, dirname(origin))
    const segments = rel.split(sep).flatMap(segment => splitNameTokens(segment))
    return significantTokens(segments, {keepShortAcronyms: true})
}

function configForVariant(variant: VariantName): ClusterConfig {
    switch (variant) {
        case 'baseline':
            return {}
        case 'v1-acronym':
            return {significance: {keepShortAcronyms: true}}
        case 'v2-pathtokens':
            return {
                significance: {keepShortAcronyms: true},
                extraTokensFor: decl => pathTokensForOrigin(decl.origin),
            }
        case 'v3-graphdist':
            return {significance: {keepShortAcronyms: true}}
    }
}

// --- Graph-distance post-filter ---------------------------------------------

type Reachability = {
    readonly knownFiles: ReadonlySet<string>
    readonly canReach: (a: string, b: string, maxHops: number) => boolean
}

async function buildReachability(): Promise<Reachability> {
    const packages = await discoverPackages()
    const graph = await buildImportGraph(packages)
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

function isClusterConnected(cluster: NameCluster, reachability: Reachability, maxHops: number): boolean {
    const origins = [...new Set(cluster.members.map(m => m.origin))]
    if (origins.length <= 1) return true
    const inGraph = origins.filter(o => reachability.knownFiles.has(o))
    if (inGraph.length < origins.length) return false
    for (let i = 0; i < inGraph.length; i++) {
        for (let j = i + 1; j < inGraph.length; j++) {
            if (!reachability.canReach(inGraph[i], inGraph[j], maxHops)) return false
        }
    }
    return true
}

// --- Reporting --------------------------------------------------------------

function formatRelative(absPath: string): string {
    return relative(DEFAULT_REPO_ROOT, absPath)
}

function formatCluster(cluster: NameCluster, index: number): string {
    const head = `#${index + 1}  size=${cluster.members.length}  tokens=[${cluster.significantTokens.join(', ')}]`
    const sample = cluster.members.slice(0, 6).map(member => {
        const tag = member.kind === 'file' ? 'file' : member.kind.replace('export-', 'ex.')
        return `    [${tag.padEnd(11)}] ${member.name.padEnd(28)} ${formatRelative(member.origin)}`
    }).join('\n')
    const more = cluster.members.length > 6 ? `\n    ... +${cluster.members.length - 6} more` : ''
    return `${head}\n${sample}${more}`
}

function clusterSizeHistogram(clusters: readonly NameCluster[]): string {
    const histogram = new Map<number, number>()
    for (const c of clusters) histogram.set(c.members.length, (histogram.get(c.members.length) ?? 0) + 1)
    return [...histogram.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([size, count]) => `  size ${String(size).padStart(3)}: ${count}`)
        .join('\n')
}

async function runVariant(
    variant: VariantName,
    declarations: readonly DeclaredName[],
    reachability: Reachability | null,
): Promise<{clusters: readonly NameCluster[]; emptiesCount: number}> {
    const config = configForVariant(variant)
    let clusters = clusterByTokenSet(declarations, config)
    if (variant === 'v3-graphdist') {
        if (!reachability) throw new Error('v3 needs reachability')
        clusters = clusters.filter(cluster => !isClusterConnected(cluster, reachability, GRAPH_DISTANCE_K))
    }
    const empties = emptyTokenViolations(declarations, config)
    console.log(`\n================= VARIANT: ${variant} =================`)
    console.log(`Clusters of size > 1: ${clusters.length}`)
    console.log(`Empty-token declarations: ${empties.length}`)
    console.log('\nCluster-size histogram:')
    console.log(clusterSizeHistogram(clusters))
    console.log(`\nTop ${TOP_CLUSTERS_TO_PRINT} clusters:`)
    for (const [idx, cluster] of clusters.slice(0, TOP_CLUSTERS_TO_PRINT).entries()) {
        console.log('')
        console.log(formatCluster(cluster, idx))
    }
    return {clusters, emptiesCount: empties.length}
}

function clustersByMember(clusters: readonly NameCluster[]): Map<string, NameCluster> {
    const byMember = new Map<string, NameCluster>()
    for (const cluster of clusters) {
        for (const member of cluster.members) {
            const key = `${member.name}\0${member.origin}\0${member.kind}`
            byMember.set(key, cluster)
        }
    }
    return byMember
}

async function runIntersect(declarations: readonly DeclaredName[], reachability: Reachability): Promise<void> {
    const v1 = clusterByTokenSet(declarations, configForVariant('v1-acronym'))
    const v2 = clusterByTokenSet(declarations, configForVariant('v2-pathtokens'))
    const v3 = clusterByTokenSet(declarations, configForVariant('v3-graphdist'))
        .filter(cluster => !isClusterConnected(cluster, reachability, GRAPH_DISTANCE_K))

    const inV1 = clustersByMember(v1)
    const inV2 = clustersByMember(v2)
    const inV3 = clustersByMember(v3)

    type IntersectRow = {
        decl: DeclaredName
        v1Size: number
        v2Size: number
        v3Size: number
        v1Tokens: readonly string[]
    }
    const rows: IntersectRow[] = []
    for (const decl of declarations) {
        const key = `${decl.name}\0${decl.origin}\0${decl.kind}`
        const c1 = inV1.get(key)
        const c2 = inV2.get(key)
        const c3 = inV3.get(key)
        if (!c1 || !c2 || !c3) continue
        rows.push({
            decl,
            v1Size: c1.members.length,
            v2Size: c2.members.length,
            v3Size: c3.members.length,
            v1Tokens: c1.significantTokens,
        })
    }

    const grouped = new Map<string, IntersectRow[]>()
    for (const row of rows) {
        const key = row.v1Tokens.join('|')
        const list = grouped.get(key) ?? []
        list.push(row)
        grouped.set(key, list)
    }
    const groupRows = [...grouped.entries()]
        .map(([, list]) => ({
            tokens: list[0].v1Tokens,
            count: list.length,
            members: list,
            maxV1Size: Math.max(...list.map(r => r.v1Size)),
        }))
        .sort((a, b) =>
            b.count - a.count
            || b.maxV1Size - a.maxV1Size
            || a.tokens.join('|').localeCompare(b.tokens.join('|')),
        )

    console.log(`\n================= TRIPLE-CONFIRMED AMBIGUOUS DECLARATIONS =================`)
    console.log(`(In a cluster of size > 1 in ALL of v1, v2 (path-tokens), v3 (graph-distance))`)
    console.log(`Total declarations triple-flagged: ${rows.length} across ${groupRows.length} v1-clusters\n`)

    for (const [idx, group] of groupRows.slice(0, 20).entries()) {
        console.log(`#${idx + 1}  v1-tokens=[${group.tokens.join(', ')}]  triple-flagged-members=${group.count}`)
        for (const row of group.members.slice(0, 8)) {
            const tag = row.decl.kind === 'file' ? 'file' : row.decl.kind.replace('export-', 'ex.')
            console.log(`    [${tag.padEnd(11)}] ${row.decl.name.padEnd(30)} ${formatRelative(row.decl.origin)}`)
            console.log(`        v1-cluster size=${row.v1Size}   v2 size=${row.v2Size}   v3 size=${row.v3Size}`)
        }
        if (group.members.length > 8) console.log(`    ... +${group.members.length - 8} more`)
        console.log('')
    }
}

async function main(): Promise<void> {
    const variantArg = (process.argv[2] ?? 'all').toLowerCase()
    const declarations = await gatherAllDeclarations()
    console.log(`Scanned ${declarations.length} declarations.`)

    const needGraph = variantArg === 'all' || variantArg === 'v3-graphdist' || variantArg === 'intersect'
    const reachability = needGraph ? await buildReachability() : null

    if (variantArg === 'intersect') {
        if (!reachability) throw new Error('intersect needs reachability')
        await runIntersect(declarations, reachability)
        return
    }

    const variants: readonly VariantName[] = variantArg === 'all'
        ? ['baseline', 'v1-acronym', 'v2-pathtokens', 'v3-graphdist']
        : [variantArg as VariantName]

    const summary: {variant: VariantName; clusterCount: number; emptiesCount: number; totalSize5Plus: number}[] = []
    for (const variant of variants) {
        const {clusters, emptiesCount} = await runVariant(variant, declarations, reachability)
        const size5Plus = clusters.filter(c => c.members.length >= 5).length
        summary.push({variant, clusterCount: clusters.length, emptiesCount, totalSize5Plus: size5Plus})
    }

    if (summary.length > 1) {
        console.log('\n================= SUMMARY ACROSS VARIANTS =================')
        console.log('variant            clusters>1   size>=5    empty-token')
        for (const row of summary) {
            console.log(`  ${row.variant.padEnd(16)}  ${String(row.clusterCount).padStart(6)}     ${String(row.totalSize5Plus).padStart(4)}        ${String(row.emptiesCount).padStart(4)}`)
        }
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
