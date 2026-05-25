/**
 * Call-DAG fingerprint — Type-4+ "workflow" clone detector.
 *
 * Expand a function's internal-callee tree to a bounded depth, label each
 * node by the behavioural-fingerprint hash of its target (so callees that
 * are semantically equivalent collapse to the same label even when named
 * differently), canonicalise the resulting tree, and hash it.
 *
 * Catches near-duplicate multi-function workflows that the per-function
 * fingerprints cannot see — e.g. `parseJsonFromDisk → validate → store`
 * vs `readAndParse → check → persist` cluster when their leaves have
 * matching behavioural shapes.
 *
 * Callee resolution is by NAME + ARITY-COMPATIBILITY against the extracted
 * function set. Full TS-checker symbol resolution would be more precise but
 * an order of magnitude slower and would force ts-morph back into the
 * pipeline. Name collisions are tracked via `resolutionCollisions` so the
 * lossiness is visible from the health test rather than silently corrupting
 * the fingerprint.
 */
import * as ts from 'typescript'
import {behavioralFingerprint} from './behavioral-fingerprint'
import type {FunctionRecord} from './extract-functions'
import {stableHash} from './minhash'

const DEFAULT_DEPTH: number = 3
const EXTERNAL_PREFIX: string = 'ext:'
const CYCLE_PREFIX: string = 'cycle:'

export type CallDagFingerprint = {
    readonly canonical: string
    /** FNV-1a-32 of the canonical S-expression. Two equal hashes = exact DAG match. */
    readonly canonicalHash: number
    /** Set of `${parentLabel}>${childLabel}` strings — the fuzzy-match feature set. */
    readonly edgeSet: ReadonlySet<string>
    /** Reached depth (1 = no internal children, just the root). */
    readonly depth: number
    /** Count of distinct labelled nodes encountered (root included). */
    readonly nodeCount: number
    /** Count of internal-callee CallExpressions whose target could not be resolved by name+arity. */
    readonly unresolvedInternalCallees: number
    /** Count of resolution sites that had >1 candidate in the extracted set (name collisions). */
    readonly resolutionCollisions: number
    /** Convenience: count of children at the root (depth-1 internal callees). */
    readonly rootInternalChildCount: number
}

export type CallDagOptions = {
    readonly depth?: number
}

type ResolutionEntry = {
    readonly record: FunctionRecord
    readonly minArity: number
    readonly maxArity: number
    readonly label: string
}

export type CallDagIndex = {
    readonly byName: ReadonlyMap<string, readonly ResolutionEntry[]>
    readonly labelOf: ReadonlyMap<string, string>
}

function isFunctionLikeBoundary(node: ts.Node): boolean {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
}

function arityBounds(node: ts.FunctionLikeDeclaration): {min: number; max: number} {
    const params = node.parameters ?? []
    let required = 0
    let hasRest = false
    for (const param of params) {
        if (param.dotDotDotToken) {
            hasRest = true
            continue
        }
        if (param.questionToken || param.initializer) continue
        required += 1
    }
    return {
        min: required,
        max: hasRest ? Number.POSITIVE_INFINITY : params.length,
    }
}

/**
 * Build the resolution index once for the entire extracted set.
 * `labelOf` maps a FunctionRecord.id → its behavioural-fingerprint label
 * (lazy computation is wasteful when we'll touch most records anyway).
 */
export function buildCallDagIndex(records: readonly FunctionRecord[]): CallDagIndex {
    const byName = new Map<string, ResolutionEntry[]>()
    const labelOf = new Map<string, string>()

    for (const record of records) {
        const bounds = arityBounds(record.node)
        const label = behavioralLabel(record)
        labelOf.set(record.id, label)
        const entry: ResolutionEntry = {
            record,
            minArity: bounds.min,
            maxArity: bounds.max,
            label,
        }
        const existing = byName.get(record.name)
        if (existing) existing.push(entry)
        else byName.set(record.name, [entry])
    }

    return {byName, labelOf}
}

function behavioralLabel(record: FunctionRecord): string {
    const fp = behavioralFingerprint(record.node)
    // Strip the called-symbol features (cs:…). They embed the names of the
    // callees, which would defeat the renaming-invariance of the DAG: two
    // workflows with renamed sub-functions would label their roots
    // differently even though their expanded DAGs are isomorphic. The DAG
    // itself already captures the callees structurally via child labels,
    // so dropping `cs:` here is non-lossy for DAG comparison.
    const sortedFeatures = [...fp.features]
        .filter(feature => !feature.startsWith('cs:'))
        .sort()
    const blob = sortedFeatures.join('|')
    return `b:${stableHash(blob).toString(16)}`
}

function calleeNameOf(callee: ts.Expression): string | null {
    if (ts.isIdentifier(callee)) return callee.text
    if (ts.isPropertyAccessExpression(callee)) {
        return ts.isIdentifier(callee.name) ? callee.name.text : null
    }
    if (ts.isElementAccessExpression(callee)) {
        const arg = callee.argumentExpression
        if (ts.isStringLiteral(arg)) return arg.text
        return null
    }
    if (ts.isParenthesizedExpression(callee)) return calleeNameOf(callee.expression)
    if (ts.isNonNullExpression(callee)) return calleeNameOf(callee.expression)
    return null
}

