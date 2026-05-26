// Name-uniqueness deep function — the pure policy core for the tier-0
// name-uniqueness measure (post-edit hook + pre-commit runner). All
// internal helpers (tokenisation, significance, clustering, allowlist
// check, graph-distance) are file-local: ONE exported function plus its
// input type is the entire community surface, by design — the boundary-
// width gate on measures/_shared is tight.
//
// Pipeline (see openspec changes/name-uniqueness-tier0-measure/design.md):
//   1. tokenise + significance filter (acronym-preserving)
//   2. group declarations in the FULL repo index by significant-token-set
//   3. drop test-file members (paired sources aren't cross-file ambiguity)
//   4. collapse to unique file-paths (same-file decls = one concept)
//   5. EXEMPT cluster if every significant token ∈ allowlist
//   6. EXEMPT cluster if all members reachable within K hops (undirected)
//   7. emit a violation for each cluster member that is also in `scope`
//
// Diff-scoping happens at step 7: the runner supplies `scope` as the
// newly-introduced declarations, and we never flag anything outside it.
// Without that, the measure would be an unfixable wall on legacy code.

const MIN_TOKEN_LENGTH = 3
const DEFAULT_MAX_GRAPH_HOPS = 3

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

const TEST_FILE_PATTERN: RegExp = /\.(test|spec|fixture|fixtures|stories|story|mock|mocks)\.[tj]sx?$/

type DeclarationKind =
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
    readonly filePath: string
    readonly kind: DeclarationKind
}

export type NameUniquenessInput = {
    readonly scope: readonly DeclaredName[]
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
    readonly maxGraphHops?: number
}

type Violation = {
    readonly declaration: DeclaredName
    readonly significantTokens: readonly string[]
    readonly collidingMembers: readonly DeclaredName[]
}

export function findNameUniquenessViolations(input: NameUniquenessInput): readonly Violation[] {
    const maxHops = input.maxGraphHops ?? DEFAULT_MAX_GRAPH_HOPS
    const scopeKeys = new Set(input.scope.map(declarationKey))
    if (scopeKeys.size === 0) return []

    // Scope decls that aren't in the prebuilt index (newly-introduced
    // file not yet indexed, scratch-area trip-test, etc) must still be
    // clustered against the index — otherwise a brand-new file's exports
    // could never produce a violation. Union, deduplicated by identity.
    const indexKeys = new Set(input.index.declarations.map(declarationKey))
    const augmented = input.scope.reduce<DeclaredName[]>((acc, decl) => {
        if (indexKeys.has(declarationKey(decl))) return acc
        acc.push(decl)
        return acc
    }, [...input.index.declarations])

    const clusters = buildClusters(augmented)
    const violations: Violation[] = []

    for (const cluster of clusters) {
        const productionMembers = cluster.members.filter(m => !isTestFilePath(m.filePath))
        const fileSet = new Set(productionMembers.map(m => m.filePath))
        if (fileSet.size < 2) continue
        if (allTokensInAllowlist(cluster.significantTokens, input.allowlist)) continue
        if (clusterFullyConnected(fileSet, input.importGraph, maxHops)) continue

        for (const member of productionMembers) {
            if (!scopeKeys.has(declarationKey(member))) continue
            violations.push({
                declaration: member,
                significantTokens: cluster.significantTokens,
                collidingMembers: productionMembers.filter(other => other.filePath !== member.filePath),
            })
        }
    }
    return violations
}

// ─── Tokenisation + significance ─────────────────────────────────────────────

function splitNameTokens(rawName: string): readonly string[] {
    const camelSplit = rawName
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
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

function significantTokensFor(decl: DeclaredName): readonly string[] {
    const raw = splitNameTokens(decl.name)
    const stripped = decl.kind === 'file' ? stripBasenameSuffixTokens(raw) : raw
    const filtered = stripped.filter(token => {
        if (isAcronymToken(token)) return true
        if (token.length < MIN_TOKEN_LENGTH) return false
        const lower = token.toLowerCase()
        if (STOPWORDS.has(lower)) return false
        if (/^\d+$/.test(token)) return false
        return true
    })
    return [...new Set(filtered.map(t => t.toLowerCase()))]
}

function tokenSetKey(tokens: readonly string[]): string {
    return [...tokens].sort().join('|')
}

// ─── Clustering ──────────────────────────────────────────────────────────────

type RawCluster = {
    readonly significantTokens: readonly string[]
    readonly members: readonly DeclaredName[]
}

function buildClusters(declarations: readonly DeclaredName[]): readonly RawCluster[] {
    const buckets = new Map<string, {tokens: readonly string[]; members: DeclaredName[]}>()
    for (const decl of declarations) {
        const sig = significantTokensFor(decl)
        if (sig.length === 0) continue
        const key = tokenSetKey(sig)
        const existing = buckets.get(key)
        if (existing) existing.members.push(decl)
        else buckets.set(key, {tokens: [...sig].sort(), members: [decl]})
    }
    return [...buckets.values()]
        .map(bucket => ({significantTokens: bucket.tokens, members: bucket.members}))
        .filter(cluster => uniqueFilePathCount(cluster.members) > 1)
}

function uniqueFilePathCount(members: readonly DeclaredName[]): number {
    return new Set(members.map(m => m.filePath)).size
}

// ─── Same-file / test-file drops ─────────────────────────────────────────────

function isTestFilePath(filePath: string): boolean {
    return TEST_FILE_PATTERN.test(filePath)
}

// ─── Allowlist ───────────────────────────────────────────────────────────────

function allTokensInAllowlist(
    tokens: readonly string[],
    allowlist: NameUniquenessInput['allowlist'],
): boolean {
    if (tokens.length === 0) return true
    return tokens.every(token => {
        const lower = token.toLowerCase()
        return allowlist.universal.has(lower) || allowlist.projectConventions.has(lower)
    })
}

// ─── Graph-distance ──────────────────────────────────────────────────────────

function clusterFullyConnected(
    fileSet: ReadonlySet<string>,
    graph: NameUniquenessInput['importGraph'],
    maxHops: number,
): boolean {
    const files = [...fileSet]
    if (files.length <= 1) return true
    if (files.some(f => !graph.knownFiles.has(f))) return false
    for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
            if (!graph.canReach(files[i], files[j], maxHops)) return false
        }
    }
    return true
}

// ─── Identity helper ─────────────────────────────────────────────────────────

function declarationKey(decl: DeclaredName): string {
    return `${decl.filePath}\0${decl.kind}\0${decl.name}`
}