type CallSite = {
    readonly name: string
    readonly argCount: number
}

function collectCallSites(body: ts.Node, root: ts.FunctionLikeDeclaration): CallSite[] {
    const sites: CallSite[] = []
    function visit(node: ts.Node): void {
        if (node !== root && isFunctionLikeBoundary(node)) return
        if (ts.isCallExpression(node)) {
            const name = calleeNameOf(node.expression)
            if (name !== null && name.length > 0) {
                sites.push({name, argCount: node.arguments.length})
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(body)
    return sites
}

type Resolution =
    | {kind: 'internal'; entry: ResolutionEntry; collided: boolean}
    | {kind: 'external'; name: string}
    | {kind: 'unresolved'; name: string}

function resolveCallSite(site: CallSite, index: CallDagIndex): Resolution {
    const candidates = index.byName.get(site.name)
    if (!candidates || candidates.length === 0) {
        // No function by this name in the extracted set → it's an external
        // call (library, built-in, framework hook, etc.).
        return {kind: 'external', name: site.name}
    }
    const arityMatches = candidates.filter(candidate =>
        site.argCount >= candidate.minArity && site.argCount <= candidate.maxArity,
    )
    if (arityMatches.length === 0) {
        // Name exists in our set but no arity-compatible candidate. This is
        // a genuinely lossy resolution (likely a method on an unrelated
        // class or an overload disagreement) — track it so the health test
        // can surface how often this happens.
        return {kind: 'unresolved', name: site.name}
    }
    return {
        kind: 'internal',
        entry: arityMatches[0],
        collided: arityMatches.length > 1,
    }
}

type ExpansionStats = {
    nodeCount: number
    unresolvedInternalCallees: number
    resolutionCollisions: number
    maxDepth: number
    rootInternalChildCount: number
}

type NodeRender = {
    readonly label: string
    readonly children: readonly NodeRender[]
}

function expandFunction(
    record: FunctionRecord,
    index: CallDagIndex,
    maxDepth: number,
    visited: ReadonlySet<string>,
    currentDepth: number,
    stats: ExpansionStats,
    isRoot: boolean,
): NodeRender {
    const label = index.labelOf.get(record.id) ?? behavioralLabel(record)
    stats.nodeCount += 1
    if (currentDepth > stats.maxDepth) stats.maxDepth = currentDepth

    if (currentDepth >= maxDepth || !record.node.body) {
        return {label, children: []}
    }

    const callSites = collectCallSites(record.node.body, record.node)
    const children: NodeRender[] = []
    const nextVisited = new Set(visited)
    nextVisited.add(record.id)

    for (const site of callSites) {
        const resolution = resolveCallSite(site, index)
        if (resolution.kind === 'external') {
            stats.nodeCount += 1
            children.push({label: `${EXTERNAL_PREFIX}${site.name}`, children: []})
            continue
        }
        if (resolution.kind === 'unresolved') {
            stats.unresolvedInternalCallees += 1
            stats.nodeCount += 1
            children.push({label: `${EXTERNAL_PREFIX}${site.name}`, children: []})
            continue
        }
        if (resolution.collided) stats.resolutionCollisions += 1
        const target = resolution.entry.record
        if (visited.has(target.id)) {
            stats.nodeCount += 1
            children.push({label: `${CYCLE_PREFIX}${resolution.entry.label}`, children: []})
            continue
        }
        children.push(expandFunction(target, index, maxDepth, nextVisited, currentDepth + 1, stats, false))
    }

    if (isRoot) stats.rootInternalChildCount = children.filter(child => child.label.startsWith('b:')).length
    return {label, children}
}

function canonicalise(node: NodeRender): string {
    if (node.children.length === 0) return `(${node.label})`
    const childStrings = node.children.map(canonicalise).sort()
    return `(${node.label} ${childStrings.join(' ')})`
}

function collectEdges(node: NodeRender, into: Set<string>): void {
    for (const child of node.children) {
        into.add(`${node.label}>${child.label}`)
        collectEdges(child, into)
    }
}

export function callDagFingerprint(
    record: FunctionRecord,
    index: CallDagIndex,
    options: CallDagOptions = {},
): CallDagFingerprint {
    const depth = options.depth ?? DEFAULT_DEPTH
    const stats: ExpansionStats = {
        nodeCount: 0,
        unresolvedInternalCallees: 0,
        resolutionCollisions: 0,
        maxDepth: 0,
        rootInternalChildCount: 0,
    }
    const root = expandFunction(record, index, depth, new Set(), 1, stats, true)
    const canonical = canonicalise(root)
    const edgeSet = new Set<string>()
    collectEdges(root, edgeSet)
    return {
        canonical,
        canonicalHash: stableHash(canonical),
        edgeSet,
        depth: stats.maxDepth,
        nodeCount: stats.nodeCount,
        unresolvedInternalCallees: stats.unresolvedInternalCallees,
        resolutionCollisions: stats.resolutionCollisions,
        rootInternalChildCount: stats.rootInternalChildCount,
    }
}
